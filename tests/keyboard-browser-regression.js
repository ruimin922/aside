async (page) => {
  const context=await page.context().browser().browserType().launchPersistentContext('/private/tmp/aside-keyboard-'+Date.now(),{
    headless:true, viewport:{width:1280,height:880},colorScheme:'light',
    executablePath:'/Users/qianruimin/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    args:['--disable-extensions-except=/Users/qianruimin/movie-notes/movie-notes-extension','--load-extension=/Users/qianruimin/movie-notes/movie-notes-extension']
  });
  const check=(v,m)=>{if(!v)throw Error(m);};const errors=[];let tab;let stage="init";
  try{
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    worker.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    const extensionId=await worker.evaluate(()=>chrome.runtime.id);
    const shortcuts=await worker.evaluate(()=>chrome.commands.getAll());check(shortcuts.length===2 && shortcuts.every(s=>s.shortcut),'native shortcuts did not register');
    await worker.evaluate(()=>chrome.storage.local.set({movieNotes:[{id:'seed',movieTitle:'访谈：从观察开始，形成自己的判断',videoUrl:'https://www.youtube.com/watch?v=fixture',createdAt:new Date().toISOString(),entries:[{id:'seed-entry',content:'先记下自己被触动的那一刻，再慢慢整理它的意义。',timestamp:52,timestampType:'point',formattedTimestamp:'00:52',tags:['思考'],createdAt:new Date().toISOString()}]}]}));
    await context.route('https://www.youtube.com/**',r=>r.fulfill({status:200,contentType:'text/html',body:`<!doctype html><html><head><meta charset="utf-8"><title>访谈：从观察开始，形成自己的判断</title><style>body{margin:0;background:#101713;color:#eee;font:16px system-ui}header{padding:26px 40px;border-bottom:1px solid #ffffff22;letter-spacing:3px}main{margin:32px 40px}video{width:1040px;height:585px;background:#1c2b22}h1{font-size:24px;font-weight:500}p{color:#9aab9c}</style></head><body><header>VIDEO / 访谈</header><main><video autoplay muted playsinline></video><h1>从观察开始，形成自己的判断</h1><p>用于验证悬浮窗口的视频测试页面</p><button id="outside">页面按钮</button><div class="ytp-caption-segment">从一个好的问题开始。</div></main><script>const c=document.createElement('canvas');c.width=1040;c.height=585;const x=c.getContext('2d');x.fillStyle='#203328';x.fillRect(0,0,1040,585);x.fillStyle='#abc2ad';x.font='26px sans-serif';x.fillText('一次对话，一个新的视角。',65,310);document.querySelector('video').srcObject=c.captureStream(5);setInterval(()=>{x.fillRect(0,0,1,1)},100);</script></body></html>`}));
    await context.route('https://*.supabase.co/**',r=>r.abort());
    tab=await context.newPage();tab.on('pageerror',e=>errors.push(e.message));
    await tab.goto('https://www.youtube.com/watch?v=fixture');
    await tab.locator('.mn-float-btn').waitFor();
    const tabId=await worker.evaluate(async()=> (await chrome.tabs.query({url:'https://www.youtube.com/*'}))[0].id);
    const send=msg=>worker.evaluate(async({tabId,msg})=>chrome.tabs.sendMessage(tabId,msg,{frameId:0}),{tabId,msg});

    const registered = Object.fromEntries(shortcuts.map(s=>[s.name,s.shortcut]));
    check(/L/.test(registered._execute_action) && /N/.test(registered['quick-note']), 'wrong default bindings');
    stage='quick-focus';
    await send({type:'MN_KEYBOARD_COMMAND',command:'quick-note'});
    const ta=tab.locator('.mn-qn textarea');await ta.waitFor();
    check(await ta.evaluate(e=>e===document.activeElement),'quick editor not focused');
    await ta.fill('前后');await ta.evaluate(e=>e.setSelectionRange(1,1));
    await tab.keyboard.press('Alt+s');
    check(await ta.inputValue()==='前「从一个好的问题开始。」后','subtitle not inserted at caret');
    await tab.locator('.ytp-caption-segment').evaluate(e=>e.textContent='');await tab.keyboard.press('Alt+s');
    check((await tab.locator('.mn-qn__msg').textContent()).includes('未检测到字幕'),'missing subtitle silent');
    check(await ta.inputValue()==='前「从一个好的问题开始。」后','missing subtitle changed text');
    await tab.locator('.ytp-caption-segment').evaluate(e=>e.textContent='从一个好的问题开始。');
    await send({type:'MN_KEYBOARD_COMMAND',command:'quick-note'});
    check(await ta.isEnabled() && await ta.inputValue()==='前「从一个好的问题开始。」后','repeated quick-note submitted');
    const setTime=seconds=>worker.evaluate(({tabId,seconds})=>chrome.scripting.executeScript({target:{tabId},func:seconds=>{Object.defineProperty(document.querySelector('video'),'currentTime',{configurable:true,get:()=>seconds,set:()=>{}});},args:[seconds]}),{tabId,seconds});
    stage='quick-time';await setTime(83);await tab.keyboard.press('Alt+t');
    await tab.locator('.mn-qn__time').filter({hasText:'01:23'}).waitFor();
    await ta.evaluate(e=>{
      e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
      e.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true}));
      e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',metaKey:true,isComposing:true,bubbles:true}));
      e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));
    });check(await ta.isEnabled(),'IME caused save or close');
    const savedBefore=await worker.evaluate(async()=>(await chrome.storage.local.get('aside:guest:movieNotes'))['aside:guest:movieNotes'].flatMap(n=>n.entries).length);
    check(savedBefore===1,'repeat invocation saved');
    await tab.locator('.mn-qn [data-act="save"]').focus();await tab.keyboard.press('Tab');
    check(await tab.locator('.mn-qn__library').evaluate(e=>e===document.activeElement),'quick tab escaped');
    await tab.keyboard.press('Shift+Tab');check(await tab.locator('.mn-qn [data-act="save"]').evaluate(e=>e===document.activeElement),'quick reverse tab escaped');
    stage='save-from-button';await tab.locator('.mn-qn [data-act="subtitle"]').focus();await tab.keyboard.press('Meta+Enter');
    await tab.locator('.mn-qn').waitFor({state:'detached'});
    check(await tab.locator('video').evaluate(e=>e===document.activeElement && !e.paused),'save did not restore player focus/playback');
    const notes=await worker.evaluate(async()=>(await chrome.storage.local.get('aside:guest:movieNotes'))['aside:guest:movieNotes']);
    check(notes.flatMap(n=>n.entries).some(e=>e.timestamp===83 && e.content==='前「从一个好的问题开始。」后'),'timestamp/subtitle missing in saved note');
    stage='draft-time';await setTime(98);await send({type:'MN_KEYBOARD_COMMAND',command:'quick-note'});await ta.waitFor();await ta.fill('不要覆盖草稿的时间');await tab.keyboard.press('Escape');await ta.waitFor({state:'detached'});
    await setTime(140);await send({type:'MN_KEYBOARD_COMMAND',command:'quick-note'});await ta.waitFor();
    check(await ta.inputValue()==='不要覆盖草稿的时间','draft not restored');
    check((await tab.locator('.mn-qn__time').textContent()).includes('01:38'),'draft timestamp overwritten by reopen');
    await tab.screenshot({path:'/Users/qianruimin/movie-notes/design-preview/14-keyboard-quick-note.png'});
    await tab.keyboard.press('Escape');await ta.waitFor({state:'detached'});
    stage='library-navigation';await send({type:'MN_TOGGLE_LIBRARY',tabId});
    const host=tab.locator('#aside-library-host'), frame=tab.frameLocator('#aside-library-host iframe');await frame.locator('.movie-card').waitFor();
    await frame.locator('#tabList').focus();await tab.keyboard.press('s');await frame.locator('#viewStats.view--active').waitFor();
    await tab.keyboard.press('l');await frame.locator('#viewList.view--active').waitFor();await tab.keyboard.press('/');
    check(await frame.locator('#searchInput').evaluate(e=>e===document.activeElement),'search did not focus');
    await tab.keyboard.type('nsl');check(await frame.locator('#searchInput').inputValue()==='nsl','single keys stole search input');await frame.locator('#searchInput').fill('');await frame.locator('.movie-card__toggle').waitFor();
    await tab.keyboard.press('ArrowDown');check(await frame.locator('.movie-card__toggle').evaluate(e=>e===document.activeElement),'search down did not enter results');await tab.keyboard.press('Enter');check(await frame.locator('.movie-card__toggle').getAttribute('aria-expanded')==='true','Enter did not expand');await tab.keyboard.press('ArrowLeft');check(await frame.locator('.movie-card__toggle').getAttribute('aria-expanded')==='false','left did not collapse');
    await frame.locator('#tabSettings').focus();await tab.keyboard.press('Tab');check(await frame.locator('#btnOpenFull').evaluate(e=>e===document.activeElement),'panel tab escaped');
    const newPagePromise=context.waitForEvent('page');await tab.keyboard.press('Enter');const full=await newPagePromise;await full.locator('.movie-card').waitFor();
    stage='full-editor';await full.locator('#tabList').focus();await full.keyboard.press('n');await full.locator('#viewNew.view--active').waitFor();
    check(await full.locator('#entryContent').evaluate(e=>e===document.activeElement),'N did not focus new note');
    await full.locator('#entryContent').fill('AB');await full.locator('#entryContent').evaluate(e=>e.setSelectionRange(1,1));await full.keyboard.press('Alt+s');
    await full.waitForFunction(()=>document.getElementById('entryContent').value==='A「从一个好的问题开始。」B');
    await full.keyboard.press('Alt+t');await full.waitForFunction(()=>document.getElementById('stampPointInput').value==='02:20');
    await full.locator('#modeRange').focus();await full.keyboard.press('Enter');await full.locator('#stampEndInput').focus();await full.keyboard.press('Alt+t');
    await full.waitForFunction(()=>document.getElementById('stampEndInput').value==='02:20');
    check(await full.locator('#stampStartInput').inputValue()==='', 'range shortcut overwrote the other endpoint');
    await full.locator('#modePoint').focus();await full.keyboard.press('Enter');
    await full.screenshot({path:'/Users/qianruimin/movie-notes/design-preview/15-keyboard-editor.png'});
    await full.locator('#entryContent').fill('n s l / ? 都是文字');check(await full.locator('#viewNew.view--active').count()===1,'typing navigated away');
    stage='full-draft';await full.keyboard.press('Escape');await full.locator('#viewList.view--active').waitFor();
    const draft=await worker.evaluate(()=>chrome.storage.local.get(null));check(JSON.stringify(draft).includes('n s l / ? 都是文字'),'Escape discarded draft');
    await full.keyboard.press('s');await full.locator('#viewStats.view--active').waitFor();await full.keyboard.press('l');await full.locator('#viewList.view--active').waitFor();
    check(!errors.length,errors.join('\n'));
    return {passed:['Alt+L / Alt+N registered; editor keys not registered globally','repeat Alt+N only focuses','subtitle inserted at caret','timestamp update persists','missing subtitles give feedback without altering text','range timestamp updates focused endpoint','IME does not save/close','Tab and reverse Tab contained','save works from button focus','save restores playback and player focus','reopening draft preserves original time','N/S/L and search navigation','single letters do not steal typed text','keyboard list expansion/collapse','full editor subtitles and timestamps','Escape preserves draft'],pageErrors:errors};
  }catch(e){if(tab)await tab.screenshot({path:'/Users/qianruimin/movie-notes/design-preview/keyboard-debug.png'});throw new Error(stage+': '+e.message+'\n'+errors.join('\n'));}
  finally{await context.close();}
}
