async (page) => {
  const context = await page.context().browser().newContext();
  const tab = await context.newPage();
  const errors = [];
  tab.on('pageerror', e => errors.push(e.message));
  const source = await (await page.request.get('http://127.0.0.1:8765/content.js')).text();
  const check = (value, message) => { if (!value) throw new Error(message); };
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>fixture</title></head><body><video style="width:800px;height:450px"></video><div class="ytp-caption-segment">这是一句字幕</div><button id="outside">页面其他位置</button></body></html>';
  await context.route('https://www.youtube.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await context.addInitScript(() => {
    let paused = false;
    const v = document.querySelector('video');
    window.fixtureSaves = 0;
    const read = () => JSON.parse(localStorage.getItem('fixtureDraft') || 'null');
    const storage = {
      async get(keys) { return {}; }, async set() {}, async remove() {}
    };
    window.chrome = { storage: { local: storage, session: storage }, runtime: {
      onMessage: { addListener() {} },
      sendMessage(payload, callback) {
        let result = { success: true };
        if (payload.type === 'MN_GET_QUICK_DRAFT') result = { success: true, owner: 'guest', draft: read() };
        if (payload.type === 'MN_PUT_QUICK_DRAFT') localStorage.setItem('fixtureDraft', JSON.stringify({ text: payload.text, meta: { ...read()?.meta, ...payload.meta } }));
        if (payload.type === 'MN_CLEAR_QUICK_DRAFT') localStorage.removeItem('fixtureDraft');
        if (payload.type === 'MN_SAVE_QUICK_NOTE') { window.fixtureSaves++; window.savedPayload = payload; }
        if (callback) setTimeout(() => callback(result), payload.type === 'MN_SAVE_QUICK_NOTE' ? 150 : 0);
        else return Promise.resolve(result);
      }
    }};
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', { get: () => paused });
    HTMLMediaElement.prototype.pause = () => { paused = true; };
    HTMLMediaElement.prototype.play = () => { paused = false; return Promise.resolve(); };
  });
  const load = async () => {
    await tab.goto('https://www.youtube.com/watch?v=fixture');
    await tab.evaluate(() => { document.title = '<img src=x onerror="window.injected=1"> 长标题'.repeat(8); document.querySelector('video').currentTime = 52; });
    await tab.addScriptTag({ content: source });
  };
  try {
    await load();
    await tab.keyboard.press('Alt+n');
    const ta = tab.locator('.mn-qn textarea');
    await ta.waitFor();
    check(await tab.locator('.mn-qn__ctx img').count() === 0, 'page title interpreted as HTML');
    check((await tab.locator('.mn-qn__time').textContent()).includes('00:52'), 'timestamp missing');
    await ta.fill('刷新后也应该保留的草稿');
    await tab.keyboard.press('Escape');
    await tab.locator('.mn-qn').waitFor({ state: 'detached' });
    check(await tab.evaluate(() => !document.querySelector('video').paused), 'original playback not resumed');
    await load();
    await tab.evaluate(() => { document.querySelector('video').currentTime = 200; });
    await tab.keyboard.press('Alt+n');
    await ta.waitFor();
    check(await ta.inputValue() === '刷新后也应该保留的草稿', 'draft was lost on refresh');
    check((await tab.locator('.mn-qn__time').textContent()).includes('00:52'), 'draft time changed on restore');
    await tab.keyboard.press('Alt+s');
    check((await ta.inputValue()).includes('这是一句字幕'), 'subtitle insertion failed');
    await tab.locator('#outside').click();
    await tab.locator('.mn-qn').waitFor({ state: 'detached' });
    await tab.keyboard.press('Alt+n');
    await ta.waitFor();
    check((await ta.inputValue()).includes('这是一句字幕'), 'outside click lost draft');
    await tab.evaluate(() => {
      for (let i = 0; i < 6; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', altKey: true, bubbles: true }));
    });
    await tab.locator('.mn-qn').waitFor({ state: 'detached' });
    check(await tab.evaluate(() => window.fixtureSaves) === 1, 'rapid hotkeys created duplicates');
    check(await tab.evaluate(() => localStorage.getItem('fixtureDraft')) === null, 'successful save retained draft');
    check(errors.length === 0, errors.join('\n'));
    return { passed: ['literal title rendering', 'timestamp visible', 'Escape preserves draft and resumes playback', 'refresh restores text and original timestamp', 'subtitle insertion', 'outside click preserves draft', 'rapid-save deduplication', 'saved draft cleanup'], pageErrors: errors };
  } finally { await context.close(); }
}
