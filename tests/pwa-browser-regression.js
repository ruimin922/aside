async (page) => {
  const context = await page.context().browser().newContext({ serviceWorkers: 'block' });
  const tab = await context.newPage();
  const errors = [];
  tab.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', r => {
    const url = r.request().url();
    if (url.startsWith('http://127.0.0.1:8765/')) return r.continue();
    if (url.includes('supabase.min.js')) return r.fulfill({ contentType: 'text/javascript', body: '' });
    return r.abort();
  });
  await context.addInitScript(() => {
    const uid = 'A';
    const user = { id: uid, email: 'fixture@example.test' };
    const rows = {
      movies: [{ id: 'm', user_id: uid, movie_title: '移动端回归测试', tags: [], video_url: 'https://www.youtube.com/watch?v=fixture', created_at: '2026-01-01', updated_at: '2026-01-01', deleted_at: null }],
      entries: [
        { id: 'e', movie_id: 'm', user_id: uid, content: '可见笔记', tags: [], video_url: 'https://www.youtube.com/watch?v=fixture', timestamp_sec: 52, formatted_timestamp: '00:52', created_at: '2026-01-01', deleted_at: null, thumbnail: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF5kAAAAASUVORK5CYII=' },
        { id: 'deleted', movie_id: 'm', user_id: uid, content: '已删除内容不应出现', created_at: '2026-01-01', deleted_at: '2026-02-01' }
      ]
    };
    class Query {
      constructor(table) { this.rows = rows[table].slice(); }
      select() { return this; }
      eq(k,v) { this.rows = this.rows.filter(r => r[k] === v); return this; }
      is(k,v) { this.rows = this.rows.filter(r => r[k] === v); return this; }
      order() { return this; }
      range(a,b) { this.rows = this.rows.slice(a,b+1); return this; }
      then(resolve,reject) { return Promise.resolve({ data: this.rows, error: null }).then(resolve,reject); }
    }
    window.supabase = { createClient: () => ({
      from: table => new Query(table),
      auth: {
        getSession: async () => ({ data: { session: { user } } }),
        onAuthStateChange: callback => { window.switchMockAccount = callback; },
        signOut: async () => {}
      }
    }) };
  });
  try {
    await tab.goto('http://127.0.0.1:8765/movie-notes-pwa/index.html');
    await tab.locator('.movie-card').filter({ hasText: '移动端回归测试' }).click();
    await tab.getByText('可见笔记', { exact: true }).waitFor();
    if (await tab.getByText('已删除内容不应出现').count()) throw new Error('deleted entry is visible');
    await tab.locator('.entry-preview').waitFor();
    const jump = await tab.locator('.entry-jump').getAttribute('data-url');
    if (!jump.includes('t=52')) throw new Error('timestamp lost in deep link');
    await tab.evaluate(() => window.switchMockAccount('SIGNED_OUT', null));
    if (await tab.locator('#entryList').textContent()) throw new Error('previous account detail retained');
    if (errors.length) throw new Error(errors.join('\n'));
    return { passed: ['PWA initialization and movie list', 'deleted entry filtering', 'cloud thumbnail rendering', 'timestamped return link', 'account switch clears details'], pageErrors: errors };
  } finally { await context.close(); }
}
