import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
let raw = {}, listener, actionClick, commandListener;
const queues = new Map();
Object.defineProperty(globalThis, 'navigator', { value: { locks: { request(name, fn) {
  const p = (queues.get(name) || Promise.resolve()).catch(() => {}).then(fn); queues.set(name, p.catch(() => {})); return p;
}}}, configurable: true });
const event = { addListener() {} };
const area = {
  async get(keys) { return keys === null ? structuredClone(raw) : Object.fromEntries([].concat(keys).map(k => [k, structuredClone(raw[k])])); },
  async set(values) { Object.assign(raw, structuredClone(values)); },
  async remove(keys) { for (const k of [].concat(keys)) delete raw[k]; }
};
globalThis.chrome = {
  storage: { local: area, session: area },
  runtime: { getURL: path => 'chrome-extension://aside-test/'+path, onMessage: { addListener(fn) { listener = fn; } }, onInstalled: event, onStartup: event },
  action: { async setTitle(){}, async setBadgeText(){}, onClicked: { addListener(fn) { actionClick = fn; } } }, tabs: { async query(){return [];}, onUpdated: event, onActivated: event, async get() { throw new Error('closed'); } },
  commands: { onCommand: { addListener(fn) { commandListener=fn; } } },
  windows: {},
  alarms: { create() {}, onAlarm: event }, sidePanel: {}
};
await import('../movie-notes-extension/background.js');
const storage = await import('../movie-notes-extension/utils/storage.js');
const { withDataLock, activateOwner } = await import('../movie-notes-extension/utils/local-data.js');
const sender = { tab: { id: 1, url: 'https://www.youtube.com/watch?v=a' } };
const send = (msg, source = sender) => new Promise(resolve => listener(msg, source, resolve));
beforeEach(() => {
  raw = {};
  chrome.tabs.query = async () => [];
  chrome.action.setTitle = async () => {};
  chrome.action.setBadgeText = async () => {};
  chrome.windows.create = async () => { assert.fail('The library must never open a separate browser window'); };
});

test('draft RPC preserves image across typing, restores on another closed tab, rejects wrong account', async () => {
  let result = await send({ type: 'MN_GET_QUICK_DRAFT', url: sender.tab.url });
  assert.equal(result.owner, 'guest');
  await send({ type: 'MN_PUT_QUICK_DRAFT', url: sender.tab.url, owner: 'guest', text: 'one', meta: { id: 'e', thumbnail: 'data:image/jpeg;base64,YQ==', timeSec: 52 } });
  await send({ type: 'MN_PUT_QUICK_DRAFT', url: sender.tab.url, owner: 'guest', text: 'two', meta: { id: 'e', timeSec: 52 } });
  result = await send({ type: 'MN_GET_QUICK_DRAFT', url: sender.tab.url }, { tab: { ...sender.tab, id: 2 } });
  assert.equal(result.draft.text, 'two'); assert.equal(result.draft.meta.thumbnail, 'data:image/jpeg;base64,YQ==');
  await withDataLock(() => activateOwner('A'));
  result = await send({ type: 'MN_PUT_QUICK_DRAFT', owner: 'guest', url: sender.tab.url, text: 'must not cross', meta: {} });
  assert.equal(result.success, false);
});
test('quick save RPC preserves tags and is retry-safe', async () => {
  await storage.saveEntry('Movie', ['tag'], null, { content: 'old', videoUrl: sender.tab.url });
  const msg = { type: 'MN_SAVE_QUICK_NOTE', text: 'new', meta: { id: 'stable-id', owner: 'guest', title: 'Movie', url: sender.tab.url, timeSec: 52, formatted: '00:52' } };
  const result = await send(msg); await send(msg);
  assert.equal(result.savedLocally, true);
  const notes = await storage.getAllNotes();
  assert.deepEqual(notes[0].tags, ['tag']); assert.equal(notes[0].entries.length, 2);
});
test('unsupported sites cannot invoke quick-save or draft RPC', async () => {
  const result = await send({ type: 'MN_SAVE_QUICK_NOTE', text: 'x', meta: { title: 'x' } }, { tab: { id: 1, url: 'https://youtube.com.evil.test/' } });
  assert.equal(result.success, false); assert.equal((await storage.getAllNotes()).length, 0);
});


test('toolbar reuses a content host, injects only when needed, and falls back on restricted pages', async () => {
  const calls=[];
  chrome.tabs.create=async data=>calls.push(['create',data]);
  chrome.scripting={executeScript:async data=>calls.push(['inject',data])};
  chrome.tabs.sendMessage=async(id,msg)=>{calls.push(['message',id,msg]);return{success:true};};
  await actionClick({id:22});
  assert.equal(calls.length,1);assert.equal(calls[0][2].type,'MN_TOGGLE_LIBRARY');
  calls.length=0;let first=true;
  chrome.tabs.sendMessage=async(id,msg)=>{calls.push(['message',id,msg]);if(first){first=false;throw Error('no receiver');}return{success:true};};
  await actionClick({id:23});
  assert.deepEqual(calls.map(c=>c[0]),['message','inject','message']);
  assert.deepEqual(calls[1][1].files,['player-dock.js','content.js']);
  calls.length=0;
  chrome.tabs.sendMessage=async()=>{throw Error('no receiver');};
  chrome.scripting.executeScript=async()=>{throw Error('restricted browser page');};
  await actionClick({id:24,url:'chrome://version/',windowId:3,index:2});
  assert.deepEqual(calls,[['create',{url:'chrome-extension://aside-test/panel.html?sourceTab=24&reason=restricted',active:true,windowId:3,index:3}]]);
});

