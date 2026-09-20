async (page) => {
  const context=await page.context().browser().browserType().launchPersistentContext('/private/tmp/aside-extension-design-'+Date.now(),{
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
    check((await send({type:'MN_TOGGLE_LIBRARY',tabId})).success,'host failed to open');
    const host=tab.locator('#aside-library-host');await host.waitFor();
    const frame=tab.frameLocator('#aside-library-host iframe');
    await frame.locator('.movie-card').waitFor();
    check(await tab.locator('.mn-float-btn').isHidden(),'ball competes with library');
    check(!await tab.locator('video').evaluate(v=>v.paused),'library paused video');
    await frame.locator('.movie-card__toggle').click();
    await tab.screenshot({path:'/Users/qianruimin/movie-notes/design-preview/08-real-overlay.png'});
    await tab.locator('#outside').click();check(await host.isVisible(),'outside click closed library');
    const before=await host.boundingBox();const grip=host.locator('.grip');await grip.focus();await tab.keyboard.press('ArrowLeft');const after=await host.boundingBox();check(after.x<before.x,'keyboard drag failed');
    const gr=await grip.boundingBox();await tab.mouse.move(gr.x+gr.width/2,gr.y+gr.height/2);await tab.mouse.down();await tab.mouse.move(gr.x+gr.width/2-80,gr.y+80);await tab.mouse.up();check((await host.boundingBox()).y>after.y,'pointer drag failed');
    await frame.locator('#tabSettings').click();await frame.locator('#viewStats.view--active').waitFor();
    await send({type:'MN_KEYBOARD_COMMAND',command:'quick-note'});await tab.locator('.mn-qn textarea').waitFor({timeout:6000});check(await host.isHidden(),'library still visible with quick composer');
    check(await tab.locator('video').evaluate(v=>v.paused),'quick composer did not pause video');
    await tab.locator('.mn-qn textarea').fill('窗口切换后，这条想法仍然在。');
    await tab.screenshot({path:'/Users/qianruimin/movie-notes/design-preview/09-real-quick-note.png'});
    await tab.locator('.mn-qn__library').click();await host.waitFor();await frame.locator('#viewList.view--active').waitFor();check(await tab.locator('.mn-qn').count()===0,'composer not closed');
    check(!await tab.locator('video').evaluate(v=>v.paused),'playback not restored');
    // Give Chrome's cross-process iframe hit-test map time to settle after hide/show at its dragged position.
    await tab.waitForTimeout(500);
    stage='close-button';await frame.locator('#btnCloseLibrary').click();await host.waitFor({state:'hidden',timeout:5000});
    stage='restore-quick-draft';await send({type:'MN_KEYBOARD_COMMAND',command:'quick-note'});await tab.locator('.mn-qn textarea').waitFor();check(await tab.locator('.mn-qn textarea').inputValue()==='窗口切换后，这条想法仍然在。','switch lost draft');
    stage='save-quick-draft';await tab.locator('.mn-qn__save-link').click();await tab.locator('.mn-qn').waitFor({state:'detached'});
    const data=await worker.evaluate(()=>chrome.storage.local.get('aside:guest:movieNotes'));check(data['aside:guest:movieNotes'].flatMap(n=>n.entries).some(e=>e.content==='窗口切换后，这条想法仍然在。'),'real extension save failed');
    stage='help-escape';await send({type:'MN_TOGGLE_LIBRARY',tabId});await host.waitFor();await frame.locator('#btnOnboardToggle').click();await frame.locator('#onboardBanner').waitFor();await tab.keyboard.press('Escape');check(await frame.locator('#onboardBanner').isHidden(),'real help Escape failed');check(await host.isVisible(),'real help Escape closed host');
    stage='second-escape';await tab.keyboard.press('Escape');await host.waitFor({state:'hidden',timeout:5000});
    await worker.evaluate(tabId=>chrome.scripting.executeScript({target:{tabId},files:['content.js']}),tabId);check(await tab.locator('.mn-float-btn').count()===1,'reinjection duplicated UI');
    await send({type:'MN_TOGGLE_LIBRARY',tabId});
    const newPagePromise=context.waitForEvent('page');await frame.locator('#btnOpenFull').click();const full=await newPagePromise;await full.waitForLoadState();await full.locator('.movie-card').first().waitFor();check(full.url().includes('sourceTab='+tabId),'full-page lost bound source');
    check(!errors.length,errors.join('\n'));
    return{passed:['real MV3 extension loaded','extension iframe has real storage access','library keeps video playing','outside clicks do not dismiss','pointer and keyboard drag','ball/library/composer exclusive','product icon returns from settings to home','real quick draft persists across switches','save reaches real service worker and storage','nested Escape closes only help','repeated injection is idempotent','independent page retains source tab'],extensionId,pageErrors:errors};
  }catch(e){if(tab)await tab.screenshot({path:'/Users/qianruimin/movie-notes/design-preview/extension-debug.png'});throw new Error(stage+': '+e.message+'\n'+errors.join('\n'));}
  finally{await context.close();}
}
