import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractNotionPageId, verifyNotionConnection, createNotionPageWithMarkdown, notionApiRequest, describeNotionError, chunkNotionText } from '../movie-notes-extension/utils/notion.js';

const parent = 'abcdefab-cdef-abcd-efab-cdefabcdefab';
const child = '12345678-1234-1234-1234-123456789012';
const token = 'ntn_unit_test_placeholder';
const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {status, headers});
const target = {id:parent, properties:{title:{type:'title',title:[{plain_text:'旁白记录'}]}}};

test('Notion page links ignore view query and block fragment; invalid input is rejected', () => {
  assert.equal(extractNotionPageId(`https://www.notion.so/Notes-${parent.replaceAll('-','')}?v=${child}#${child}`),parent);
  assert.equal(extractNotionPageId(parent),parent);
  assert.equal(extractNotionPageId(`https://www.notion.so/?p=${parent}`),'');
  assert.equal(extractNotionPageId('not a page'),'');
});

test('a readable page with forbidden writes must fail connection verification', async () => {
  const calls=[];
  await assert.rejects(verifyNotionConnection(token,parent,{fetcher:async(url, init)=>{
    calls.push(init.method);
    return init.method==='GET' ? response(target) : response({code:'restricted_resource',message:'API token does not have insert content capabilities.'},403);
  }}), error=>error.status===403 && describeNotionError(error).includes('Insert content'));
  assert.deepEqual(calls,['GET','POST']);
});

test('verification creates disclosed test page, returns target title and write proof', async () => {
  const calls=[];
  const result=await verifyNotionConnection(token,parent,{fetcher:async(url,init)=>{
    calls.push({url,...init}); return response(init.method==='GET'?target:{id:child});
  }});
  assert.equal(result.parentTitle,'旁白记录');
  assert.equal(result.testPageId,child);
  assert.ok(result.verifiedAt);
  const payload=JSON.parse(calls[1].body);
  assert.equal(payload.parent.page_id,parent);
  assert.equal(payload.properties.title.title[0].text.content,'旁白连接测试');
});

test('401/404 stop verification before creating a test page', async () => {
  for(const status of [401,404]) {
    let calls=0;
    await assert.rejects(verifyNotionConnection(token,parent,{fetcher:async()=>{calls++;return response({code:status===401?'unauthorized':'object_not_found'},status);}}),e=>e.status===status);
    assert.equal(calls,1);
  }
});

test('archived destination is rejected before writing', async () => {
  let calls=0;
  await assert.rejects(verifyNotionConnection(token,parent,{fetcher:async()=>{calls++;return response({...target,in_trash:true});}}),e=>e.code==='archived_parent');
  assert.equal(calls,1);
});

test('invalid page link fails locally without any API calls', async () => {
  let called=false;
  await assert.rejects(verifyNotionConnection(token,'wrong',{fetcher:async()=>{called=true;}}),e=>e.code==='invalid_parent');
  assert.equal(called,false);
});

test('writes are not repeated after 500 or an uncertain network failure', async () => {
  for (const network of [false,true]) {
    let calls=0;
    await assert.rejects(createNotionPageWithMarkdown(token,parent,'test','hello',{fetcher:async()=>{
      calls++; if(network)throw new TypeError('Failed to fetch');return response({code:'internal_server_error'},500);
    }}),e=>e.uncertainWrite && describeNotionError(e).includes('避免重复'));
    assert.equal(calls,1);
  }
});

test('explicit rate limit retries respect Retry-After without unbounded wait', async () => {
  let calls=0;const sleeps=[];
  await notionApiRequest(token,'/pages','POST',{}, {fetcher:async()=>++calls===1?response({code:'rate_limited'},429,{'Retry-After':'2'}):response({id:child}), sleep:async ms=>sleeps.push(ms)});
  assert.deepEqual(sleeps,[2000]);assert.equal(calls,2);
  await assert.rejects(notionApiRequest(token,'/pages','POST',{}, {fetcher:async()=>response({code:'rate_limited'},429,{'Retry-After':'120'}),sleep:async()=>assert.fail('must not hang for 120 seconds')}),e=>e.status===429);
});

test('large Chinese notes respect both Notion child count and byte limits', async () => {
  const bodies=[];
  await createNotionPageWithMarkdown(token,parent,'长记录',Array.from({length:220},()=>`> ${'想法'.repeat(1400)}`).join('\n'),{fetcher:async(url,init)=>{bodies.push(JSON.parse(init.body));return response({id:child});}});
  assert.ok(bodies.length>2);
  for(const body of bodies){assert.ok(body.children.length<=100);assert.ok(Buffer.byteLength(JSON.stringify(body))<500000);}
  const pieces=bodies.flatMap(b=>b.children).flatMap(b=>b[b.type].rich_text);
  assert.ok(pieces.every(item=>item.text.content.length<=2000));
});

test('very long formatted quote stays within rich-text array limits', async () => {
  const bodies=[];
  await createNotionPageWithMarkdown(token,parent,'test',`> ${'**记录** '.repeat(6000)}`,{fetcher:async(url,init)=>{bodies.push(JSON.parse(init.body));return response({id:child});}});
  for(const block of bodies.flatMap(b=>b.children)) assert.ok(block[block.type].rich_text.length<=100);
});

test('later batch failure preserves created page ID for partial export recovery', async () => {
  let calls=0;
  await assert.rejects(createNotionPageWithMarkdown(token,parent,'test',Array(120).fill('hello\n\n').join(''),{fetcher:async()=>++calls===1?response({id:child}):response({code:'validation_error',message:'bad block'},400)}),e=>e.partialPageId===child && describeNotionError(e).includes('未写完'));
  assert.equal(calls,2);
});

test('UTF-16 chunk boundaries do not split emoji', () => {
  const input='a'.repeat(1999)+'🎬想法';
  const chunks=chunkNotionText(input);
  assert.equal(chunks.join(''),input);
  assert.ok(chunks.every(chunk=>!/[\uD800-\uDBFF]$/.test(chunk)));
});

test('remote validation errors cannot expose supplied token', async()=>{
  await assert.rejects(notionApiRequest(token,'/pages','POST',{}, {fetcher:async()=>response({code:'validation_error',message:`bad ${token}`},400)}),e=>!e.message.includes(token));
});
