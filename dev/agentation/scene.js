// A local canvas video supplies a real media element and real frame capture without an external service.
const canvas = document.createElement('canvas');
canvas.width = 1280; canvas.height = 720;
const ctx = canvas.getContext('2d');
const video = document.querySelector('video');
function draw(time) {
  const gradient = ctx.createLinearGradient(0,0,1280,720);
  gradient.addColorStop(0,'#716382'); gradient.addColorStop(1,'#322a46');
  ctx.fillStyle = gradient; ctx.fillRect(0,0,1280,720);
  ctx.fillStyle = '#c9b6cc';ctx.beginPath();ctx.arc(970,260,66,0,Math.PI*2);ctx.fill();
  ctx.fillStyle = '#8a758f';ctx.beginPath();ctx.ellipse(950,860,960,330,-.13,0,Math.PI*2);ctx.fill();
  ctx.fillStyle = '#4e405e';ctx.beginPath();ctx.ellipse(180,920,1000,340,.12,0,Math.PI*2);ctx.fill();
  ctx.fillStyle = '#f4edf8';ctx.font='18px sans-serif';ctx.fillText('A MOMENT WORTH KEEPING',64,80);
  ctx.font='52px sans-serif';ctx.fillText('看见，才有新的开始。',64,365);
  ctx.font='18px sans-serif';ctx.fillText(`${String(Math.floor(time/60)).padStart(2,'0')}:${String(time%60).padStart(2,'0')}   /   观看现场`,64,660);
}
draw(0);
video.srcObject = canvas.captureStream(2);
video.play().catch(()=>{});
setInterval(()=>draw(Math.floor(video.currentTime || 0)),500);
const dispatch = message => window.__asidePreviewDispatch(message);
const status = document.querySelector('#scene-status');
async function act(message) {
  try { const result=await dispatch(message);status.textContent=result?.success===false ? result.error : ''; }
  catch(error){status.textContent=error.message;}
}
document.querySelector('#show-ball').addEventListener('click',()=>act({type:'MN_LIBRARY_HOST',action:'close'}));
document.querySelector('#show-quick').addEventListener('click',()=>act({type:'MN_LIBRARY_HOST',action:'quick'}));
document.querySelector('#show-library').addEventListener('click',()=>act({type:'MN_TOGGLE_LIBRARY',tabId:7}));
document.querySelector('#scene-theme').addEventListener('click',()=>chrome.storage.local.set({uiTheme:document.documentElement.dataset.theme==='light'?'dark':'light'}));
chrome.storage.local.get('uiTheme').then(({uiTheme})=>document.documentElement.dataset.theme=uiTheme==='light'?'light':'dark');
chrome.storage.onChanged.addListener(changes=>{if(changes.uiTheme)document.documentElement.dataset.theme=changes.uiTheme.newValue;});
window.addEventListener('keydown',event=>{
  if(event.altKey && event.code==='KeyL' && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.repeat){event.preventDefault();act({type:'MN_TOGGLE_LIBRARY',tabId:7});}
});
