import test from 'node:test';
import assert from 'node:assert/strict';
await import('../movie-notes-extension/library-presence.js');

function setup(t) {
  t.mock.timers.enable({apis:['setTimeout']});
  let closes = 0;
  const surface = globalThis.__asideLibraryPresence(() => closes++);
  return {surface, count:() => closes, tick:ms => t.mock.timers.tick(ms)};
}
test('toolbar opening waits for the first mouse visit; exiting has a grace period', t => {
  const {surface:s,count,tick} = setup(t);
  s.open(); s.leave(); tick(1000); assert.equal(count(),0);
  s.enter(); s.leave(); tick(119); assert.equal(count(),0);
  tick(1); assert.equal(count(),1);
});
test('returning during the grace period cancels dismissal', t => {
  const {surface:s,count,tick} = setup(t);
  s.open(); s.enter(); s.leave(); tick(60); s.enter(); tick(1000);
  assert.equal(count(),0);
  s.leave(); tick(120); assert.equal(count(),1);
});
test('pin cancels pending dismissal and remains active across reopening', t => {
  const {surface:s,count,tick} = setup(t);
  s.open(); s.enter(); s.leave(); s.pin(true); tick(1000);
  s.close(); s.open(); s.enter(); s.leave(); tick(1000); assert.equal(count(),0);
  s.pin(false); tick(120); assert.equal(count(),1);
});
test('dragging and resizing suppress dismissal until the interaction ends', t => {
  const {surface:s,count,tick} = setup(t);
  s.open(); s.enter(); s.interact(true); s.leave(); tick(1000); assert.equal(count(),0);
  s.interact(false); tick(120); assert.equal(count(),1);
});
test('closing and reopening cannot inherit a previous dismissal timer', t => {
  const {surface:s,count,tick} = setup(t);
  s.open(); s.enter(); s.leave(); s.close(); s.open(); tick(1000); assert.equal(count(),0);
});
