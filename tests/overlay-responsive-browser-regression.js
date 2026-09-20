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
    const observations=[];
    for(const width of [1280,360,280]) {
      await tab.setViewportSize({width,height:880});await send({type:'MN_TOGGLE_LIBRARY',tabId});
      const frame=tab.frameLocator('#aside-library-host iframe');await frame.locator('.movie-card').waitFor();
      check(await frame.locator('html').evaluate(e=>e.scrollWidth<=e.clientWidth),'iframe overflow '+width);
      const host=await tab.locator('#aside-library-host').boundingBox();check(host.x>=0&&host.x+host.width<=width,'host outside viewport '+width);
      await tab.screenshot({path:'/Users/qianruimin/movie-notes/design-preview/v1.8.0/overlay-'+width+'.png',animations:'disabled'});
      await send({type:'MN_KEYBOARD_COMMAND',command:'quick-note'});await tab.locator('.mn-qn').waitFor();
      const q=await tab.locator('.mn-qn').boundingBox();check(q.x>=0&&q.x+q.width<=width,'composer outside viewport '+width);
      check(await tab.locator('.mn-qn').evaluate(e=>e.scrollWidth<=e.clientWidth),'composer horizontal overflow '+width);
      observations.push({width,ball:await tab.locator('.mn-float-btn').evaluate(e=>({classes:e.className,bg:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color})),composerWidth:q.width});
      await tab.screenshot({path:'/Users/qianruimin/movie-notes/design-preview/v1.8.0/quick-'+width+'.png',animations:'disabled'});
      await tab.keyboard.press('Escape');await tab.locator('.mn-qn').waitFor({state:'detached'});
    }
    return {passed:['real overlay and composer at 1280/360/280 viewports, no overflow'],observations,errors};
  } finally {await context.close();}
}