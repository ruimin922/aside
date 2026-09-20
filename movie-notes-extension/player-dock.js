// Shared by the declarative content script and toolbar-triggered injection.
(() => {
  const adapters = Object.freeze({
    youtube: {player:'#movie_player, .html5-video-player', controls:['.ytp-right-controls']},
    bilibili: {player:'.bpx-player-container, .bilibili-player, #bilibili-player', controls:['.bpx-player-control-bottom-right', '.bilibili-player-video-control-bottom-right']},
    iqiyi: {player:'.iqp-player, .qy-player, #flashbox', controls:['.iqp-player-control-right', '.iqp-player-controls-right', '.qy-player-control-right']},
    youku: {player:'.yk-player, .youku-player, #ykPlayer', controls:['.kui-control-right', '.control-right', '.youku-control-right']},
    mgtv: {player:'.mgtv-player, #mgtv-player, .mango-player', controls:['.mgtv-player-control-right', '.mango-control-right', '.mgtv-player-control .right']},
    tencent: {player:'.txp_player, .tenvideo_player, #mod_player', controls:['.txp_right_controls', '.txp-control-right']}
  });
  const clamp = (value,min,max) => Math.max(min,Math.min(Math.max(min,max),value));
  function findControls(video,site) {
    const adapter=adapters[site];
    if (!video || !adapter) return null;
    const root=video.closest(adapter.player);
    if (root) for (const selector of adapter.controls) {
      const controls=root.querySelector(selector);
      if (controls && !controls.contains(video)) return controls;
    }
    // Site redesign fallback: only a small right-hand control group near this video.
    // Never insert into a page header, the progress track, or another player.
    const vr=video.getBoundingClientRect?.();
    let parent=video.parentElement;
    for(let depth=0;vr && parent && depth<5 && !['BODY','HTML'].includes(parent.tagName);depth++,parent=parent.parentElement){
      const candidates=parent.querySelectorAll?.('[class*="control"][class*="right"], [class*="control"][class*="Right"]') || [];
      for(const controls of candidates){
        if(controls.contains(video) || controls.children.length<2)continue;
        const r=controls.getBoundingClientRect();
        if(r.width>=64 && r.width<vr.width*.7 && r.height>=20 && r.height<=64 && r.left>=vr.left+vr.width*.3 && r.right<=vr.right+8 && r.bottom>=vr.bottom-80 && r.bottom<=vr.bottom+48)return controls;
      }
    }
    return null;
  }
  function placement(video, viewport, box, position, {anchor,subtitles=[]}={}) {
    const width=clamp(box.width,1,viewport.width-32);
    const height=clamp(box.height,1,viewport.height-32);
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      return {left:clamp(position.x*viewport.width,16,viewport.width-width-16),top:clamp(position.y*viewport.height,16,viewport.height-height-16)};
    }
    const visible=video && video.bottom>64 && video.top<viewport.height-64 && video.right>0 && video.left<viewport.width;
    const bound=(left,top)=>({left:clamp(left,16,viewport.width-width-16),top:clamp(top,16,viewport.height-height-16)});
    if (!visible) return bound((viewport.width-width)/2,viewport.height-height-16);
    const validAnchor=anchor && anchor.right>anchor.left && anchor.bottom>anchor.top;
    const left=validAnchor ? anchor.right-width : (video.left+video.right-width)/2;
    const top=(validAnchor ? anchor.top-12 : video.bottom-56)-height;
    // Burned-in subtitles have no DOM bounds: reserve the lower part of the video too.
    const reserve=clamp((video.bottom-video.top)*.24,64,180);
    const obstacles=[{left:video.left,right:video.right,top:video.bottom-reserve,bottom:video.bottom},...subtitles]
      .map(r=>({left:Math.max(0,r.left),right:Math.min(viewport.width,r.right),top:Math.max(0,r.top),bottom:Math.min(viewport.height,r.bottom)}))
      .filter(r=>r.right>r.left && r.bottom>r.top);
    const base=bound(left,top);
    const candidates=[base];
    for (const r of obstacles) {
      candidates.push(bound(left,r.top-height-12),bound(r.left-width-12,top),bound(r.right+12,top));
    }
    // In a short inline player the space below it is preferable to covering subtitles.
    if (video.bottom+12+height<=viewport.height-16) candidates.push(bound(left,video.bottom+12));
    const score=p=>obstacles.reduce((sum,r)=>sum+Math.max(0,Math.min(p.left+width,r.right)-Math.max(p.left,r.left))*Math.max(0,Math.min(p.top+height,r.bottom)-Math.max(p.top,r.top)),0)*1000
      +Math.abs(p.left-base.left)+Math.abs(p.top-base.top);
    return candidates.reduce((best,p)=>score(p)<score(best)?p:best,base);
  }
  function relativePosition(rect,viewport) {
    return {x:clamp(rect.left/Math.max(1,viewport.width),0,1),y:clamp(rect.top/Math.max(1,viewport.height),0,1)};
  }
  globalThis.__asidePlayerDock=Object.freeze({adapters,findControls,placement,relativePosition});
})();
