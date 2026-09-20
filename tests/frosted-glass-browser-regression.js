// Run this async function through the existing isolated Playwright regression runner.
// It uses a fresh Chrome profile and an intercepted video page; no server or user data.
async (page) => {
  const directory = '/Users/qianruimin/movie-notes/design-preview/v1.8.1/';
  const context = await page.context().browser().browserType().launchPersistentContext('/private/tmp/aside-glass-' + Date.now(), {
    headless: true, viewport: { width: 1280, height: 880 }, colorScheme: 'dark',
    executablePath: '/Users/qianruimin/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    args: ['--disable-extensions-except=/Users/qianruimin/movie-notes/movie-notes-extension', '--load-extension=/Users/qianruimin/movie-notes/movie-notes-extension']
  });
  const check = (value, message) => { if (!value) throw new Error(message); };
  const errors = [], screenshots = [], passed = [];
  let tab, stage = 'initialize';
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = await worker.evaluate(() => chrome.runtime.id);
    await worker.evaluate(() => chrome.storage.local.set({ uiTheme: 'dark', movieNotes: [
      { id: 'glass-fixture', movieTitle: '看见与记录：灵感从哪里开始', videoUrl: 'https://www.youtube.com/watch?v=glassfixture', createdAt: '2026-09-18T08:00:00Z', entries: [
        { id: 'note-a', content: '先留下触动自己的这一刻，细节可以稍后补充。', timestamp: 52, timestampType: 'point', formattedTimestamp: '00:52', tags: ['灵感'], createdAt: '2026-09-18T08:00:00Z' }
      ] },
      { id: 'film-fixture', movieTitle: '拾穗者与我：重新发现日常', videoUrl: 'https://www.youtube.com/watch?v=filmfixture', createdAt: '2026-09-17T08:00:00Z', entries: [
        { id: 'note-b', content: '观察，是创作的开始。', timestamp: 754, timestampType: 'point', formattedTimestamp: '12:34', tags: ['电影'], createdAt: '2026-09-17T08:00:00Z' }
      ] }
    ] }));
    await context.route('https://*.supabase.co/**', route => route.abort());
    await context.route('https://www.youtube.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html>
      <html><head><meta charset="utf-8"><title>看见与记录：灵感从哪里开始</title><style>
        *{box-sizing:border-box}html,body{margin:0;min-height:100%;font:16px system-ui;color:#fff}
        body{--ground:#b87550;--shape:#f1b86b;background:var(--ground)}body[data-palette="cool"]{--ground:#316e9a;--shape:#60b7c4}
        .art{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:0;background:var(--ground)}
        .art:before{content:"";position:absolute;width:650px;height:1000px;top:-220px;right:70px;transform:rotate(-30deg);border-radius:50%;background:var(--shape)}
        .art:after{content:"";position:absolute;width:490px;height:490px;right:-170px;bottom:-210px;border-radius:50%;background:#697589}
        #glass-probe{position:fixed;top:0;right:0;width:660px;height:100vh;pointer-events:none;background:repeating-linear-gradient(90deg,#ffffff80 0 12px,#00000038 12px 24px);z-index:0}
        header,main{position:relative;z-index:1;max-width:610px;margin-left:32px}header{padding:26px 0 24px;letter-spacing:3px;border-bottom:1px solid #ffffff50}
        main{padding-top:26px}video{display:block;width:560px;height:315px;object-fit:cover;border-radius:12px;background:#533b58}
        h1{font-size:24px;font-weight:500;line-height:1.5;margin:24px 0 10px}p{line-height:1.8;color:#fffdf5d0;max-width:490px}button{padding:8px 12px;border:1px solid #ffffff66;border-radius:8px;background:#ffffff14;color:white}
      </style></head><body data-palette="warm"><div class="art"></div><div id="glass-probe"></div><header>ASIDE / 看见与记录</header><main>
      <video autoplay muted playsinline></video><h1>灵感，发生在停下来的那一刻。</h1><p>一段访谈，一次观察。把值得记住的观点留在视频里的原点。</p><button id="outside">视频页面</button><div class="ytp-caption-segment">观察，是创作的开始。</div></main>
      <script>const c=document.createElement('canvas');c.width=1120;c.height=630;const x=c.getContext('2d');
      function draw(){x.fillStyle='#645773';x.fillRect(0,0,1120,630);x.fillStyle='#bea6b2';x.beginPath();x.ellipse(305,450,205,320,-.4,0,Math.PI*2);x.fill();x.fillStyle='#e3caaa';x.beginPath();x.ellipse(820,50,260,390,.7,0,Math.PI*2);x.fill();x.fillStyle='#fcf5e9';x.font='44px sans-serif';x.fillText('看见，才有新的开始。',110,300)}
      draw();document.querySelector('video').srcObject=c.captureStream(5);setInterval(draw,200);</script></body></html>` }));
    tab = await context.newPage(); tab.on('pageerror', error => errors.push(error.message));
    await tab.goto('https://www.youtube.com/watch?v=glassfixture');
    await tab.locator('.mn-float-btn').waitFor();
    await tab.waitForFunction(() => document.querySelector('video').readyState >= 2 && !document.querySelector('video').paused);
    const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.youtube.com/*' }))[0].id);
    const send = message => worker.evaluate(async ({ tabId, message }) => chrome.tabs.sendMessage(tabId, message, { frameId: 0 }), { tabId, message });
    const settle = () => tab.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const palette = async name => { await tab.evaluate(name => { document.body.dataset.palette = name; }, name); await settle(); };
    const snap = async name => { const path = directory + name + '.png'; await tab.screenshot({ path, animations: 'disabled' }); screenshots.push(path); };
    const clipShot = async (name, clip) => { const path = directory + name + '.png'; const buffer = await tab.screenshot({ path, clip, animations: 'disabled' }); screenshots.push(path); return buffer.toString('base64'); };
    const comparePixels = async (first, second, raw) => {
      // Screenshots, not DOM colors, prove the background contributes to the rendered glass.
      const decoder = await context.newPage();
      try {
        return await decoder.evaluate(async ({ first, second, raw }) => {
          const pixels = async encoded => { const img = new Image(); img.src = 'data:image/png;base64,' + encoded; await img.decode(); const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height; const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0); return { data: ctx.getImageData(0, 0, img.width, img.height).data, width: img.width, height: img.height }; };
          const a = await pixels(first), b = await pixels(second), original = raw ? await pixels(raw) : null;
          let difference = 0; for (let i = 0; i < a.data.length; i += 4) for (let c = 0; c < 3; c++) difference += Math.abs(a.data[i+c] - b.data[i+c]);
          const edgeEnergy = image => { let energy = 0, count = 0; for (let y = 0; y < image.height; y++) for (let x = 1; x < image.width; x++) { const offset = (y * image.width + x) * 4; for (let c = 0; c < 3; c++) { energy += Math.abs(image.data[offset+c] - image.data[offset-4+c]); count++; } } return energy / count; };
          return { meanRGBDifference: difference / (a.width * a.height * 3), glassHorizontalEdgeEnergy: edgeEnergy(a), rawHorizontalEdgeEnergy: original ? edgeEnergy(original) : null, width: a.width, height: a.height };
        }, { first, second, raw });
      } finally { await decoder.close(); await tab.bringToFront(); }
    };

    stage = 'dark library compositing';
    check((await send({ type: 'MN_TOGGLE_LIBRARY', tabId })).success, 'library did not open');
    const host = tab.locator('#aside-library-host'), frame = tab.frameLocator('#aside-library-host iframe');
    await frame.locator('.movie-card').first().waitFor();
    check(await tab.locator('.mn-float-btn').isHidden(), 'ball and library compete');
    check(!await tab.locator('video').evaluate(video => video.paused), 'library paused playback');
    const backgrounds = await frame.locator('html').evaluate(html => ['html', 'body', '.app'].map(selector => ({ selector, background: getComputedStyle(document.querySelector(selector)).backgroundColor })));
    check(backgrounds.every(item => item.background === 'rgba(0, 0, 0, 0)'), 'embedded layers still paint a solid surface: ' + JSON.stringify(backgrounds));
    const hostStyle = () => host.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, blur: getComputedStyle(element).backdropFilter }));
    const darkStyle = await hostStyle(); check(darkStyle.blur.includes('blur('), 'host has no backdrop filter');
    const box = await host.boundingBox();
    const libraryClip = { x: Math.ceil(box.x + 34), y: Math.ceil(box.y + box.height - 130), width: Math.floor(box.width - 68), height: 38 };
    await palette('warm'); const libraryWarm = await clipShot('probe-library-warm', libraryClip); await snap('01-overlay-warm-probe');
    await host.evaluate(element => { element.style.setProperty('visibility', 'hidden', 'important'); });
    const rawWarm = await clipShot('probe-source-warm', libraryClip);
    await host.evaluate(element => { element.style.removeProperty('visibility'); });
    await palette('cool'); const libraryCool = await clipShot('probe-library-cool', libraryClip); await snap('02-overlay-cool-probe');
    const libraryPixels = await comparePixels(libraryWarm, libraryCool, rawWarm);
    check(libraryPixels.meanRGBDifference > 8, 'glass does not respond visibly to page color: ' + JSON.stringify(libraryPixels));
    const hostAlpha = darkStyle.background.startsWith('rgba(') ? Number(darkStyle.background.slice(5, -1).split(',').pop()) : 1;
    const transmission = 1 - hostAlpha;
    check(transmission > .05 && libraryPixels.rawHorizontalEdgeEnergy > 1, 'blur probe has insufficient transmission or source detail');
    // A tint alone scales source edges by transmission. Normalize that attenuation
    // before assessing blur, so a 68%-opaque solid tint cannot pass this test.
    libraryPixels.hostTransmission = transmission;
    libraryPixels.normalizedEdgeRatio = libraryPixels.glassHorizontalEdgeEnergy / (libraryPixels.rawHorizontalEdgeEnergy * transmission);
    check(libraryPixels.normalizedEdgeRatio < .25, 'tint reduces contrast but does not sufficiently blur source detail: ' + JSON.stringify(libraryPixels));
    passed.push('real page colors contribute to library pixels', 'sharp source stripes become blurred behind library');
    await tab.locator('#glass-probe').evaluate(element => { element.hidden = true; }); await palette('warm'); await snap('03-overlay-dark');

    stage = 'theme synchronization';
    await frame.locator('#themeToggle').click();
    await tab.waitForFunction(previous => getComputedStyle(document.querySelector('#aside-library-host')).backgroundColor !== previous, darkStyle.background);
    const lightStyle = await hostStyle();
    check(await frame.locator('html').getAttribute('data-theme') === 'light', 'panel did not switch to light');
    check((await worker.evaluate(() => chrome.storage.local.get('uiTheme'))).uiTheme === 'light', 'theme did not persist');
    await snap('04-overlay-light');
    await frame.locator('#themeToggle').click();
    await tab.waitForFunction(expected => getComputedStyle(document.querySelector('#aside-library-host')).backgroundColor === expected, darkStyle.background);
    await frame.locator('.movie-card__toggle').first().click(); await snap('05-overlay-expanded');
    check(await frame.locator('.note-preview img,.note-preview .entry-card__share').count() === 0, 'compact preview unexpectedly includes media/sharing');
    passed.push('light/dark theme updates both extension iframe and host');

    stage = 'quick recording compositing and draft';
    await send({ type: 'MN_KEYBOARD_COMMAND', command: 'quick-note' });
    const quick = tab.locator('.mn-qn'), textarea = quick.locator('textarea'); await textarea.waitFor();
    check(await host.isHidden(), 'library remains open with quick recording');
    check(await tab.locator('video').evaluate(video => video.paused), 'quick recording did not pause playback');
    await textarea.fill('让画面留在玻璃之后，让想法留在记录里。');
    await tab.locator('#glass-probe').evaluate(element => { element.hidden = false; });
    const fieldBox = await textarea.boundingBox();
    const quickClip = { x: Math.ceil(fieldBox.x + 16), y: Math.ceil(fieldBox.y + fieldBox.height - 50), width: Math.floor(fieldBox.width - 32), height: 24 };
    await palette('warm'); const quickWarm = await clipShot('probe-quick-warm', quickClip);
    await palette('cool'); const quickCool = await clipShot('probe-quick-cool', quickClip);
    const quickPixels = await comparePixels(quickWarm, quickCool);
    check(quickPixels.meanRGBDifference > 6, 'quick recording is opaque over changing page colors: ' + JSON.stringify(quickPixels));
    await tab.locator('#glass-probe').evaluate(element => { element.hidden = true; }); await palette('warm'); await snap('06-quick-dark');
    const quickDarkBackground = await quick.evaluate(element => getComputedStyle(element).backgroundColor);
    await worker.evaluate(() => chrome.storage.local.set({ uiTheme: 'light' }));
    await tab.waitForFunction(previous => getComputedStyle(document.querySelector('.mn-qn')).backgroundColor !== previous, quickDarkBackground);
    check(await frame.locator('html').getAttribute('data-theme') === 'light', 'hidden library did not synchronize theme');
    await snap('06b-quick-light');
    await worker.evaluate(() => chrome.storage.local.set({ uiTheme: 'dark' }));
    await tab.waitForFunction(expected => getComputedStyle(document.querySelector('.mn-qn')).backgroundColor === expected, quickDarkBackground);
    await tab.keyboard.press('Escape'); await quick.waitFor({ state: 'detached' });
    await send({ type: 'MN_KEYBOARD_COMMAND', command: 'quick-note' }); await textarea.waitFor();
    check(await textarea.inputValue() === '让画面留在玻璃之后，让想法留在记录里。', 'closing glass composer lost draft');
    await quick.locator('[data-act="save"]').click(); await quick.waitFor({ state: 'detached' });
    const saved = await worker.evaluate(() => chrome.storage.local.get('aside:guest:movieNotes'));
    check(saved['aside:guest:movieNotes'].flatMap(note => note.entries).some(entry => entry.content === '让画面留在玻璃之后，让想法留在记录里。'), 'recording did not reach real extension storage');
    check(!await tab.locator('video').evaluate(video => video.paused), 'save did not restore playback');
    passed.push('quick recording pixels sample page colors', 'theme synchronizes open quick recording and hidden library', 'draft survives Escape and reopens', 'save persists and resumes playback');

    stage = 'full-page glass';
    await send({ type: 'MN_TOGGLE_LIBRARY', tabId }); await host.waitFor();
    const newPage = context.waitForEvent('page'); await frame.locator('#btnOpenFull').click(); const full = await newPage;
    await full.locator('.movie-card').first().waitFor();
    check(full.url().includes('sourceTab=' + tabId), 'full page lost video source');
    const fullPath = directory + '07-full-library.png'; await full.screenshot({ path: fullPath, animations: 'disabled' }); screenshots.push(fullPath);
    passed.push('full-page library retains bound video');
    check(!errors.length, errors.join('\n'));
    return { passed, extensionId, darkStyle, lightStyle, libraryPixels, quickPixels, libraryClip, quickClip, screenshots, pageErrors: errors };
  } catch (error) {
    if (tab) await tab.screenshot({ path: directory + 'glass-debug.png' }).catch(() => {});
    throw new Error(stage + ': ' + error.message + '\n' + errors.join('\n'));
  } finally { await context.close(); }
}