test('restricted-page fallback reuses its full tab in the same browser window', async () => {
  const calls=[];
  chrome.tabs.query=async query=>{assert.deepEqual(query,{windowId:4});return [
    {id:1,url:'chrome-extension://aside-test/panel.html?sourceTab=25&windowed=1'},
    {id:2,url:'chrome-extension://aside-test/panel.html?sourceTab=25&embedded=1'},
    {id:3,url:'chrome-extension://aside-test/panel.html?sourceTab=25&reason=restricted'}
  ];};
  chrome.tabs.update=async(id,props)=>calls.push([id,props]);
  chrome.tabs.create=async()=>assert.fail('Duplicate library tab');
  await actionClick({id:25,url:'https://chromewebstore.google.com/detail/test',windowId:4});
  assert.deepEqual(calls,[[3,{active:true}]]);
});

test('a busy editor preserves the page surface and reports its error', async () => {
  const feedback=[];
  chrome.action.setTitle=async value=>feedback.push(value.title);
  chrome.tabs.sendMessage=async()=>({success:false,error:'请等待记录保存完成后再打开记录库'});
  chrome.tabs.create=async()=>assert.fail('Busy editor opened another tab');
  const result=await actionClick({id:26,url:'https://www.youtube.com/watch?v=x'});
  assert.equal(result.success,false);
  assert.match(feedback.at(-1),/请等待记录保存完成/);
});

test('a stale receiver or transient injection error never changes a normal page to a tab', async () => {
  chrome.tabs.sendMessage=async()=>{throw Error('no receiver');};
  chrome.tabs.create=async()=>assert.fail('Transient error opened another tab');
  chrome.scripting.executeScript=async()=>{};
  assert.equal((await actionClick({id:27,url:'https://example.com/'})).success,false);
  chrome.scripting.executeScript=async()=>{throw Error('Frame was removed');};
  assert.equal((await actionClick({id:27,url:'https://example.com/'})).success,false);
});

test('an explicit browser access restriction falls back to a tab and retains the source', async () => {
  const calls=[];
  chrome.tabs.sendMessage=async()=>{throw Error('no receiver');};
  chrome.scripting.executeScript=async()=>{throw Error('Cannot access contents of url. Extension manifest must request permission to access this host.');};
  chrome.tabs.create=async props=>calls.push(props);
  const result=await actionClick({id:28,url:'file:///private/tmp/test.html',windowId:9});
  assert.equal(result.surface,'tab');assert.equal(calls[0].windowId,9);
  assert.match(calls[0].url,/sourceTab=28&reason=restricted/);
});

test('a lookalike store hostname remains an ordinary overlay page', async () => {
  chrome.tabs.sendMessage=async()=>({success:true,open:true});
  chrome.tabs.create=async()=>assert.fail('Ordinary page opened another tab');
  assert.equal((await actionClick({id:29,url:'https://chromewebstore.google.com.example.test/'})).open,true);
});
test('host commands require our extension page and an allowed action', async () => {
  const calls=[];chrome.tabs.sendMessage=async(id,msg)=>{calls.push({id,msg});return{success:true};};
  let res=await send({type:'MN_LIBRARY_ACTION',tabId:7,action:'quick'},{url:'https://example.com'});
  assert.equal(res.success,false);assert.equal(calls.length,0);
  res=await send({type:'MN_LIBRARY_ACTION',tabId:7,action:'delete'},{url:'chrome-extension://aside-test/panel.html'});
  assert.equal(res.success,false);assert.equal(calls.length,0);
  res=await send({type:'MN_LIBRARY_ACTION',tabId:7,action:'quick'},{url:'chrome-extension://aside-test/panel.html?embedded=1'});
  assert.equal(res.success,true);assert.deepEqual(calls,[{id:7,msg:{type:'MN_LIBRARY_HOST',action:'quick'}}]);

});

test('browser shortcut routes once to top frame and uses active source tab', async () => {
  const calls=[];chrome.tabs.sendMessage=async(id,msg,options)=>{calls.push({id,msg,options});return{success:true};};
  await commandListener('quick-note',{id:15,url:'https://www.youtube.com/watch?v=fixture'});
  await commandListener('insert-subtitle',{id:15,url:'https://www.youtube.com/watch?v=fixture'});
  assert.equal(calls.length,1);assert.equal(calls[0].id,15);assert.equal(calls[0].msg.command,'quick-note');assert.deepEqual(calls[0].options,{frameId:0});
  await commandListener('unknown',{id:15});assert.equal(calls.length,1);
});

test('toolbar inside the full library tab routes to its library view', async () => {
  const calls=[];chrome.tabs.sendMessage=async(id,msg,options)=>{calls.push({id,msg,options});return{success:true};};
  await actionClick({id:31,url:'chrome-extension://aside-test/panel.html?sourceTab=1&reason=restricted'});
  assert.equal(calls.length,1);assert.equal(calls[0].msg.command,'toggle-library');
});
