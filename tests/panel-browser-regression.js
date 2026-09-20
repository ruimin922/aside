async (page) => {
  const context = await page.context().browser().newContext();
  const tab = await context.newPage();
  const errors = [];
  tab.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', r => r.request().url().startsWith('http://127.0.0.1:8765/') ? r.continue() : r.abort());
  await context.addInitScript(() => {
    const listeners = [];
    const read = () => JSON.parse(localStorage.getItem('mockStorage') || '{"movieNotes":[{"id":"movie1","movieTitle":"回归测试影片","videoUrl":"https://www.youtube.com/watch?v=fixture","tags":["电影"],"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","entries":[{"id":"entry1","content":"待删除的测试笔记","createdAt":"2026-01-01T00:00:00Z","timestamp":52,"formattedTimestamp":"00:52"}]}]}');
    const store = {
      async get(keys, callback) {
        const all = read();
        const result = keys === null ? all : Object.fromEntries([].concat(keys).map(k => [k, all[k]]));
        callback?.(result); return result;
      },
      async set(values) {
        const all = read(), changes = {};
        for (const [k,v] of Object.entries(values)) changes[k] = { oldValue: all[k], newValue: v };
        localStorage.setItem('mockStorage', JSON.stringify({ ...all, ...values }));
        for (const fn of listeners) fn(changes, 'local');
      },
      async remove(keys) { const all = read(); for (const k of [].concat(keys)) delete all[k]; localStorage.setItem('mockStorage', JSON.stringify(all)); }
    };
    window.chrome = {
      storage: { local: store, session: { get: async (key, cb) => { cb?.({}); return {}; }, remove: async()=>{} }, onChanged: { addListener: fn => listeners.push(fn) } },
      tabs: { query: async () => [], create: async () => {} }, runtime: { getURL: path => path }
    };
  });
  try {
    await tab.goto('http://127.0.0.1:8765/movie-notes-extension/panel.html');
    await tab.locator('.movie-card').filter({ hasText: '回归测试影片' }).locator('.movie-card__detail').click();
    await tab.locator('#detailEntries').getByText('待删除的测试笔记', { exact: true }).waitFor();
    await tab.locator('#btnAddMoreTop').click();
    await tab.locator('#entryContent').fill('详情页追加的整体记录');
    await tab.locator('#btnSave').click();
    await tab.locator('.movie-card').filter({ hasText: '回归测试影片' }).locator('.movie-card__detail').click();
    await tab.locator('#detailEntries').getByText('详情页追加的整体记录', { exact: true }).waitFor();
    await tab.locator('.entry-card').filter({ hasText: '待删除的测试笔记' }).locator('.entry-card__del').click();
    await tab.locator('#confirmModalOk').click();
    await tab.locator('#detailEntries').getByText('待删除的测试笔记', { exact: true }).waitFor({ state: 'detached' });
    const saved = await tab.evaluate(() => JSON.parse(localStorage.getItem('mockStorage'))['aside:guest:movieNotes'][0]);
    if (saved.entries.length !== 1 || !saved.deletedEntries.entry1 || !saved.syncDirty) throw new Error('delete was not durably queued');
    if (errors.length) throw new Error(errors.join('\n'));
    return { passed: ['module imports and panel initialization', 'legacy library migration', 'detail display', 'append review to existing movie without active video', 'confirmed deletion updates UI and leaves durable tombstone'], pageErrors: errors };
  } finally { await context.close(); }
}
