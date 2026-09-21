import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeSyncFailure } from '../movie-notes-extension/utils/sync-feedback.js';

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
