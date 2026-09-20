async (page) => {
  const context = await page.context().browser().newContext({ viewport:{width:600,height:756},colorScheme:'light' });
  const tab=await context.newPage();const errors=[];tab.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:8765/')?r.continue():r.abort());
  await context.addInitScript(()=>{
    const listeners=[];
    const date='2026-09-17T06:30:00Z';
    const defaults={'uiTheme':'light',movieNotes:[
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
  const check=(ok,msg)=>{if(!ok)throw Error(msg);};const screenshots=[];
  const snap=async name=>{const path='/Users/qianruimin/movie-notes/design-preview/'+name+'.png';await tab.screenshot({path});screenshots.push(path);};
  try {
    await tab.goto('http://127.0.0.1:8765/movie-notes-extension/panel.html?embedded=1&sourceTab=7');
    await tab.locator('.movie-card').first().waitFor();
    check(await tab.locator('#onboardBanner').isHidden(),'help auto-opened');
    await tab.locator('.movie-card__toggle').first().click();
    check(await tab.locator('.note-preview:not([hidden])').count()===1,'accordion missing');
    check(await tab.locator('.note-preview img,.note-preview .entry-card__share,.note-preview .entry-card__del').count()===0,'preview includes rich management');
    await tab.locator('.note-preview__time').first().click();
    check((await tab.evaluate(()=>window.lastVideoMessage)).time===754,'timestamp not linked to source video');
    await snap('01-library-light');
    await tab.locator('.note-preview__more').click();check(await tab.locator('.note-preview__more').textContent()==='收起','long content cannot expand');await tab.locator('.note-preview__more').click();
    await tab.locator('.movie-card__toggle').nth(1).click();check(await tab.locator('.note-preview:not([hidden])').count()===1,'multiple accordions open');
    await tab.locator('#searchInput').fill('被丢掉的土豆');await tab.waitForFunction(()=>document.querySelectorAll('.movie-card').length===1);check((await tab.locator('.movie-card__title').textContent()).includes('拾穗者'),'body search broken');
    await tab.locator('#searchInput').fill('不存在的关键词');await tab.locator('.empty--show').waitFor();check((await tab.locator('.empty__title').textContent()).includes('没有找到'),'wrong empty copy');
    await tab.locator('#searchInput').fill('');await tab.waitForFunction(()=>document.querySelectorAll('.movie-card').length===3);
    await tab.locator('#btnOnboardToggle').click();await snap('02-help');await tab.keyboard.press('Escape');check(await tab.locator('#onboardBanner').isHidden(),'Esc did not dismiss help');check(await tab.evaluate(()=>!window.hostAction),'help Esc also closed library');
    await tab.locator('.movie-card__detail').first().click();await tab.locator('.entry-card').first().waitFor();check(await tab.locator('.entry-card__share').count()>0,'detail lost share');await snap('03-detail');
    await tab.locator('#btnAddMoreTop').click();await tab.locator('#entryContent').fill('这个观点可以用在下一次产品讨论里：先让用户留下想法，再帮助他回到产生想法的上下文。');
    await tab.locator('#tagInput').fill('产品设计');await tab.locator('#tagInput').press('Enter');await tab.locator('#stampPointInput').fill('12:34');await tab.locator('#stampPointInput').blur();await snap('04-editor');
    const body=await tab.locator('#entryContent').boundingBox(),time=await tab.locator('#stampPointInput').boundingBox();check(body.y<time.y,'editor not content-first');
    await tab.locator('#btnSave').click();await tab.locator('#viewList.view--active').waitFor();
    const saved=await tab.evaluate(()=>JSON.parse(localStorage.getItem('mockStorage'))['aside:guest:movieNotes'].find(n=>n.id==='interview'));check(saved.entries.length===4,'editor save wrong movie');check(saved.entries.some(e=>e.tags?.includes('产品设计')&&e.timestamp===754),'tag or manual timestamp lost');
    await tab.locator('.movie-card__toggle').first().click();await tab.locator('#themeToggle').click();await snap('05-library-dark');
    await tab.locator('#themeToggle').click();await tab.setViewportSize({width:360,height:740});await snap('06-library-narrow');
    check(await tab.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'narrow layout overflow');
    await tab.locator('.movie-card__detail').first().click();await tab.locator('#btnAddMoreTop').click();await snap('07-editor-narrow');
    check(await tab.evaluate(()=>document.querySelector('#viewNew').scrollWidth<=document.querySelector('#viewNew').clientWidth),'narrow editor overflow');
    await tab.locator('#entryContent').fill('切换视频后仍属于原视频的草稿');
    await tab.locator('#stampPointInput').fill('01:10');await tab.locator('#stampPointInput').blur();
    await tab.locator('#btnCloseLibrary').click();
    await tab.waitForFunction(()=>JSON.parse(localStorage.getItem('mockStorage'))['aside:guest:draft']?.content==='切换视频后仍属于原视频的草稿');
    await tab.evaluate(()=>localStorage.setItem('testVideoUrl','https://www.youtube.com/watch?v=another-video'));
    await tab.goto('http://127.0.0.1:8765/movie-notes-extension/panel.html?sourceTab=7');
    await tab.locator('.movie-card').first().waitFor();await tab.locator('#btnCaptureCurrent').click();
    check(await tab.locator('#entryContent').inputValue()==='切换视频后仍属于原视频的草稿','editor draft lost after reload');
    await tab.locator('#btnSave').click();await tab.locator('#viewList.view--active').waitFor();
    const restored=await tab.evaluate(()=>JSON.parse(localStorage.getItem('mockStorage'))['aside:guest:movieNotes']);
    check(restored.find(n=>n.id==='interview').entries.some(e=>e.content==='切换视频后仍属于原视频的草稿'&&e.timestamp===70),'draft rebound to wrong video or manual time rejected');
    check(!restored.some(n=>n.videoUrl?.includes('another-video')),'draft created a movie for the wrong tab');
    check(!errors.length,errors.join('\n'));
    return {passed:['help opt-in and isolated Escape','single accordion','preview excludes images and management','timestamp targets bound video','long content toggle','search body and empty state','detail retains sharing','content-first editor','manual timestamp and tags saved to selected video','light/dark/narrow layouts','editor draft retains source after video changes and reload'],screenshots,pageErrors:errors};
  } catch(e) { await snap('debug'); throw new Error(e.message+'\n'+errors.join('\n')); } finally {await context.close();}
}
