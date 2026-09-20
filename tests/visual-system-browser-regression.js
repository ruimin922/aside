async (page) => {
  const ctx = await page.context().browser().newContext({viewport:{width:600,height:800}});
  const tab = await ctx.newPage(); const errors=[]; const violations=[];
  tab.on('pageerror',e=>errors.push(e.message));
  await ctx.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:8765/')?r.continue():r.abort());
  await ctx.addInitScript(()=>{
    const listeners=[];
    const date='2026-09-17T06:30:00Z';
    const defaults={'uiTheme':'dark',movieNotes:[
      {id:'interview',movieTitle:'对话盛颖：xAI、Infra 的浪漫，与开源的未来',videoUrl:'https://www.youtube.com/watch?v=interview',createdAt:date,updatedAt:date,tags:['访谈'],entries:[
        {id:'a',timestampType:'point',timestamp:754,formattedTimestamp:'12:34',content:'真正值得记录的，不只是一个结论，还有它如何改变了我原本的想法。',tags:['观点','值得重听'],createdAt:date},
        {id:'b',timestampType:'range',timestampStart:1368,timestampEnd:1395,formattedStart:'22:48',formattedEnd:'23:15',content:'开源最有意思的地方，是让不同的人围绕同一个问题，各自走出一条路。\n这也许可以成为下一次产品讨论的起点。',tags:['开源','产品灵感'],createdAt:date},
        {id:'c',timestampType:'point',timestamp:2410,formattedTimestamp:'40:10',content:'关于工具与人的关系：'+('工具带来的效率，只是开始。更重要的是我们能否因此提出不同的问题。'.repeat(7)),tags:['待实践'],createdAt:date}]},
      {id:'film',movieTitle:'拾穗者与我：在日常里，重新发现被忽略的东西',videoUrl:'https://www.bilibili.com/video/BVfixture',createdAt:date,updatedAt:date,entries:[{id:'d',content:'创作并不总是从宏大的主题出发，也可以从一次弯腰、一个被丢掉的土豆开始。',tags:['电影','创作'],createdAt:date}]},
      {id:'podcast',movieTitle:'视频播客｜我们如何建立自己的判断？',videoUrl:'https://www.youtube.com/watch?v=podcast',createdAt:date,updatedAt:date,entries:[{id:'e',content:'先把问题讲清楚，再讨论答案。',tags:['思考'],createdAt:date}]}
    ]};
    const read=()=>JSON.parse(localStorage.getItem('mockStorage')||JSON.stringify(defaults));
    const store={async get(keys,cb){const all=read();const r=keys===null?all:Object.fromEntries([].concat(keys).map(k=>[k,all[k]]));cb?.(r);return r;},async set(vals){const all=read(),changes={};for(const[k,v]of Object.entries(vals))changes[k]={oldValue:all[k],newValue:v};localStorage.setItem('mockStorage',JSON.stringify({...all,...vals}));listeners.forEach(f=>f(changes,'local'));},async remove(keys){const all=read();[].concat(keys).forEach(k=>delete all[k]);localStorage.setItem('mockStorage',JSON.stringify(all));}};
    window.chrome={storage:{local:store,session:{get:async(k,cb)=>{cb?.({});return{};},remove:async()=>{}},onChanged:{addListener:f=>listeners.push(f)}},tabs:{query:async()=>[],get:async()=>({id:7,url:localStorage.getItem('testVideoUrl') || 'https://www.youtube.com/watch?v=interview'}),create:async options=>{window.openedTab=options;},sendMessage:async(id,msg)=>{window.lastVideoMessage={id,...msg};return msg.type==='GET_VIDEO_TITLE'?{success:true,title:'对话盛颖：xAI、Infra 的浪漫，与开源的未来'}:{success:true};}},runtime:{getURL:path=>'http://127.0.0.1:8765/movie-notes-extension/'+path,sendMessage:async msg=>{window.hostAction=msg;return{success:true};}}};
  });
  const check=(v,m)=>{if(!v)throw Error(m);};
  const dir='/Users/qianruimin/movie-notes/design-preview/v1.8.0/';
  const snap=async name=>tab.screenshot({path:dir+name+'.png',animations:'disabled'});
  const inspect=async name=>{
    check(await tab.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' horizontal overflow');
    const wrong = await tab.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getClientRects().length && [...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()) && !['SCRIPT','STYLE','KBD'].includes(e.tagName)).map(e=>({selector:e.id||e.className,size:getComputedStyle(e).fontSize})).filter(e=>!['0px','12px','14px','16px','24px'].includes(e.size)));
    if(wrong.length) violations.push({name,wrong});
  };
  try {
    await tab.goto('http://127.0.0.1:8765/movie-notes-extension/panel.html');
    await tab.locator('.movie-card').first().waitFor();await snap('01-library');await inspect('library');
    await tab.locator('.movie-card__toggle').first().click();await snap('02-expanded');await inspect('preview');
    await tab.locator('#btnOnboardToggle').click();await snap('03-help');await inspect('help');await tab.keyboard.press('Escape');
    await tab.locator('.movie-card__detail').first().click();await snap('04-detail');await inspect('detail');
    await tab.locator('#btnAddMoreTop').click();await tab.locator('#entryContent').fill('值得留下的，不只是一个结论，也包括它改变想法的那一刻。');
    await tab.locator('#stampPointInput').fill('12:34');await tab.locator('#stampPointInput').blur();await snap('05-editor');await inspect('editor');
    await tab.locator('#btnBackFromNew').click();await tab.locator('#btnBackFromDetail').click();
    await tab.locator('#tabSettings').click();await snap('06-settings');await inspect('settings');
    await tab.locator('#tabList').click();await tab.locator('#themeToggle').click();await snap('07-light');await inspect('light');await tab.locator('#themeToggle').click();
    for(const width of [360,280]) {
      await tab.setViewportSize({width,height:800});await inspect('library '+width);await snap('08-library-'+width);
      await tab.locator('#btnOnboardToggle').click();await inspect('help '+width);check(await tab.locator('#onboardBanner').evaluate(e=>e.scrollWidth<=e.clientWidth),'help width '+width);await tab.keyboard.press('Escape');
      await tab.locator('#btnCaptureCurrent').click();await inspect('editor '+width);check(await tab.locator('#viewNew').evaluate(e=>e.scrollWidth<=e.clientWidth),'editor width '+width);await snap('09-editor-'+width);await tab.locator('#btnBackFromNew').click();await tab.locator('#viewNew').waitFor({state:'hidden'});if(await tab.locator('#btnBackFromDetail').isVisible())await tab.locator('#btnBackFromDetail').click();
    }
    const payload={movieTitle:'拾穗者与我：在日常里，重新发现被忽略的东西',content:'创作并不总是从宏大的主题出发。\n\n也可以从一次弯腰、一个被丢掉的土豆开始。',when:'12:34',tags:['电影','创作','从日常开始'],createdAt:'2026-09-17T06:30:00Z',videoUrl:'https://www.youtube.com/watch?v=fixture',timestampSeconds:754};
    await tab.setViewportSize({width:640,height:900});
    await tab.goto('http://127.0.0.1:8765/movie-notes-extension/share.html#'+await tab.evaluate(p=>btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(p)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''),payload));
    await tab.locator('#card').waitFor();await snap('10-share');await inspect('share');
    const download=tab.waitForEvent('download');await tab.locator('#btnSaveImg').click();await(await download).saveAs(dir+'11-share-export.png');
    check((await tab.locator('#videoLink').getAttribute('href')).includes('t=754'),'share deep link missing time');
    await tab.setViewportSize({width:280,height:800});await inspect('share280');await snap('12-share-narrow');
    check(!errors.length,errors.join(';'));
    return {passed:['dark/light layouts','280/360 width library/help/editor','detail media controls retained','share rendered and PNG exported','timestamp deep link'],typographyViolations:violations,errors};
  } finally { await ctx.close(); }
}