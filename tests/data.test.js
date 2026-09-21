import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

let raw = {};
let failRead = false, failThumb = false;
const queues = new Map();
// Shared named lock emulates separate extension contexts (not a module-local promise queue).
Object.defineProperty(globalThis, 'navigator', { value: { locks: {
  request(name, fn) {
    const next = (queues.get(name) || Promise.resolve()).catch(() => {}).then(fn);
    queues.set(name, next.catch(() => {}));
    return next;
  }
}}, configurable: true });
globalThis.chrome = { storage: { local: {
  async get(keys) {
    await new Promise(r => setTimeout(r, 1));
    if (failRead) throw new Error('disk unavailable');
    if (keys === null) return structuredClone(raw);
    return Object.fromEntries([].concat(keys).map(k => [k, structuredClone(raw[k])]));
  },
  async set(values) {
    await new Promise(r => setTimeout(r, 1));
    if (failThumb && Object.keys(values).some(k => k.includes(':thumb:'))) throw new Error('quota');
    Object.assign(raw, structuredClone(values));
  },
  async remove(keys) { for (const k of [].concat(keys)) delete raw[k]; }
}}};
const data = await import('../movie-notes-extension/utils/local-data.js');
const storage = await import('../movie-notes-extension/utils/storage.js');
const otherContext = await import('../movie-notes-extension/utils/storage.js?second-context');
const { mergeNote } = await import('../movie-notes-extension/utils/merge.js');
const { videoIdentity, isSupportedUrl } = await import('../movie-notes-extension/utils/platform.js');
const sync = await import('../movie-notes-extension/utils/sync.js');
const { db } = await import('../movie-notes-extension/utils/supabase.js');
const url = id => `https://www.youtube.com/watch?v=${id}`;
const save = (id, extra = {}) => storage.saveEntry('视频', null, null, { content: '笔记', videoUrl: url(id), ...extra });
async function account(id) {
  await data.withDataLock(async () => { await data.getOwner(); await data.activateOwner(id); raw.supabaseSession = { user: { id } }; });
}
beforeEach(() => { raw = {}; failRead = false; failThumb = false; });

test('Notion configuration retains verification only when explicitly saved', async () => {
  await storage.saveNotionConfig({token:'ntn_test',parentPageId:'page',parentTitle:'旁白记录',verifiedAt:'2026-09-20T00:00:00Z'});
  assert.equal((await storage.loadNotionConfig()).parentTitle,'旁白记录');
  assert.ok((await storage.loadNotionConfig()).verifiedAt);
  await storage.saveNotionConfig({token:'ntn_new',parentPageId:'other'});
  assert.equal((await storage.loadNotionConfig()).verifiedAt,'');
  await account('another-owner');
  assert.equal((await storage.loadNotionConfig()).token,'');
});

test('Notion verification cannot save credentials to a different account after sign-in', async () => {
  const owner = await data.getOwner();
  await account('new-owner');
  await assert.rejects(storage.saveNotionConfig({token:'ntn_test',parentPageId:'page'},owner), /账号已切换/);
  assert.equal((await storage.loadNotionConfig()).token,'');
});

