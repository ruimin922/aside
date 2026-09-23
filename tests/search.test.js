import test from 'node:test';
import assert from 'node:assert/strict';
import { searchNotes, searchExcerpt, highlightParts } from '../movie-notes-extension/utils/search.js';
const notes = [{id:'one',movieTitle:'学习访谈',tags:['研究'],entries:[
  {id:'a',content:'讨论强化学习的应用',tags:['AI']},
  {id:'b',content:'另一条无关的记录',tags:['剪辑']},
]}, {id:'two',movieTitle:'强化学习课程',entries:[]}];
test('search returns the exact matching entry and separately keeps video-title matches', () => {
  const results=searchNotes(notes,' 强化学习 ');
  assert.deepEqual(results.map(r=>[r.note.id,r.entries.map(e=>e.id)]),[['one',['a']],['two',[]]]);
  assert.equal(results[1].titleMatch,true);
  assert.equal(notes[0].entries.length,2);
});
test('entry tags and video tags work without showing unrelated entries', () => {
  assert.deepEqual(searchNotes(notes,'ai')[0].entries.map(e=>e.id),['a']);
  const result=searchNotes(notes,'研究')[0];
  assert.equal(result.tagsMatch,true); assert.deepEqual(result.entries,[]);
  assert.equal(searchNotes([{movieGenre:'纪录片'}],'纪录片').length,1);
});
test('empty queries, no matches, deleted notes, and missing fields are safe', () => {
  assert.deepEqual(searchNotes(notes,'  '),[]);
  assert.deepEqual(searchNotes(notes,'不存在'),[]);
  assert.deepEqual(searchNotes([{...notes[0],deletedAt:'today'}],'学习'),[]);
  assert.deepEqual(searchNotes([{}],'a'),[]);
});
test('long snippets include the match near the end and do not break emoji', () => {
  const content='之前的内容。'.repeat(100)+'关键观点😀'+'之后的内容。'.repeat(100);
  const excerpt=searchExcerpt(content,'关键观点');
  assert.match(excerpt,/关键观点😀/); assert.ok(excerpt.startsWith('…')&&excerpt.endsWith('…'));
  assert.ok(excerpt.length<=182);
  const emoji=searchExcerpt('😀'.repeat(200),'',181);
  assert.equal(emoji.replaceAll('😀','').replaceAll('…',''),'');
});
test('highlight treats regex syntax literally and preserves untrusted text as data', () => {
  for (const query of ['[', 'a+b', '<script>', '.*', '\\']) {
    const text=`before ${query} after ${query}`;
    const parts=highlightParts(text,query);
    assert.equal(parts.map(p=>p.text).join(''),text);
    assert.deepEqual(parts.filter(p=>p.match).map(p=>p.text),[query,query]);
  }
});
test('mixed-case highlighting preserves original casing and surrounding Unicode', () => {
  const parts=highlightParts('想法 AI 与 ai 😀','ai');
  assert.deepEqual(parts.filter(p=>p.match).map(p=>p.text),['AI','ai']);
  assert.equal(parts.map(p=>p.text).join(''),'想法 AI 与 ai 😀');
});
