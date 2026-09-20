import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestHelpPage, springProgress } from '../movie-notes-extension/utils/help-snap.js';

test('help settles to the nearer page and never traps long-page reading', () => {
  assert.equal(nearestHelpPage(180, 400, 400), 0);
  assert.equal(nearestHelpPage(220, 400, 400), 400);
  assert.equal(nearestHelpPage(200, 400, 400), 400);
  assert.equal(nearestHelpPage(0, 400, 400), null);
  assert.equal(nearestHelpPage(550, 400, 400), null);
  assert.equal(nearestHelpPage(100, 700, 400), null);
  assert.equal(nearestHelpPage(390, 700, 400), 300);
  assert.equal(nearestHelpPage(590, 700, 400), 700);
});

test('help spring has bounded overshoot and rests exactly on the destination', () => {
  assert.equal(springProgress(0), 0);
  assert.equal(springProgress(1), 1);
  const frames = Array.from({length:101}, (_, i) => springProgress(i/100));
  assert.ok(frames.some(value => value > 1));
  assert.ok(frames.every(value => value >= 0 && value < 1.15));
});
