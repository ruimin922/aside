import test from 'node:test';
import assert from 'node:assert/strict';
await import('../movie-notes-extension/player-dock.js');
const dock=globalThis.__asidePlayerDock;
const viewport={width:1280,height:800};
const video={left:100,right:1100,top:80,bottom:680};
const box={width:420,height:280};
test('note tracks the video and reserves its bottom subtitle area',()=>{
  assert.deepEqual(dock.placement(video,viewport,box,null),{left:390,top:244});
  assert.equal(dock.placement({...video,top:20,bottom:620},viewport,box,null).top,184);
});

test('opening follows the actual icon when it changes sides or the player moves',()=>{
  const anchor={left:950,right:986,top:642,bottom:678};
  const first=dock.placement(video,viewport,box,null,{anchor});
  assert.equal(first.left+box.width,anchor.right);
  const moved=dock.placement({...video,top:40,bottom:640},viewport,box,null,{anchor:{...anchor,left:850,right:886,top:602,bottom:638}});
  assert.equal(moved.left,first.left-100);
  assert.equal(moved.top,first.top-40);
});

test('visible higher or multiline subtitles are avoided as well as burned-in subtitles',()=>{
  const anchor={left:950,right:986,top:642,bottom:678};
  const subtitle={left:300,right:1050,top:430,bottom:550};
  const p=dock.placement(video,viewport,box,null,{anchor,subtitles:[subtitle]});
  assert.ok(p.top+box.height<=subtitle.top-12);
  assert.equal(p.left+box.width,anchor.right);
});

test('short inline videos can place the editor below the player without covering captions',()=>{
  const short={left:20,right:380,top:100,bottom:300};
  const p=dock.placement(short,{width:400,height:800},{width:360,height:240},null,{anchor:{left:300,right:336,top:260,bottom:296}});
  assert.ok(p.top>=short.bottom+12);
});

test('fullscreen narrow layouts remain usable when subtitle avoidance is impossible',()=>{
  const p=dock.placement({left:0,right:360,top:0,bottom:300},{width:360,height:300},{width:328,height:268},null,{anchor:{left:300,right:336,top:260,bottom:296},subtitles:[{left:0,right:360,top:90,bottom:270}]});
  assert.deepEqual(p,{left:16,top:16});
});
test('narrow and short windows keep the note reachable',()=>{
  for(const size of [{width:360,height:800},{width:320,height:480},{width:800,height:360}]){
    const result=dock.placement(video,size,{width:Math.min(420,size.width-32),height:280},null);
    assert.ok(result.left>=16 && result.top>=16);
    assert.ok(result.left+Math.min(420,size.width-32)<=size.width-16);
    assert.ok(result.top+280<=size.height-16);
  }
});
test('offscreen videos do not pull an open draft outside the viewport',()=>{
  assert.deepEqual(dock.placement({...video,top:-600,bottom:-100},viewport,box,null),{left:430,top:504});
});
test('drag placement restores exactly and remains bounded after a viewport resize',()=>{
  const rect={left:350,top:120,...box};
  const saved=dock.relativePosition(rect,viewport);
  assert.deepEqual(dock.placement(video,viewport,box,saved),{left:350,top:120});
  assert.deepEqual(dock.placement(video,viewport,{...box,height:330},saved),{left:350,top:120});
  const narrow=dock.placement(video,{width:360,height:640},{width:328,height:280},saved);
  assert.equal(narrow.left,16);assert.ok(narrow.top>=16 && narrow.top<=344);
  assert.deepEqual(dock.placement(video,viewport,box,{x:5,y:-3}),{left:844,top:16});
});
test('all six adapters scope the controls to the selected video player',()=>{
  for(const [site,adapter] of Object.entries(dock.adapters)){
    const target={contains:()=>false};
    const root={querySelector:selector=>selector===adapter.controls[0]?target:null};
    const selectedVideo={closest:selector=>selector===adapter.player?root:null};
    assert.equal(dock.findControls(selectedVideo,site),target,site);
    assert.equal(dock.findControls({closest:()=>null},site),null,site);
  }
  assert.equal(Object.keys(dock.adapters).length,6);
});
test('unrecognized or invalid control containers use the video-bottom fallback',()=>{
  assert.equal(dock.findControls({closest:()=>({querySelector:()=>null})},'youtube'),null);
  assert.equal(dock.findControls({closest:()=>({querySelector:()=>({contains:()=>true})})},'youtube'),null);
  assert.equal(dock.findControls({},'unknown'),null);
});

test('redesigned bottom controls are discovered without matching unrelated page toolbars',()=>{
  const control=rect=>({contains:()=>false,children:[{},{}],getBoundingClientRect:()=>rect});
  const unrelated=control({left:800,right:1100,bottom:30,width:300,height:40});
  const progress=control({left:900,right:1100,bottom:680,width:200,height:4});
  const target=control({left:800,right:1100,bottom:680,width:300,height:40});
  const parent={tagName:'DIV',querySelectorAll:()=>[unrelated,progress,target]};
  const v={closest:()=>null,parentElement:parent,getBoundingClientRect:()=>({...video,width:1000,height:600})};
  assert.equal(dock.findControls(v,'youku'),target);
});