test('legacy migration preserves original copy and assigns existing account', async () => {
  raw = { supabaseSession: { user: { id: 'A' } }, movieNotes: [{ id: 'old', entries: [] }] };
  assert.equal(await data.getOwner(), 'A');
  assert.equal((await storage.getAllNotes())[0].id, 'old');
  assert.equal(raw.movieNotes[0].id, 'old');
});
test('parallel saves across two module contexts retain all notes', async () => {
  await Promise.all(Array.from({ length: 15 }, (_, i) => (i % 2 ? storage : otherContext).saveEntry('same title', null, null, { content: 'text', videoUrl: url(i) })));
  assert.equal((await storage.getAllNotes()).length, 15);
});
test('quick save preserves movie tags; explicit clearing still works', async () => {
  await storage.saveEntry('视频', ['电影'], null, { content: 'one', videoUrl: url('a') });
  await save('a');
  assert.deepEqual((await storage.getAllNotes())[0].tags, ['电影']);
  const note = (await storage.getAllNotes())[0];
  await storage.updateMovie(note.id, { tags: [] });
  assert.deepEqual((await storage.getAllNotes())[0].tags, []);
});
test('video IDs distinguish same titles and Bilibili parts, ignore tracking/time', async () => {
  await save('a'); await save('b');
  assert.equal((await storage.getAllNotes()).length, 2);
  assert.equal(videoIdentity(url('a') + '&t=90&list=playlist'), videoIdentity('https://youtu.be/a'));
  assert.notEqual(videoIdentity('https://www.bilibili.com/video/BVabc?p=1'), videoIdentity('https://www.bilibili.com/video/BVabc?p=2'));
  assert.equal(isSupportedUrl('https://youtube.com.evil.example/watch?v=a'), false);
  assert.equal(isSupportedUrl('https://v.qq.com/x/cover/a'), true);
});
test('retries with the same entry ID are idempotent', async () => {
  await Promise.all([save('a', { id: 'request-1' }), save('a', { id: 'request-1' })]);
  assert.equal((await storage.getAllNotes())[0].entries.length, 1);
});
test('storage read failure does not turn a library into an empty successful write', async () => {
  await save('a'); const before = structuredClone(raw);
  failRead = true;
  await assert.rejects(save('b'));
  assert.deepEqual(raw, before);
});
test('failed thumbnail migration retains the only image copy', async () => {
  raw.movieNotes = [{ id: 'n', entries: [{ id: 'e', thumbnail: 'data:image/jpeg;base64,YQ==' }] }];
  await data.getOwner(); failThumb = true;
  await storage.migrateThumbnailsIfNeeded();
  assert.equal((await storage.getAllNotes())[0].entries[0].thumbnail, 'data:image/jpeg;base64,YQ==');
});
test('account libraries, drafts and pending changes are isolated', async () => {
  await save('guest');
  await account('A'); await save('a'); await storage.saveDraft({ content: 'A draft' });
  await account('B'); assert.equal((await storage.getAllNotes()).length, 0); assert.equal(await storage.loadDraft(), null);
  await save('b'); await account('A');
  assert.equal((await storage.getAllNotes())[0].videoUrl, url('a'));
  assert.equal((await storage.loadDraft()).content, 'A draft');
  await assert.rejects(save('wrong', { expectedOwner: 'B' }), /账号已切换/);
  await account('guest'); assert.equal((await storage.getAllNotes())[0].videoUrl, url('guest'));
});
test('local deletion survives stale remote snapshots and remains pending', async () => {
  await account('A'); const { note, entry } = await save('a');
  await storage.deleteEntry(note.id, entry.id);
  await storage.applyRemoteNotes([note], 'A');
  assert.equal((await storage.getAllNotes())[0].entries.length, 0);
  assert.equal((await sync.getPendingIds()).has(note.id), true);
  await storage.deleteMovie(note.id);
  await storage.applyRemoteNotes([note], 'A');
  assert.equal((await storage.getAllNotes()).length, 0);
  assert.equal((await storage.getSyncNotes()).length, 1);
});
test('remote merge preserves concurrent independent entry edits', () => {
  const base = { id: 'm', updatedAt: '2026-01-01', entries: [] };
  const merged = mergeNote({ ...base, entries: [{ id: 'a', content: 'local edit', updatedAt: '2026-03-01' }, { id: 'b', content: 'old', updatedAt: '2026-01-01' }] },
    { ...base, updatedAt: '2026-04-01', entries: [{ id: 'a', content: 'old', updatedAt: '2026-01-01' }, { id: 'b', content: 'remote edit', updatedAt: '2026-04-01' }] });
  assert.deepEqual(merged.entries.map(e => e.content), ['local edit', 'remote edit']);
});
test('pull applied to fresh state does not overwrite a save made during network wait', async () => {
  await account('A'); const snapshot = (await save('a')).note;
  await save('b'); await storage.applyRemoteNotes([snapshot], 'A');
  assert.equal((await storage.getAllNotes()).length, 2);
});
test('in-flight push cannot mark a later local edit synced', async () => {
  await account('A'); const { note, entry } = await save('a');
  const original = db.rpc;
  db.rpc = async () => { await storage.updateEntry(note.id, entry.id, { content: 'new edit' }); };
  try { await sync.pushNote(note, 'A'); } finally { db.rpc = original; }
  assert.equal((await sync.getPendingIds()).has(note.id), true);
});
test('RPC failure keeps durable pending data and propagates instead of false success', async () => {
  await account('A'); const { note } = await save('a'); const original = db.rpc;
  db.rpc = async () => { throw new Error('offline'); };
  try { await assert.rejects(sync.flushPending(null, 'A'), /offline/); } finally { db.rpc = original; }
  assert.equal((await sync.getPendingIds()).has(note.id), true);
});
test('manual synchronization downloads cloud notes even with an empty local library', async () => {
  await account('A');
  const select = db.select;
  db.select = async table => table === 'movies' ? [{ id:'cloud-only', movie_title:'Cloud note', updated_at:'2026-01-01' }] : [];
  try {
    assert.equal((await sync.synchronize('A', { forcePush:true })).size, 0);
    assert.equal((await storage.getAllNotes())[0].id, 'cloud-only');
  } finally { db.select = select; }
});
test('manual synchronization sends deletions even when the visible library is empty', async () => {
  await account('A'); const { note } = await save('a'); await storage.deleteMovie(note.id);
  const rpc = db.rpc, select = db.select; let sent;
  db.rpc = async (_name, args) => { sent = args.payload; };
  db.select = async () => [];
  try {
    assert.equal((await storage.getAllNotes()).length, 0);
    assert.equal((await sync.synchronize('A', { forcePush:true })).size, 0);
    assert.ok(sent.deleted_at);
  } finally { db.rpc = rpc; db.select = select; }
});
test('manual synchronization propagates pull failure after a successful upload', async () => {
  await account('A'); await save('a');
  const rpc = db.rpc, select = db.select;
  db.rpc = async () => {};
  db.select = async () => { throw new Error('cloud read unavailable'); };
  try { await assert.rejects(sync.synchronize('A', { forcePush:true }), /cloud read unavailable/); }
  finally { db.rpc = rpc; db.select = select; }
});
test('outgoing deletion and thumbnail are included in one atomic RPC', async () => {
  await account('A'); const one = await save('a', { thumbnail: 'data:image/jpeg;base64,YQ==' });
  const two = await save('a'); await storage.deleteEntry(one.note.id, two.entry.id);
  let payload; const original = db.rpc;
  db.rpc = async (_name, args) => { payload = args.payload; };
  try { await sync.pushNote(one.note, 'A'); } finally { db.rpc = original; }
  assert.equal(payload.entries.find(e => e.id === one.entry.id).thumbnail, 'data:image/jpeg;base64,YQ==');
  assert.ok(payload.entries.find(e => e.id === two.entry.id).deleted_at);
  assert.equal((await sync.getPendingIds()).size, 0);
});
test('pull paginates and rejects account change before writing', async () => {
  await account('A'); const original = db.select; let moviePages = 0;
  db.select = async (table, query) => {
    if (table === 'entries') return [];
    moviePages++;
    return query.includes('offset=0') ? Array.from({length:100},(_,i)=>({id:`m${i}`,movie_title:'x'})) : [];
  };
  try { await sync.pull(); } finally { db.select = original; }
  assert.equal(moviePages, 2); assert.equal((await storage.getAllNotes()).length, 100);
  await account('B'); await assert.rejects(storage.applyRemoteNotes([], 'A'), /账号已切换/);
});

test('sign-out atomically switches session and library without deleting the old account', async () => {
  await account('A'); await save('a');
  const { clearSession } = await import('../movie-notes-extension/utils/supabase.js');
  await clearSession();
  assert.equal(raw.supabaseSession, null); assert.equal(raw.asideDataOwner, 'guest');
  assert.equal((await storage.getAllNotes()).length, 0);
  await account('A'); assert.equal((await storage.getAllNotes()).length, 1);
});
test('unchanged server revisions do not redownload screenshots', async () => {
  await account('A'); const original = db.select; let entryRequests = 0;
  db.select = async table => {
    if (table === 'movies') return [{ id: 'm', movie_title: 'x', updated_at: '2026-01-01', sync_updated_at: '2026-02-01' }];
    entryRequests++; return [];
  };
  try { await sync.pull(); await sync.pull(); } finally { db.select = original; }
  assert.equal(entryRequests, 1);
});
test('adding from a movie detail stays in the chosen movie even with no active video tab', async () => {
  const first = await save('a');
  await storage.saveEntry('视频', null, null, { movieId: first.note.id, content: 'overall review' });
  const notes = await storage.getAllNotes();
  assert.equal(notes.length, 1); assert.equal(notes[0].entries.length, 2);
});
