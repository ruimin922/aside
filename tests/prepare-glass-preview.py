"""Create a local-only material preview from release CSS; no extension permissions."""
from pathlib import Path
import json
root = Path(__file__).resolve().parent.parent
fixture = Path('/private/tmp/aside-browser-fixture/movie-notes-extension')
source = (root/'movie-notes-extension/content.js').read_text()
a = source.index('      style.textContent = `', source.index('async function showLibrary'))
a = source.index('`', a) + 1
b = source.index('`;', a)
style = source[a:b]
assert '${' not in style
qa=source.index('  style.textContent = `',source.index('function ensureStyles()'))
qa=source.index('`',qa)+1
qb=source.index('`;',qa)
quick_style=source[qa:qb].replace('${QUICK_BOX_WIDTH}', '360')
assert '${' not in quick_style
(fixture/'glass-preview.js').write_text('''const host = document.querySelector('#material-host');
const shadow = host.attachShadow({mode:'open'});
const style = document.createElement('style'); style.textContent = ''' + json.dumps(style) + ''';
const grip = document.createElement('div'); grip.className = 'grip'; grip.innerHTML = '<span></span>';
const frame = document.createElement('iframe'); frame.title = '旁白 · 示例记录'; frame.src = 'preview.html?embedded=1&sourceTab=7';
shadow.append(style,grip,frame);
function updateTheme(){const saved = JSON.parse(localStorage.getItem('mockStorage') || '{}'); host.dataset.theme = saved.uiTheme || 'dark'; document.querySelector('.mn-qn').dataset.theme=host.dataset.theme;}
updateTheme(); window.addEventListener('storage', updateTheme);
document.querySelector('#palette').addEventListener('click',()=>{document.body.classList.toggle('cool');});
document.querySelector('#quick-toggle').addEventListener('click',()=>{const q=document.querySelector('.mn-qn'); q.hidden=!q.hidden;host.style.setProperty('display',q.hidden?'block':'none','important');});
document.querySelector('#probe-toggle').addEventListener('click',()=>{document.querySelector('#probe').hidden=!document.querySelector('#probe').hidden;});
document.querySelector('#host-toggle').addEventListener('click',()=>{host.hidden=!host.hidden;host.style.setProperty('display',host.hidden?'none':'block','important');});
''')
(fixture/'quick-preview.css').write_text(quick_style)
(fixture/'glass-preview.html').write_text('''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>旁白 · 磨砂玻璃实景预览</title><link rel="stylesheet" href="quick-preview.css"><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#a7a1b2;color:#30283b;font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;--scene:#bd887a;--orb:#f4d0a1;--ribbon:#776a9b;}
body.cool{--scene:#44899a;--orb:#a1d5d2;--ribbon:#8fa6ca;}
header{height:74px;padding:24px 40px;background:#eeebef;display:flex;align-items:center;justify-content:space-between;letter-spacing:1px;border-bottom:1px solid #2c233611;}
header span{font-size:12px;color:#6c6474;letter-spacing:0;}
main{margin:32px 40px;position:relative} .film{height:650px;width:100%;position:relative;overflow:hidden;background:var(--scene);border-radius:16px;}
.orb{position:absolute;width:900px;height:900px;border-radius:50%;background:var(--orb);top:-290px;right:-100px;}
.ribbon{position:absolute;width:1800px;height:400px;border:110px solid var(--ribbon);border-radius:50%;transform:rotate(-25deg);top:430px;left:-250px;}
.film p{position:absolute;top:50px;left:40px;letter-spacing:4px;font-size:12px;color:#4e3640;}
.film h1{position:absolute;top:220px;left:40px;margin:0;font-size:38px;line-height:1.6;letter-spacing:2px;font-weight:500;color:#4b3443;}
.time{position:absolute;bottom:28px;left:32px;color:#fff;font-size:12px;}
h2{font-size:24px;font-weight:500;margin:24px 0 6px;}main>p{color:#4d4458;margin:0;}
footer button{font:inherit;background:#ece5f5;border:1px solid #87739555;color:#493c56;border-radius:8px;padding:10px 16px;cursor:pointer;}
#material-host{right:32px!important;top:20px!important;}
footer{position:fixed;left:40px;bottom:24px;z-index:3;color:#4d4458;font-size:12px;}
.mn-qn[hidden]{display:none} .mn-qn{right:40px;top:200px;width:420px;} #probe{position:fixed;inset:0;pointer-events:none;background:repeating-linear-gradient(90deg,#fff8 0 12px,#0005 12px 24px);} @media(max-width:760px){main{margin:16px}.film{height:700px}#material-host{right:16px!important;top:20px!important}header{padding:20px}footer{margin:16px}}
</style></head><body><header><strong>VIDEO / 观看现场</strong><span>本地材质预览 · 示例数据</span></header><main><div class="film"><div class="orb"></div><div class="ribbon"></div><p>A MOMENT WORTH KEEPING</p><h1>看见，<br>才有新的开始。</h1><span class="time">▶ &nbsp; 00:52 / 24:08</span></div><h2>灵感发生的那一刻</h2><p>视频里的时间点，留给自己的想法。</p></main><footer><button id="palette" type="button">切换画面底色</button> <button id="quick-toggle">快速记录预览</button> <button id="probe-toggle">检查纹理</button> <button id="host-toggle">显示面板</button></footer><div id="probe" hidden></div><div id="material-host"></div><div class="mn-qn" hidden><div class="mn-qn__top"><span class="mn-qn__ctx"><span class="mn-qn__top-accent">灵感发生的那一刻</span><span class="mn-qn__time">◷ 00:52</span></span><span class="mn-qn__library"><img src="icons/icon32.png" alt="旁白"></span></div><div class="mn-qn__mid"><textarea class="mn-qn__ta" aria-label="记录内容">先留下触动自己的这一刻，细节可以稍后补充。</textarea></div><div class="mn-qn__foot"><span class="mn-qn__hint"><span>⌘ Enter 保存</span><span>Esc 收起，保留草稿</span></span><span class="mn-qn__sub-btn">时间<kbd>Option + T</kbd></span><span class="mn-qn__sub-btn">字幕<kbd>Option + S</kbd></span><span class="mn-qn__save-link">保存</span></div></div><script src="glass-preview.js"></script></body></html>''')
print('Local material preview ready (production host CSS + production panel CSS; sample data only).')
