import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncStatusLabel, describeSyncFailure } from '../movie-notes-extension/utils/sync-feedback.js';

test('schema errors explain the required cloud upgrade instead of indefinite pending', () => {
  for (const message of ['云端需要升级同步结构；本地笔记已保留', 'column movies.sync_updated_at does not exist', 'PGRST202']) {
    const feedback = describeSyncFailure(new Error(message));
    assert.equal(feedback.label, '云端需要升级');
    assert.match(feedback.message, /本机/);
  }
});
test('connection, login and timeout failures have distinct recovery instructions', () => {
  assert.equal(describeSyncFailure(new TypeError('Failed to fetch')).label, '无法连接云端');
  assert.match(describeSyncFailure(new Error('未登录')).message, /重新登录/);
  assert.equal(describeSyncFailure(new Error('The operation timed out')).label, '同步超时');
  assert.equal(describeSyncFailure(new Error('账号已切换，同步已暂停')).label, '同步已暂停');
  assert.equal(describeSyncFailure(new Error('permission denied for table movies')).label, '云端权限异常');
});

test('signed-out status cannot imply a queued cloud upload', () => {
  assert.equal(syncStatusLabel('hidden'), '本地使用');
  assert.doesNotMatch(syncStatusLabel('hidden'), /等待|同步/);
});
test('offline network failures keep local data visible without masking schema or login errors', () => {
  const offline = { online: false };
  const feedback = describeSyncFailure(new TypeError('Failed to fetch'), offline);
  assert.equal(feedback.label, '离线待同步');
  assert.match(feedback.message, /本机/);
  assert.equal(describeSyncFailure(new Error('未登录'), offline).label, '登录已过期');
  assert.equal(describeSyncFailure(new Error('PGRST202'), offline).label, '云端需要升级');
});
