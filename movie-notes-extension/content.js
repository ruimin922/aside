(() => {
if (globalThis.__asideContentLoaded === '1.9.12') return;
globalThis.__asideContentLoaded = '1.9.12';
const playerDock = globalThis.__asidePlayerDock;
const nativeShortcuts = Boolean(chrome.runtime.getManifest?.().commands?.['quick-note']);
function formatSeconds(sec) {
  if (typeof sec !== "number" || Number.isNaN(sec)) return null;
  const total = Math.max(0, Math.floor(sec));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad2 = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${pad2(h)}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

function detectSite() {
  const host = location.hostname;
  const domains = { 'youtube.com': 'youtube', 'bilibili.com': 'bilibili', 'iqiyi.com': 'iqiyi', 'youku.com': 'youku', 'mgtv.com': 'mgtv', 'v.qq.com': 'tencent' };
  return Object.entries(domains).find(([h]) => host === h || host.endsWith('.' + h))?.[1] || 'unknown';
}

function getVideoElement() {
  if (detectSite() === 'unknown') return null;
  const videos = [...document.querySelectorAll('video')].filter(v => {
    const r = v.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(v).visibility !== 'hidden';
  });
  const score = v => {
    const r = v.getBoundingClientRect();
    return (v.paused ? 0 : 1e9) + r.width * r.height;
  };
  return videos.sort((a, b) => score(b) - score(a))[0] || null;
}

function getTitle() {
  const site = detectSite();
  if (site === "youtube") {
    const el =
      document.querySelector("h1.ytd-video-primary-info-renderer yt-formatted-string") ||
      document.querySelector("h1 yt-formatted-string") ||
      null;
    const t = (el?.textContent || "").trim();
    return t || (document.title || "").trim();
  }
  if (site === "bilibili") {
    const el = document.querySelector(".video-title") || document.querySelector("h1.video-title");
    let t = (el?.textContent || "").trim();
    if (!t) t = (document.title || "").trim();
    t = t.replace(/_哔哩哔哩\s*$/i, "").trim();
    return t;
  }
  if (site === "iqiyi") {
    const el = document.querySelector("h1") || document.querySelector(".site-title");
    let t = (el?.textContent || "").trim();
    if (!t) t = (document.title || "").trim();
    t = t.replace(/[-_—]\s*爱奇艺.*$/i, "").trim();
    return t;
  }
  if (site === "youku") {
    let t = (document.title || "").trim();
    t = t.replace(/[-_—]\s*优酷.*$/i, "").trim();
    return t;
  }
  if (site === "mgtv") {
    let t = (document.title || "").trim();
    t = t.replace(/[-_—]\s*芒果TV.*$/i, "").replace(/[-_—]\s*MGTV.*/i, "").trim();
    return t;
  }
  if (site === "tencent") {
    const el =
      document.querySelector(".title-text") ||
      document.querySelector(".player-title") ||
      document.querySelector("h1");
    let t = (el?.textContent || "").trim();
    if (!t) t = (document.title || "").trim();
    t = t.replace(/[-_—]\s*腾讯视频.*$/i, "").trim();
    return t;
  }
  return (document.title || "").trim();
}

function getOgImage() {
  const m =
    document.querySelector('meta[property="og:image"]') ||
    document.querySelector('meta[property="og:image:url"]') ||
    document.querySelector('meta[name="twitter:image"]');
  const u = m?.getAttribute("content")?.trim();
  return u || null;
}

function waitSeeked(video, timeoutMs = 1200) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener("seeked", onSeeked);
      clearTimeout(tid);
      resolve();
    };
    const onSeeked = () => finish();
    video.addEventListener("seeked", onSeeked, { once: true });
    const tid = setTimeout(finish, timeoutMs);
  });
}

function postMediaState() {
  const fs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  const video = getVideoElement();
  const paused = video ? Boolean(video.paused) : false;
  try {
    chrome.runtime.sendMessage({
      type: "TAB_MEDIA_STATE",
      fullscreen: fs,
      paused
    });
  } catch {
    // ignore
  }
}

function hookVideoLifecycle() {
  if (detectSite() === "unknown") return;
  const video = getVideoElement();
  if (!video || video.dataset.mnHooked === "1") return;
  video.dataset.mnHooked = "1";
  const onChange = () => {
    postMediaState();
    updatePlayerEntryState();
  };
  ["play", "pause", "seeked"].forEach((ev) => video.addEventListener(ev, onChange));
}

function getMountTarget() {
  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.body ||
    document.documentElement
  );
}

function handleFullscreenForEntry() {
  postMediaState();
  const target = getMountTarget();
  if (libraryHost && libraryHost.parentElement !== target) target.appendChild(libraryHost);
  ensurePlayerEntry();
  if (ui?.quickHost && ui.quickHost.parentElement !== target) {
    target.appendChild(ui.quickHost);
  }
  queuePlayerLayout();
}

document.addEventListener("fullscreenchange", handleFullscreenForEntry);
document.addEventListener("webkitfullscreenchange", handleFullscreenForEntry);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return;

  if (message.type === 'MN_KEYBOARD_COMMAND') {
    if (message.command === 'quick-note') {
      void toggleQuickNote('command');
    }
    sendResponse({success:true}); return;
  }
  if (message.type === 'GET_CURRENT_SUBTITLE') {
    const text = getVideoElement() ? getCurrentSubtitle() : '';
    sendResponse(text ? {success:true,text} : {success:false,error:'当前没有可读取的字幕，请确认已开启字幕'});
    return;
  }
  if (message.type === 'MN_TOGGLE_LIBRARY') {
    (async () => {
      if (libraryOpen) hideLibrary(); else await showLibrary(message.tabId, true);
      return { success: true, open: libraryOpen };
    })().then(sendResponse, e => sendResponse({ success: false, error: e.message }));
    return true;
  }
  if (message.type === 'MN_LIBRARY_HOST') {
    (async () => {
      if (message.action === 'quick' && !getVideoElement()) return { success: false, error: '请先在支持的网站播放视频' };
      hideLibrary();
      if (message.action === 'quick') {
        await openQuickNote('library');
        if (!ui?.qn) { await showLibrary(libraryTabId); return { success: false, error: '无法打开快速记录，请刷新视频页面后重试' }; }
      }
      return { success: true };
    })().then(sendResponse, e => sendResponse({ success: false, error: e.message }));
    return true;
  }
  if (message.type === 'MN_LIBRARY_POINTER') {
    if (message.inside) libraryPresence.enter();
    else {
      // Moving from the iframe onto the host's drag/resize edges stays inside.
      const frame = libraryHost?.shadowRoot.querySelector('iframe')?.getBoundingClientRect();
      const host = libraryHost?.getBoundingClientRect();
      const x = frame?.left + message.x, y = frame?.top + message.y;
      if (host && x >= host.left && x < host.right && y >= host.top && y < host.bottom) libraryPresence.enter();
      else libraryPresence.leave();
    }
    sendResponse({success:true}); return;
  }

  if (message.type === "GET_VIDEO_TIME") {
    try {
      const video = getVideoElement();
      if (!video) {
        sendResponse({ success: false, error: "未找到视频元素" });
        return;
      }
      const time = Number(video.currentTime);
      const formattedTime = formatSeconds(time);
      sendResponse({ success: true, time, formattedTime });
    } catch (e) {
      sendResponse({ success: false, error: e?.message || "未知错误" });
    }
    return;
  }

  if (message.type === "GET_VIDEO_TITLE") {
    try {
      const title = getTitle();
      sendResponse({ success: true, title });
    } catch (e) {
      sendResponse({ success: false, error: e?.message || "未知错误" });
    }
    return;
  }

  if (message.type === "GET_OG_IMAGE") {
    try {
      const url = getOgImage();
      sendResponse({ success: true, url });
    } catch (e) {
      sendResponse({ success: false, error: e?.message || "未知错误" });
    }
    return;
  }

  if (message.type === "SEEK_VIDEO") {
    (async () => {
      try {
        const video = getVideoElement();
        if (!video) {
          sendResponse({ success: false, error: "未找到视频" });
          return;
        }
        const t = Number(message.time);
        if (Number.isNaN(t)) {
          sendResponse({ success: false, error: "无效时间" });
          return;
        }
        video.currentTime = t;
        await waitSeeked(video);
        try {
          await video.play();
        } catch {
          // autoplay policy: still considered success if seek worked
        }
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: e?.message || "跳转失败" });
      }
    })();
    return true;
  }

  if (message.type === "CAPTURE_FRAME_AT_TIME") {
    (async () => {
      try {
        const video = getVideoElement();
        if (!video) {
          sendResponse({ success: false, error: "未找到视频" });
          return;
        }
        const t = Number(message.time);
        if (Number.isNaN(t)) {
          sendResponse({ success: false, error: "无效时间" });
          return;
        }
        const prev = video.currentTime;
        video.currentTime = t;
        await waitSeeked(video);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) {
          video.currentTime = prev;
          await waitSeeked(video);
          sendResponse({ success: false, error: "未就绪" });
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0);
        let dataURL = null;
        try {
          dataURL = canvas.toDataURL("image/jpeg", 0.6);
        } catch {
          dataURL = null;
        }
        video.currentTime = prev;
        await waitSeeked(video);
        sendResponse({ success: Boolean(dataURL), dataURL });
      } catch (e) {
        sendResponse({ success: false, error: e?.message || "截图失败" });
      }
    })();
    return true;
  }

  return undefined;
});

postMediaState();

/* =========================
 * 播放器底栏入口 + 底部快速记录
 * ========================= */

const QUICK_BOX_WIDTH = 420;

const QUICK_PLACEHOLDERS = [
  "这一幕让你想到什么？",
  "记下一句台词或画面…",
  "此刻的心情与细节…",
  "有什么想回头再看的点？"
];

const MN_BUILD = "1.7.4";

function pickQuickPlaceholder() {
  return QUICK_PLACEHOLDERS[Math.floor(Math.random() * QUICK_PLACEHOLDERS.length)];
}

function normalizeTagArray(raw) {
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  const s = String(raw || "").trim();
  if (!s) return [];
  return s
    .split(/[\s,，/／]+/g)
    .map((x) => x.replace(/^#+/, "").trim())
    .filter(Boolean);
}

/**
 * 同一个输入框里用「/」输入迷思标签：
 * - 任意一行（trim 后）以 / 开头，都视为「标签行」
 * - 标签行支持：/ 台词 配乐 或 /台词 /配乐 或 /#台词,#配乐
 * - 保存时移除所有标签行，只保存正文；tags 写入 entry.tags
 */
function extractTagsFromContent(text) {
  const raw = String(text ?? "");
  const lines = raw.split("\n");
  const tags = [];
  const kept = [];

  for (const line of lines) {
    const t = String(line ?? "").trim();
    const isTagLine = t.startsWith("/") || t.startsWith("／");
    if (isTagLine) {
      const parsed = normalizeTagArray(t.slice(1));
      for (const p of parsed) tags.push(p);
    } else {
      kept.push(line);
    }
  }

  const uniq = [...new Set(tags)];
  const content = kept.join("\n").trim();
  return { content, tags: uniq };
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// Dragging only changes the current open window; every new note opens at the video bottom.
let quickPlacement = null;
function updateQuickPlacement() {
  if (!ui?.qn) return;
  quickPlacement=playerDock.relativePosition(ui.qn.getBoundingClientRect(),{width:innerWidth,height:innerHeight});
}

let libraryHost = null;
let libraryOpen = false;
let libraryBusy = false;
let libraryTabId = null;
let libraryReturnFocus = null;
const libraryPresence = globalThis.__asideLibraryPresence(() => hideLibrary(false));
let surfaceTheme = 'dark';
let surfaceThemeRevision = 0;
function applySurfaceTheme(value) {
  surfaceTheme = value === 'light' ? 'light' : 'dark';
  if (libraryHost) libraryHost.dataset.theme = surfaceTheme;
  if (ui?.qn) ui.qn.dataset.theme = surfaceTheme;
  if (ui?.trigger) ui.trigger.dataset.theme = surfaceTheme;
}

function restorePageFocus(preferred) {
  const target = preferred?.isConnected ? preferred : getVideoElement();
  if (!target) return;
  const hadTabindex = target.hasAttribute('tabindex');
  if (!hadTabindex) {
    target.setAttribute('tabindex', '-1');
    target.addEventListener('blur', () => target.removeAttribute('tabindex'), {once:true});
  }
  target.focus({preventScroll:true});
}

function hideLibrary(restoreFocus = true) {
  const wasOpen = libraryOpen;
  libraryOpen = false;
  libraryPresence.close();
  libraryHost?.style.setProperty('display', 'none', 'important');
  // Reset the hidden UI now, so reopening never flashes the previous task.
  libraryHost?.shadowRoot.querySelector('iframe')?.contentWindow.postMessage(
    {type:'MN_NAVIGATE_HOME'}, chrome.runtime.getURL('').replace(/\/$/, ''));
  updatePlayerEntryState();
  if (wasOpen && restoreFocus) restorePageFocus(libraryReturnFocus);
}
async function showLibrary(tabId, home = false) {
  if (libraryBusy) return;
  libraryBusy = true;
  try {
    if (!libraryOpen) libraryReturnFocus = getVideoElement() || document.activeElement;
    await closeQuickNote('library');
    if (ui?.qn) throw new Error('请等待记录保存完成后再打开记录库');
    libraryTabId = tabId;
    const {asideLibraryPinned} = await chrome.storage.local.get('asideLibraryPinned');
    libraryPresence.pin(asideLibraryPinned);
    if (!libraryHost) {
      const host = document.createElement('div');
      host.id = 'aside-library-host';
      host.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') libraryPresence.enter(); });
      host.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && !e.buttons) libraryPresence.enter(); });
      host.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') libraryPresence.leave(); });
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = `
        :host{all:initial;position:fixed!important;z-index:2147483646!important;
          width:var(--aside-library-width,min(600px,calc(100vw - 32px)))!important;height:var(--aside-library-height,min(780px,calc(100dvh - 40px)))!important;
          box-sizing:border-box!important;max-width:calc(100vw - 16px)!important;max-height:calc(100dvh - 16px)!important;
          border:1px solid rgba(246,239,255,.28)!important;border-radius:20px!important;
          background:rgba(27,22,39,.68)!important;backdrop-filter:blur(32px) saturate(1.25)!important;
          -webkit-backdrop-filter:blur(32px) saturate(1.25)!important;
          box-shadow:0 20px 64px #17111f38,0 2px 12px #17111f24,inset 0 1px 0 #ffffff29!important;
          overflow:hidden!important;color-scheme:dark;}
        :host([data-theme="light"]){background:rgba(248,245,252,.68)!important;border-color:#ffffffa6!important;color-scheme:light;box-shadow:0 20px 64px #17111f26,0 2px 12px #17111f1a,inset 0 1px 0 #ffffffa6!important;}
        .grip{position:absolute;top:0;left:0;right:0;z-index:1;height:18px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;
          cursor:grab;touch-action:none;background:transparent;color:#c6bdd0;
          font:12px MiSans,-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;user-select:none;}
        .grip:active{cursor:grabbing}.grip:focus-visible{outline:2px solid transparent;border-radius:16px;box-shadow:inset 0 0 0 2px #ddd0ef,inset 0 0 0 5px #ddd0ef22}
        .grip span{width:32px;height:3px;border-radius:4px;background:#c6bdd066;opacity:0;transition:opacity 150ms ease;}
        .grip:hover span,.grip:focus-visible span,.grip:active span{opacity:1;}
        .grip:hover span{background:#ddd0ef;}
        :host([data-theme="light"]) .grip{color:#655c73;}
        :host([data-theme="light"]) .grip span{background:#655c7366;}
        iframe{display:block;width:100%;height:100%;border:0;background:transparent;}
        .resize{position:absolute;touch-action:none;z-index:2;user-select:none;}
        .resize[data-edge="left"]{left:0;top:24px;bottom:24px;width:6px;cursor:ew-resize;}
        .resize[data-edge="right"]{right:0;top:24px;bottom:24px;width:6px;cursor:ew-resize;}
        .resize[data-edge="bottom"]{bottom:0;left:24px;right:24px;height:6px;cursor:ns-resize;}
        .resize[data-edge^="bottom-"]{bottom:0;width:24px;height:24px;color:#c6bdd0;}
        .resize[data-edge="bottom-left"]{left:0;cursor:nesw-resize;}
        .resize[data-edge="bottom-right"]{right:0;cursor:nwse-resize;}
        .resize[data-edge^="bottom-"]::after{content:"";position:absolute;inset:8px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;border-radius:0 0 5px 0;opacity:0;transition:opacity 150ms ease;}
        .resize[data-edge="bottom-left"]::after{transform:rotate(90deg);}
        .resize:is(:hover,:focus-visible,:active)::after{opacity:1;}
        .resize:focus-visible{outline:2px solid transparent;border-radius:10px;box-shadow:inset 0 0 0 2px #ddd0ef;}
        :host([data-theme="light"]) .resize{color:#655c73;}
        :host([data-theme="light"]) :is(.grip,.resize):focus-visible{box-shadow:inset 0 0 0 2px #665278;}
        @media(prefers-reduced-motion:reduce){.grip span,.resize::after{transition:none;}}
        @supports not (backdrop-filter:blur(1px)) {
          :host{background:#393244!important;}
          :host([data-theme="light"]){background:#f0ecf5!important;}
        }
        @media(prefers-reduced-transparency:reduce) {
          :host{background:#393244!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;}
          :host([data-theme="light"]){background:#f0ecf5!important;}
        }
      `;
      const grip = document.createElement('div');
      grip.className = 'grip'; grip.title = '拖动窗口 · 聚焦后使用方向键移动'; grip.tabIndex = 0;
      grip.setAttribute('role', 'button'); grip.setAttribute('aria-label', '移动旁白窗口，使用方向键调整位置');
      const mark = document.createElement('span'); grip.append(mark);
      const frame = document.createElement('iframe');
      frame.title = '旁白 · 灵感记录';
      frame.src = chrome.runtime.getURL(`panel.html?embedded=1&sourceTab=${tabId}`);
      shadow.append(style, grip, frame);
      host.style.setProperty('right', '20px', 'important');
      host.style.setProperty('top', '20px', 'important');
      const move = (x, y) => {
        const r = host.getBoundingClientRect();
        host.style.setProperty('left', `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`, 'important');
        host.style.setProperty('top', `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`, 'important');
        host.style.setProperty('right', 'auto', 'important');
      };
      let drag = null;
      grip.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const r = host.getBoundingClientRect(); drag = { x: e.clientX-r.left, y: e.clientY-r.top };
        libraryPresence.interact(true);
        grip.setPointerCapture(e.pointerId); frame.style.pointerEvents = 'none';
      });
      grip.addEventListener('pointermove', e => { if(drag) move(e.clientX-drag.x, e.clientY-drag.y); });
      const endDrag = () => { drag = null; frame.style.pointerEvents = ''; libraryPresence.interact(false); };
      grip.addEventListener('pointerup', endDrag); grip.addEventListener('lostpointercapture', endDrag);
      grip.addEventListener('keydown', e => {
        const delta = { ArrowLeft: [-16,0], ArrowRight: [16,0], ArrowUp: [0,-16], ArrowDown: [0,16] }[e.key];
        if (!delta) return; e.preventDefault(); const r = host.getBoundingClientRect(); move(r.left+delta[0], r.top+delta[1]);
      });
      // Edges resize the actual iframe viewport, so its existing responsive layout reflows.
      const resize = (r, edge, dx, dy) => {
        const fromLeft = edge.includes('left');
        const maxW = fromLeft ? r.right - 8 : innerWidth - r.left - 8;
        const maxH = innerHeight - r.top - 8;
        const w = edge === 'bottom' ? r.width : clamp(r.width + (fromLeft ? -dx : dx), Math.min(264,maxW), maxW);
        const h = edge.includes('bottom') ? clamp(r.height + dy, Math.min(300,maxH), maxH) : r.height;
        host.style.setProperty('--aside-library-width', `${w}px`);
        host.style.setProperty('--aside-library-height', `${h}px`);
        move(fromLeft ? r.right - w : r.left, r.top);
      };
      for (const edge of ['left','right','bottom','bottom-left','bottom-right']) {
        const handle = document.createElement('div');
        handle.className = 'resize'; handle.dataset.edge = edge;
        handle.title = '拖动调整窗口大小';
        if (edge.includes('bottom-')) {
          handle.tabIndex = 0; handle.setAttribute('role','button');
          handle.setAttribute('aria-label', `${edge.endsWith('left') ? '左' : '右'}下角调整窗口大小，使用方向键`);
          handle.addEventListener('keydown', e => {
            const delta = {ArrowLeft:[-24,0],ArrowRight:[24,0],ArrowUp:[0,-24],ArrowDown:[0,24]}[e.key];
            if (!delta) return;
            e.preventDefault(); resize(host.getBoundingClientRect(),edge,...delta);
          });
        }
        let origin = null;
        handle.addEventListener('pointerdown', e => {
          if (e.button !== 0) return;
          e.preventDefault(); e.stopPropagation();
          if (handle.tabIndex === 0) handle.focus({preventScroll:true});
          origin = {rect:host.getBoundingClientRect(),x:e.clientX,y:e.clientY};
          libraryPresence.interact(true);
          handle.setPointerCapture(e.pointerId); frame.style.pointerEvents = 'none';
        });
        handle.addEventListener('pointermove', e => {
          if (origin) resize(origin.rect,edge,e.clientX-origin.x,e.clientY-origin.y);
        });
        const finish = () => {origin=null;frame.style.pointerEvents='';libraryPresence.interact(false);};
        for (const event of ['pointerup','pointercancel','lostpointercapture']) handle.addEventListener(event,finish);
        shadow.append(handle);
      }
      window.addEventListener('resize', () => { if(libraryOpen) { const r=host.getBoundingClientRect(); move(r.left,r.top); } });
      libraryHost = host;
    }
    libraryHost.dataset.theme = surfaceTheme;
    const target = getMountTarget();
    if (libraryHost.parentElement !== target) target.appendChild(libraryHost);
    libraryHost.style.setProperty('display', 'block', 'important');
    // A hidden window can outlive a viewport change; clamp it again when reopening.
    const bounds = libraryHost.getBoundingClientRect();
    libraryHost.style.setProperty('left', `${clamp(bounds.left,8,Math.max(8,innerWidth-bounds.width-8))}px`, 'important');
    libraryHost.style.setProperty('top', `${clamp(bounds.top,8,Math.max(8,innerHeight-bounds.height-8))}px`, 'important');
    libraryHost.style.setProperty('right', 'auto', 'important');
    libraryOpen = true;
    libraryPresence.open();
    updatePlayerEntryState();
    const frame = libraryHost.shadowRoot.querySelector('iframe');
    frame.focus();
    if (home) frame.contentWindow.postMessage({ type: 'MN_NAVIGATE_HOME' }, chrome.runtime.getURL('').replace(/\/$/, ''));
  } finally { libraryBusy = false; }
}


let ui = null;
let pendingMeta = null; // { title, timeSec, formatted, thumbnail, url }
let wasPlayingBefore = false;

let floatingStyles = null;
function ensureStyles() {
  if (floatingStyles) return floatingStyles;
  floatingStyles = `
  .mn-player-entry{
    all:initial;box-sizing:border-box!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;
    position:relative;flex:0 0 36px;width:36px;height:var(--mn-entry-height,32px);vertical-align:middle;margin:0 4px;
    border:0;border-radius:5px;background:transparent;color:#fff;cursor:pointer;line-height:1;opacity:.85;
  }
  .mn-player-entry img{display:block!important;flex:none!important;width:28px!important;height:28px!important;max-width:none!important;object-fit:contain;pointer-events:none;user-select:none;}
  .mn-player-entry:hover,.mn-player-entry[aria-expanded="true"]{opacity:1;background:#ffffff18;}
  .mn-player-entry:focus-visible{outline:2px solid #ddd0ef;outline-offset:-2px;opacity:1;}
  .mn-player-entry[data-dock="fallback"]{position:fixed;z-index:2147483646;color:#fff;background:#24202bc9;backdrop-filter:blur(8px);margin:0;width:36px;height:32px;opacity:0;pointer-events:none;transition:opacity 160ms ease;}
  .mn-player-entry[data-dock="fallback"][data-visible="true"],.mn-player-entry[data-dock="fallback"]:focus-visible{opacity:1;pointer-events:auto;}
  .mn-player-entry[hidden]{display:none!important;}
  @keyframes mnNoteEnter{from{opacity:0;translate:0 12px;}to{opacity:1;translate:0 0;}}
  .mn-qn{
    --mn-glass:rgba(27,22,39,.68);--mn-solid:#393244;--mn-input:rgba(24,19,35,.20);
    --mn-text:#faf8fd;--mn-meta:#e4ddea;--mn-accent:#ddd0ef;--mn-on-accent:#302a3b;
    --mn-line:rgba(246,239,255,.28);--mn-focus:#ddd0ef;--mn-subtle:#ddd0ef14;
    box-sizing:border-box;position:fixed;width:${QUICK_BOX_WIDTH}px;
    min-width:min(280px,calc(100vw - 32px));max-width:min(640px,calc(100vw - 32px));
    max-height:calc(100dvh - 32px);overflow:auto;container-type:inline-size;
    z-index:2147483647;background:var(--mn-glass);color:var(--mn-text);
    border:1px solid var(--mn-line);border-radius:16px;
    box-shadow:0 16px 48px #17111f33,0 2px 8px #17111f24,inset 0 1px 0 #ffffff29;
    backdrop-filter:blur(32px) saturate(1.25);-webkit-backdrop-filter:blur(32px) saturate(1.25);
    font-family:MiSans,-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;
    animation:mnNoteEnter 160ms ease-out;font-size:14px;line-height:1.5;color-scheme:dark;scrollbar-color:#887b9a transparent;
  }
  .mn-qn[data-theme="light"]{
    --mn-glass:rgba(248,245,252,.68);--mn-solid:#f0ecf5;--mn-input:rgba(255,255,255,.30);
    --mn-text:#352e41;--mn-meta:#655c73;--mn-accent:#665278;--mn-on-accent:#fff;
    --mn-line:rgba(255,255,255,.65);--mn-focus:#665278;--mn-subtle:#66527814;
    color-scheme:light;
  }
  .mn-qn *{box-sizing:border-box;}
  .mn-qn__top{
    padding:12px 16px;display:flex;gap:12px;align-items:center;
    background:transparent;border-bottom:1px solid var(--mn-subtle);
    color:var(--mn-meta);cursor:grab;user-select:none;
  }
  .mn-qn__top:active{cursor:grabbing;}
  .mn-qn__ctx{display:flex;min-width:0;flex:1;align-items:center;gap:8px;}
  .mn-qn__top-accent{
    min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    color:var(--mn-text);font-size:14px;line-height:1.5;font-weight:500;
  }
  .mn-qn__time{flex-shrink:0;color:var(--mn-accent);font-size:14px;font-variant-numeric:tabular-nums;white-space:nowrap;}
  .mn-qn__library{
    display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;
    position:relative;flex-shrink:0;background:transparent;border:0;border-radius:8px;color:var(--mn-meta);cursor:pointer;padding:2px;
  }
  .mn-qn__library:hover{background:var(--mn-subtle);}
  .mn-qn__library svg{display:block;width:18px;height:18px;}
  .mn-qn__library::after{content:attr(aria-label);position:absolute;z-index:3;right:0;top:calc(100% + 6px);width:max-content;max-width:220px;
    padding:6px 10px;border:1px solid var(--mn-line);border-radius:8px;background:var(--mn-solid);color:var(--mn-text);
    font:400 12px/1.5 MiSans,-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;box-shadow:0 4px 12px #17111f20;pointer-events:none;opacity:0;transition:opacity 120ms ease;}
  .mn-qn__library:is(:hover,:focus-visible)::after{opacity:1;}
  .mn-qn__mid{padding:12px 16px;}
  .mn-qn__tools{display:flex;flex:none;align-items:center;gap:2px;}
  .mn-qn__tools button{display:inline-flex;align-items:center;justify-content:center;position:relative;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:6px;color:var(--mn-meta);background:transparent;cursor:pointer;}
  .mn-qn__tools button:hover{color:var(--mn-accent);background:var(--mn-subtle);}
  .mn-qn__tools svg{display:block;flex:none;width:16px;height:16px;pointer-events:none;}
  .mn-qn__drag-hint{font-size:11px;line-height:1.5;color:var(--mn-meta);opacity:.8;padding:0 16px 8px;}

  .mn-qn__ta{
    width:100%;min-height:88px;max-height:400px;resize:none;display:block;
    padding:12px;border:1px solid var(--mn-line);border-radius:10px;outline:none;
    background:var(--mn-input);color:var(--mn-text);caret-color:var(--mn-accent);
    font:400 16px/1.8 MiSans,-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;
    transition:border-color 140ms ease;
  }
  .mn-qn__ta::placeholder{color:var(--mn-meta);opacity:.8;}
  .mn-qn__ta:focus{border-color:var(--mn-focus);box-shadow:none;}
  .mn-qn__ta::selection{background:var(--mn-accent);color:var(--mn-on-accent);}
  .mn-qn__foot{
    display:grid;grid-template-columns:auto auto 1fr;
    padding:0 16px 16px;align-items:center;gap:12px;background:transparent;
  }
  .mn-qn__sub-btn{
    display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:6px 8px;
    border:0;border-radius:7px;background:transparent;color:var(--mn-accent);
    font:500 14px/1.5 MiSans,-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;
    cursor:pointer;white-space:nowrap;letter-spacing:0;
  }
  .mn-qn__sub-btn:hover{background:var(--mn-subtle);color:var(--mn-text);}
  .mn-qn__save-link{
    justify-self:end;min-height:36px;padding:8px 16px;border:1px solid transparent;border-radius:8px;
    background:var(--mn-accent);color:var(--mn-on-accent);text-decoration:none;white-space:nowrap;
    font:500 14px/1.5 MiSans,-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;cursor:pointer;
  }
  .mn-qn__save-link:hover{background:var(--mn-accent);color:var(--mn-on-accent);}
  .mn-qn__save-link:disabled,.mn-qn__sub-btn:disabled{opacity:.45;cursor:not-allowed;}
  .mn-qn button:focus-visible{outline:2px solid var(--mn-accent);outline-offset:3px;}
  .mn-qn__msg{padding:0 16px 16px;font-size:12px;line-height:1.5;color:var(--mn-meta);}
  .mn-qn__msg.good{color:var(--mn-accent);}.mn-qn__msg.bad{color:#f0b8c3;}
  .mn-qn[data-theme="light"] .mn-qn__msg.good{color:var(--mn-accent);}
  .mn-qn[data-theme="light"] .mn-qn__msg.bad{color:#a43648;}
  .mn-qn__resize-handle{
    position:absolute;bottom:0;left:0;right:auto;width:16px;height:16px;cursor:sw-resize;
    opacity:.28;background:linear-gradient(225deg,transparent 48%,#c6bdd0 48%,#c6bdd0 53%,transparent 53%,
      transparent 68%,#c6bdd0 68%,#c6bdd0 73%,transparent 73%);
  }
  .mn-qn[data-rs-dir="right"] .mn-qn__resize-handle{
    left:auto;right:0;cursor:se-resize;transform:scaleX(-1);
  }
  .mn-qn__resize-handle:hover{opacity:.6;}
  @supports not (backdrop-filter:blur(1px)) {.mn-qn{background:var(--mn-solid);}}
  @media(prefers-reduced-transparency:reduce){.mn-qn{background:var(--mn-solid);backdrop-filter:none;-webkit-backdrop-filter:none;}}
  @container(max-width:420px){
    .mn-qn__ctx{flex-wrap:wrap;gap:4px;}
    .mn-qn__top-accent{width:100%;}
    .mn-qn__time{font-size:14px;}
    .mn-qn__foot{gap:8px;}
    .mn-qn__sub-btn{justify-self:start;justify-items:start;}
    .mn-qn__save-link{justify-self:end;}
  }
  .mn-qn button:focus-visible{
    outline:2px solid transparent;outline-offset:3px;border-radius:12px;
    box-shadow:0 0 0 2px #302a3b,0 0 0 4px #ddd0ef,0 0 0 7px #ddd0ef22;
  }
  .mn-qn[data-theme="light"] button:focus-visible{
    box-shadow:0 0 0 2px #f5f2f8,0 0 0 4px #665278,0 0 0 7px #66527822;
  }
  @media(forced-colors:active){.mn-qn button:focus-visible{outline:2px solid Highlight;}}
  @media(prefers-reduced-motion:reduce){
    .mn-player-entry,.mn-qn,.mn-qn__ta,.mn-qn__library::after{animation:none!important;transition:none!important;}
  }
  `;
  return floatingStyles;
}

// Website button/SVG resets must never reach the editor or the player entry.
// Keep the roots open for accessibility, inspection and annotation tools.
function createFloatingSurface(kind, element) {
  const host = document.createElement('aside-surface');
  host.dataset.asideSurface = kind;
  host.style.setProperty('all', 'initial', 'important');
  host.style.setProperty('display', 'contents', 'important');
  host.style.setProperty('direction', 'ltr', 'important');
  const root = host.attachShadow({mode:'open'});
  const style = document.createElement('style');
  style.textContent = ensureStyles();
  root.append(style, element);
  return host;
}

// Use the exact approved product artwork, isolated from the site's icon styles.
function setPlayerEntryIcon(button, open) {
  button.setAttribute('aria-expanded', String(open));
  button.setAttribute('aria-label', open ? '收起旁白记录' : '旁白 · 记录此刻');
  if (!button.querySelector('img')) {
    const icon = document.createElement('img');
    icon.src = chrome.runtime.getURL('icons/icon128.png');
    icon.alt = '';
    icon.setAttribute('aria-hidden', 'true');
    icon.width = icon.height = 28;
    icon.draggable = false;
    button.replaceChildren(icon);
  }
}

const quickMessageTimers = new WeakMap();
function showQuickMessage(qn, text, kind) {
  const msg = qn.querySelector('.mn-qn__msg');
  if (!msg) return;
  clearTimeout(quickMessageTimers.get(qn));
  msg.hidden = false;
  msg.classList.toggle('good', kind === 'good');
  msg.classList.toggle('bad', kind === 'bad');
  msg.textContent = text;
  // Success/info fades out; failures stay visible so unsaved work is never concealed.
  if (kind === 'good') quickMessageTimers.set(qn, setTimeout(() => {
    msg.hidden = true;
    quickMessageTimers.delete(qn);
  }, 3000));
}

let fallbackAwakeUntil = 0;
let fallbackSleepTimer = null;
let layoutFrame = null;
function ensurePlayerEntry() {
  const video=getVideoElement();
  if (!video) { if(ui?.trigger)ui.trigger.hidden=true; return; }
  ensureStyles();
  ui=ui || {};
  if (!ui.trigger) {
    const button=document.createElement('button');
    button.type='button';button.className='mn-player-entry';button.dataset.theme=surfaceTheme;
    const alt=/Mac|iPhone|iPad/i.test(navigator.platform) ? 'Option' : 'Alt';
    button.title=`旁白 · 记录此刻（${alt}+N 打开 / 收起）`;
    button.setAttribute('aria-keyshortcuts','Alt+N');
    setPlayerEntryIcon(button,false);
    button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();void toggleQuickNote('player');});
    ui.trigger=button;
    ui.entryHost=createFloatingSurface('player-entry',button);
  }
  const controls=playerDock.findControls(video,detectSite());
  const native=controls && (!document.fullscreenElement || document.fullscreenElement.contains(controls));
  const parent=native ? controls : getMountTarget();
  if (ui.entryHost.parentElement!==parent) parent.prepend(ui.entryHost);
  ui.trigger.dataset.dock=native ? 'native' : 'fallback';
  if(native){ui.trigger.style.removeProperty('left');ui.trigger.style.removeProperty('top');ui.trigger.style.setProperty('--mn-entry-height',`${clamp(controls.getBoundingClientRect().height || 32,28,48)}px`);}
  updatePlayerEntryState();
}
function updatePlayerEntryState() {
  if(!ui?.trigger)return;
  const video=getVideoElement();
  const r=video?.getBoundingClientRect();
  ui.trigger.hidden=libraryOpen || !r || r.bottom<=0 || r.top>=innerHeight;
  if(ui.trigger.dataset.dock==='fallback' && r) {
    ui.trigger.style.left=`${clamp(r.left+r.width*.62-18,16,innerWidth-52)}px`;
    ui.trigger.style.top=`${clamp(r.bottom-42,16,innerHeight-48)}px`;
    ui.trigger.dataset.visible=String(Date.now()<fallbackAwakeUntil || Boolean(ui.qn) || video.paused);
  }
}
function wakePlayerEntry(event) {
  const r=getVideoElement()?.getBoundingClientRect();
  if(!r || event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom)return;
  fallbackAwakeUntil=Date.now()+2200;
  updatePlayerEntryState();
  clearTimeout(fallbackSleepTimer);
  fallbackSleepTimer=setTimeout(updatePlayerEntryState,2250);
}
function queuePlayerLayout() {
  if(layoutFrame!=null)return;
  layoutFrame=requestAnimationFrame(()=>{layoutFrame=null;updatePlayerEntryState();repositionQuickBox();});
}
function repositionQuickBox() {
  if(!ui?.qn || ui.dragging || ui.resizing)return;
  const q=ui.qn;
  q.style.maxHeight=`${Math.max(80,innerHeight-32)}px`;
  const video=getVideoElement()?.getBoundingClientRect();
  const subtitles=[];
  if(video) for(const node of document.querySelectorAll('.ytp-caption-segment,.bpx-player-subtitle-panel-area,.bilibili-player-video-subtitle,.iqp-subtitle,.sub-text,.txp_subtitle_txt,.subtitle_player_normal,.subtitle-container,[class*="subtitle"],[class*="caption"]')) {
    if(!node.textContent?.trim())continue;
    const r=node.getBoundingClientRect();
    const style=getComputedStyle(node);
    if(r.width>0 && r.height>0 && r.height<(video.bottom-video.top)*.5 && r.bottom>video.top && r.top<video.bottom && r.right>video.left && r.left<video.right && style.visibility!=='hidden' && style.display!=='none' && Number(style.opacity)>0)subtitles.push(r);
  }
  const pos=playerDock.placement(video,{width:innerWidth,height:innerHeight},q.getBoundingClientRect(),quickPlacement,{anchor:ui.trigger?.getBoundingClientRect(),subtitles});
  q.style.left=`${pos.left}px`;q.style.top=`${pos.top}px`;q.dataset.rsDir='right';
}
window.addEventListener('pointermove',wakePlayerEntry,{passive:true});
window.addEventListener('scroll',queuePlayerLayout,{passive:true,capture:true});
window.addEventListener('resize',queuePlayerLayout,{passive:true});

/** 缩小后再 JPEG，控制体积，便于经扩展存储/消息可靠传递 */
async function captureCurrentFrame(video) {
  try {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    const maxW = 1280;
    const maxH = 720;
    const scale = Math.min(1, maxW / w, maxH / h);
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, w, h, 0, 0, cw, ch);
    try {
      return canvas.toDataURL("image/jpeg", 0.82);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * 经 Background 调用 saveEntry。大图不放 sendMessage：优先 local 暂存，再 session，最后才内联小图。
 */
async function stashThumbnailForBridge(metaOut) {
  const raw = metaOut.thumbnail;
  if (!raw || typeof raw !== "string") {
    return { ...metaOut, thumbnail: null };
  }
  const clean = { ...metaOut };
  delete clean._thumbnailSessionKey;
  delete clean._thumbnailLocalKey;

  const localKey = `mn_thumb_l_${crypto.randomUUID()}`;
  try {
    await chrome.storage.local.set({ [localKey]: raw });
    return { ...clean, thumbnail: null, _thumbnailLocalKey: localKey };
  } catch {
    // ignore
  }

  const sessKey = `mn_thumb_s_${crypto.randomUUID()}`;
  try {
    await chrome.storage.session.set({ [sessKey]: raw });
    return { ...clean, thumbnail: null, _thumbnailSessionKey: sessKey };
  } catch {
    // ignore
  }

  if (raw.length <= 200000) {
    return { ...clean, thumbnail: raw };
  }
  return { ...clean, thumbnail: null };
}

/**
 * MV3 下对 chrome.runtime.sendMessage 使用 await 时，lastError 与返回值容易不同步。
 * 必须用回调并在回调里检查 lastError，才能拿到「无法连接后台」等真实原因。
 */
function sendExtensionMessage(payload) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(payload, (response) => {
        const le = chrome.runtime.lastError;
        if (le) {
          reject(new Error(le.message || "扩展通信失败"));
          return;
        }
        resolve(response);
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

async function saveQuickEntry(meta, text) {
  const send = async (m) => {
    let metaOut = await stashThumbnailForBridge({ ...m });
    const res = await sendExtensionMessage({
      type: "MN_SAVE_QUICK_NOTE",
      meta: metaOut,
      text: text ?? ""
    });
    if (res == null || res.success !== true) {
      const detail =
        res && typeof res.error === "string" && res.error.trim()
          ? res.error
          : "后台未返回成功（请打开 chrome://extensions → 本扩展 →「Service Worker」查看是否报错）";
      throw new Error(detail);
    }
    return res;
  };
  try {
    return await send(meta);
  } catch (e) {
    const msg = String(e?.message || e || "");
    const big =
      msg.includes("QUOTA") ||
      msg.includes("quota") ||
      msg.includes("超过") ||
      msg.includes("Message length exceeded") ||
      msg.includes("invalid arguments");
    if (meta?.thumbnail && big) {
      return await send({ ...meta, thumbnail: null });
    }
    throw e;
  }
}

function mapSaveError(err) {
  let msg = "";
  if (err instanceof Error && err.message) {
    msg = err.message;
  } else if (typeof err === "string") {
    msg = err;
  } else if (err != null && typeof err === "object") {
    try {
      msg = JSON.stringify(err);
    } catch {
      msg = String(err);
    }
  } else {
    msg = String(err ?? "");
  }
  if (!msg.trim()) {
    msg = "未知错误（请打开本页控制台 Console 查看）";
  }
  if (msg.includes("内容不能为空")) return { text: "内容不能为空", code: "EMPTY_CONTENT" };
  if (msg.includes("标题为空")) return { text: "无法获取视频标题，请刷新页面后重试", code: "EMPTY_TITLE" };
  const quotaHints = ["QUOTA_BYTES", "MAX_ITEM_SIZE", "QuotaExceededError", "quota", "exceeded"];
  if (quotaHints.some((k) => msg.toLowerCase().includes(k.toLowerCase()))) {
    return { text: "存储空间不足（可能是截图过大），将尝试不保存截图", code: "QUOTA" };
  }
  if (
    msg.includes("Receiving end") ||
    msg.includes("message port") ||
    msg.includes("Extension context invalidated")
  ) {
    return { text: "扩展未就绪，请刷新本页或在 chrome://extensions 重新加载扩展", code: "GENERIC" };
  }
  if (msg.includes("Message length exceeded") || msg.includes("invalid arguments")) {
    return { text: "数据过大无法传送，已自动去掉截图后重试", code: "TOO_LARGE" };
  }
  const short = msg.replace(/\s+/g, " ").trim().slice(0, 280);
  return { text: `保存失败：${short}`, code: "GENERIC" };
}

let quickToggleDesired = null;
let quickToggleTask = null;
function toggleQuickNote(from) {
  if(ui?.composing || ui?.qn?.dataset.saving==='1')return;
  quickToggleDesired=!(quickToggleDesired ?? Boolean(ui?.qn || quickOpening));
  if(quickToggleTask)return quickToggleTask;
  quickToggleTask=(async()=>{
    while(quickToggleDesired!==null){
      const want=quickToggleDesired;quickToggleDesired=null;
      if(want && !ui?.qn)await openQuickNote(from);
      else if(!want && ui?.qn)await closeQuickNote('toggle');
    }
  })().finally(()=>{quickToggleTask=null;});
  return quickToggleTask;
}
let quickOpening = false;
async function openQuickNote(from) {
  if (quickOpening || ui?.qn) return;
  quickOpening = true;
  try { await openQuickNoteImpl(from); }
  catch (e) { console.warn('[Aside] open failed:', e.message); }
  finally { quickOpening = false; }
}
async function openQuickNoteImpl(_from) {
  if (detectSite() === "unknown" || !getVideoElement()) return;
  hideLibrary();
  ensurePlayerEntry();
  quickPlacement = null;
  if (!ui?.trigger || ui?.qn) return;

  const video = getVideoElement();
  let timeSec = null, formatted = null, thumbnail = null;
  if (video) {
    wasPlayingBefore = !video.paused;
    try { video.pause(); } catch { /* ignore */ }
    timeSec = Number(video.currentTime || 0);
    formatted = formatSeconds(timeSec) || "00:00";
    thumbnail = await captureCurrentFrame(video);
  } else {
    wasPlayingBefore = false;
  }

  let title = getTitle() || document.title || "未命名";
  const url = location.href;
  const restored = await sendExtensionMessage({ type: 'MN_GET_QUICK_DRAFT', url });
  if (!restored?.success) {
    if (wasPlayingBefore) video?.play().catch(() => {});
    throw new Error(restored?.error || '无法读取草稿');
  }
  pendingMeta = restored.draft?.meta || { id: crypto.randomUUID(), title, timeSec, formatted, thumbnail, url };
  pendingMeta.owner = restored.owner;
  title = pendingMeta.title;
  formatted = pendingMeta.formatted;

  const isMac = /Mac|iPhone|iPad/i.test(navigator.userAgentData?.platform || navigator.platform || "");
  const altLabel = isMac ? "Option" : "Alt";
  const saveLabel = isMac ? "⌘ Enter" : "Ctrl + Enter";
  const qn = document.createElement("div");
  qn.className = "mn-qn";
  qn.dataset.theme = surfaceTheme;
  qn.setAttribute("role", "dialog");
  qn.setAttribute('aria-label', '快速记录');
  qn.style.position = "fixed";
  qn.innerHTML = `
    <div class="mn-qn__top"> <span class="mn-qn__ctx"></span> <div class="mn-qn__tools"><button type="button" class="mn-qn__library" aria-label="返回旁白首页"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 15 15 5M5 5h10v10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button type="button" class="mn-qn__close" aria-label="收起快速记录" title="收起 · ${altLabel}+N"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></div></div>
    <div class="mn-qn__mid">
      <textarea class="mn-qn__ta mn-qn__ta--serif" aria-label="记录内容" placeholder=""></textarea>
    </div>
    <div class="mn-qn__foot">
      <button class="mn-qn__sub-btn" data-act="timestamp" type="button" title="获取当前时间 · ${altLabel} + T" aria-keyshortcuts="Alt+T">时间</button>
      <button class="mn-qn__sub-btn" data-act="subtitle" type="button" title="插入当前字幕 · ${altLabel} + S" aria-keyshortcuts="Alt+S">字幕</button>
      <button class="mn-qn__save-link" data-act="save" type="button" title="保存记录 · ${saveLabel}" aria-keyshortcuts="${isMac ? "Meta" : "Control"}+Enter">保存</button>
    </div>
    <div class="mn-qn__msg" role="status" aria-live="polite" hidden></div>
    <div class="mn-qn__resize-handle" title="拖拽调整大小"></div>
  `;
  qn.querySelector('.mn-qn__close').addEventListener('click',()=>void closeQuickNote('close'));
  qn.querySelector('.mn-qn__library').addEventListener('click', async () => {
    // Resolve the sender tab in the background, including when the library was never opened.
    if (libraryTabId != null) await showLibrary(libraryTabId, true);
    else await sendExtensionMessage({ type: 'OPEN_SIDE_PANEL_FOCUS' });
  });
  const ctx = qn.querySelector(".mn-qn__ctx");
  const titleSpan = document.createElement('span');
  titleSpan.className = 'mn-qn__top-accent';
  titleSpan.textContent = title;
  ctx.appendChild(titleSpan);
  if (formatted) {
    const stamp = document.createElement('span');
    stamp.className = 'mn-qn__time';
    stamp.textContent = ` ◷ ${formatted}`;
    ctx.appendChild(stamp);
  }
  const ta = qn.querySelector("textarea");
  ta.placeholder = "一个观点、一句台词，或你的想法…";
  ta.value = restored.draft?.text || "";
  const msg = qn.querySelector(".mn-qn__msg");
  const btnSave = qn.querySelector('[data-act="save"]');
  const btnSubtitle = qn.querySelector('[data-act="subtitle"]');
  const btnTimestamp = qn.querySelector('[data-act="timestamp"]');
  const topBar = qn.querySelector(".mn-qn__top");
  topBar.title = "拖动调整位置";
  const resizeHandle = qn.querySelector(".mn-qn__resize-handle");

  btnSubtitle?.addEventListener('click', insertCurrentSubtitle);

  // ── Stop clicks inside box from reaching the click-outside listener
  // Also freeze page text-selection while the pointer is down inside the popup,
  // so dragging in the textarea doesn't accidentally select page content beneath.
  qn.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    const body = document.body;
    const prev = body.style.userSelect;
    body.style.userSelect = "none";
    document.addEventListener("mouseup", () => {
      body.style.userSelect = prev;
    }, { once: true, capture: true });
  });

  // ── Drag the box by its header ──────────────────────────────────
  let qnDragging = false, qnStartX = 0, qnStartY = 0, qnOriginLeft = 0, qnOriginTop = 0;
  const onTopDown = (e) => {
    if (e.target === resizeHandle || e.target.closest('button')) return;
    qnDragging = true; ui.dragging = true;
    qnStartX = e.clientX; qnStartY = e.clientY;
    const r = qn.getBoundingClientRect();
    qnOriginLeft = r.left; qnOriginTop = r.top;
    qn.style.transition = "none";
    window.addEventListener("mousemove", onTopMove, true);
    window.addEventListener("mouseup", onTopUp, true);
  };
  const onTopMove = (e) => {
    if (!qnDragging) return;
    const nx = clamp(qnOriginLeft + e.clientX - qnStartX, 16, window.innerWidth - qn.offsetWidth - 16);
    const ny = clamp(qnOriginTop  + e.clientY - qnStartY, 16, window.innerHeight - qn.offsetHeight - 16);
    qn.style.left = `${nx}px`; qn.style.top = `${ny}px`;
    qn.style.right = "auto";
  };
  const onTopUp = () => {
    const moved = qnDragging && (Math.abs(qn.getBoundingClientRect().left-qnOriginLeft)>2 || Math.abs(qn.getBoundingClientRect().top-qnOriginTop)>2);
    qnDragging = false; ui.dragging = false;
    if(moved)updateQuickPlacement();
    qn.style.transition = "";
    window.removeEventListener("mousemove", onTopMove, true);
    window.removeEventListener("mouseup", onTopUp, true);
  };
  topBar.addEventListener("mousedown", onTopDown);

  // ── Resize handle: drag bottom-left corner to resize the box ───
  let rsActive = false, rsStartX = 0, rsStartY = 0, rsW0 = 0, rsH0 = 0, rsLeft0 = 0;
  let rsTop0 = 0;
  resizeHandle.addEventListener("mousedown", (e) => {
    e.preventDefault(); e.stopPropagation();
    rsActive = true; ui.resizing = true;
    rsStartX = e.clientX; rsStartY = e.clientY;
    const rect = qn.getBoundingClientRect();
    rsW0 = rect.width; rsH0 = rect.height; rsLeft0 = rect.left; rsTop0 = rect.top;
    window.addEventListener("mousemove", onRsMove, true);
    window.addEventListener("mouseup", onRsUp, true);
  });
  const onRsMove = (e) => {
    if (!rsActive) return;
    const fromRight = qn.dataset.rsDir === "right";
    const right = rsLeft0 + rsW0;
    const maxW = Math.min(640, fromRight ? window.innerWidth-rsLeft0-16 : right-16);
    const dx = e.clientX-rsStartX;
    const nw = clamp(rsW0+(fromRight ? dx : -dx),Math.min(280,maxW),maxW);
    const maxH = window.innerHeight-rsTop0-16;
    const nh = clamp(rsH0+e.clientY-rsStartY,Math.min(280,maxH),maxH);
    qn.style.width = `${nw}px`;
    qn.style.left = `${fromRight ? rsLeft0 : right-nw}px`;
    qn.style.right = "auto";
    const overhead = qn.offsetHeight-ta.offsetHeight;
    ta.style.height = `${Math.max(88,nh-overhead)}px`;
    qn.style.maxHeight = `${maxH}px`;
  };
  const onRsUp = () => {
    rsActive = false; ui.resizing = false;
    if(quickPlacement)updateQuickPlacement();else repositionQuickBox();
    window.removeEventListener("mousemove", onRsMove, true);
    window.removeEventListener("mouseup", onRsUp, true);
  };

  // ── Click anywhere outside the box closes it ────────────────────
  const onClickOutside = (e) => {
    if (!ui?.qn) return;
    const path = e.composedPath();
    if (!path.includes(ui.qn) && !path.includes(ui.trigger)) closeQuickNote("outside");
  };
  // defer one tick so the opening mousedown doesn't immediately close
  setTimeout(() => {if(ui?.qn === qn)document.addEventListener("mousedown", onClickOutside, true);}, 0);

  // Store cleanup refs so closeQuickNote can remove them
  ui._outsideListener = onClickOutside;
  ui.cleanupMotion = () => {
    window.removeEventListener('mousemove',onTopMove,true);window.removeEventListener('mouseup',onTopUp,true);
    window.removeEventListener('mousemove',onRsMove,true);window.removeEventListener('mouseup',onRsUp,true);
    ui.dragging=false;ui.resizing=false;
  };

  const showMsg = (text, kind) => showQuickMessage(qn, text, kind);

  const renderTagsPreview = () => {
    const ex = extractTagsFromContent(ta.value);
    if (!ex.tags.length) return "";
    return `标签：${ex.tags.map((t) => `#${t}`).join(" ")}`;
  };

  let saving = false;
  let saved = false;
  let updatingTime = false;
  let timestampUpdate = Promise.resolve();
  let draftQueue = Promise.resolve();
  const draftMeta = { ...pendingMeta };
  const refreshTimestamp = () => {
    if (saving || saved || updatingTime) return;
    if (!video?.isConnected || location.href !== url) { showMsg('请回到这条记录所属的视频再获取时间', 'bad'); return; }
    const seconds = Number(video.currentTime);
    if (!Number.isFinite(seconds)) { showMsg('暂时无法读取时间', 'bad'); return; }
    draftMeta.timeSec = seconds;
    draftMeta.formatted = formatSeconds(seconds);
    let stamp = ctx.querySelector('.mn-qn__time');
    if (!stamp) { stamp=document.createElement('span');stamp.className='mn-qn__time';ctx.append(stamp); }
    stamp.textContent = ` ◷ ${draftMeta.formatted}`;
    updatingTime = true;
    btnTimestamp.disabled = true;
    timestampUpdate = (async () => {
      // Keep the attached image aligned with the new timestamp; a failed capture must not retain an old frame.
      try { draftMeta.thumbnail = await captureCurrentFrame(video); }
      catch { draftMeta.thumbnail = null; }
      hasDraftPicture = false;
      await persistDraft();
      showMsg('时间戳已更新', 'good');
    })().catch(() => { /* persistDraft displays the failure and keeps the editor open */ })
      .finally(() => { updatingTime = false;btnTimestamp.disabled = saving || saved; });
    ui.timestampUpdate = timestampUpdate;
    return timestampUpdate;
  };
  btnTimestamp.addEventListener('click', refreshTimestamp);
  let hasDraftPicture = Boolean(restored.draft);
  const persistDraft = () => {
    const text = ta.value;
    const meta = { ...draftMeta };
    if (hasDraftPicture) delete meta.thumbnail;
    const write = draftQueue.catch(() => {}).then(async () => {
      const result = await sendExtensionMessage({ type: 'MN_PUT_QUICK_DRAFT', url: draftMeta.url, owner: draftMeta.owner, meta, text });
      if (!result?.success) throw new Error(result?.error || '草稿保存失败');
      hasDraftPicture = true;
    });
    draftQueue = write;
    write.catch(e => showMsg(`草稿未保存：${e.message}`, 'bad'));
    return write;
  };

  const doSave = async () => {
    if (saving || saved) return;
    saving = true;
    qn.dataset.saving = '1';
    btnSave.disabled = true;
    ta.disabled = true;
    btnSubtitle.disabled = true;
    btnTimestamp.disabled = true;
    try {
      await timestampUpdate;
      await persistDraft();
      const ex = extractTagsFromContent(ta.value);
      const saveRes = await saveQuickEntry(
        { ...draftMeta, entryTags: ex.tags },
        ex.content
      );
      saved = true;
      await sendExtensionMessage({ type: 'MN_CLEAR_QUICK_DRAFT', url: draftMeta.url, owner: draftMeta.owner, entryId: draftMeta.id }).catch(() => {});
      showMsg(
        saveRes?.droppedThumb ? "✓ 已保存到本机（截图未保存）" : "✓ 已保存到本机",
        "good"
      );
      setTimeout(() => closeQuickNote("saved"), 800);
    } catch (err) {
      console.error("[MovieNotes] quick save error", err);
      showMsg(mapSaveError(err).text, "bad");
      // Keep the error in the editor; unsaved content remains available.
      if (ui?.trigger) {
        ui.trigger.classList.add("mn-error");
        setTimeout(() => ui?.trigger?.classList.remove("mn-error"), 700);
      }
      btnSave.disabled = false;
      ta.disabled = false;
      btnSubtitle.disabled = false;
      btnTimestamp.disabled = false;
      saving = false;
      qn.dataset.saving = '0';
      ta.focus();
    }
  };

  btnSave.addEventListener("click", doSave);
  qn.addEventListener('compositionstart', () => { ui.composing = true; });
  qn.addEventListener('compositionend', () => { ui.composing = false; });
  qn.addEventListener("keydown", async (e) => {
    if (e.key === "Escape") return;
    e.stopPropagation();
    if (e.isComposing || e.keyCode === 229 || ui?.composing || e.repeat) return;
    if (e.key === 'Tab') {
      const controls = [...qn.querySelectorAll('button:not(:disabled),textarea:not(:disabled)')].filter(n=>n.getClientRects().length);
      const first=controls[0], last=controls.at(-1);
      const active = qn.getRootNode().activeElement;
      if (e.shiftKey && active === first) { e.preventDefault();last?.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault();first?.focus(); }
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (e.code === 'KeyS') { e.preventDefault();insertCurrentSubtitle(); }
      if (e.code === 'KeyT') { e.preventDefault();void refreshTimestamp(); }
      return;
    }
    const isEnter = e.key === "Enter";
    const mod = e.metaKey || e.ctrlKey;
    if (isEnter && mod && !e.isComposing) { e.preventDefault(); await doSave(); }
  });
  ta.addEventListener("input", () => {
    void persistDraft();
    const s = renderTagsPreview();
    if (s) showMsg(s, "good");
    else msg.hidden = true;
  });

  ui.quickHost = createFloatingSurface('quick-note', qn);
  getMountTarget().appendChild(ui.quickHost);
  ui.qn = qn;
  ui.sizeObserver = new ResizeObserver(queuePlayerLayout);ui.sizeObserver.observe(qn);
  if(video)ui.sizeObserver.observe(video);
  ui.sizeObserver.observe(ui.trigger);
  ui.submitQuick = doSave;
  ui.persistDraft = persistDraft;
  ui.recordingVideo = video;
  ui.recordingWasPlaying = wasPlayingBefore;
  if (!pendingMeta.thumbnail) showMsg('当前画面无法截图，仍可保存文字与时间点', 'bad');

  ui.trigger.classList.add("mn-open");
  setPlayerEntryIcon(ui.trigger, true);
  ui.trigger.classList.remove("mn-paused");

  repositionQuickBox();
  ta.focus();
}

async function closeQuickNote(_why) {
  if (!ui?.qn || ui.closing) return;
  if (ui.qn.dataset.saving === '1' && _why !== 'saved') return;
  ui.closing = true;
  if (_why !== 'saved') {
    try { await ui.timestampUpdate; await ui.persistDraft?.(); }
    catch { ui.closing = false; return; }
  }
  if (ui.recordingWasPlaying) {
    const video = ui.recordingVideo;
    try { if (video) video.play().catch(() => {}); } catch { /* ignore */ }
  }
  // Remove global listeners registered by openQuickNote
  ui.cleanupMotion?.();ui.cleanupMotion=null;
  ui.sizeObserver?.disconnect();ui.sizeObserver=null;
  if (ui?._outsideListener) {
    document.removeEventListener("mousedown", ui._outsideListener, true);
    ui._outsideListener = null;
  }
  if (ui?.qn) {
    clearTimeout(quickMessageTimers.get(ui.qn));
    quickMessageTimers.delete(ui.qn);
    ui.qn.remove();
    ui.qn = null;
    ui.quickHost?.remove();
    ui.quickHost = null;
  }
  if (ui) { ui.submitQuick = null; ui.persistDraft = null; ui.timestampUpdate = null; ui.closing = false; ui.composing = false; }
  pendingMeta = null;
  if (ui?.trigger) {
    ui.trigger.classList.remove("mn-open");
    setPlayerEntryIcon(ui.trigger, false);
  }
  updatePlayerEntryState();
  if (_why !== 'library' && _why !== 'outside') restorePageFocus(ui?.recordingVideo);
}

/** 读取当前页面显示的字幕/台词文本 */
function getCurrentSubtitle() {
  const site = detectSite();
  let text = "";

  if (site === "youtube") {
    // YouTube 字幕渲染在 .ytp-caption-segment 里
    const segs = document.querySelectorAll(".ytp-caption-segment");
    text = [...segs].map((s) => s.textContent.trim()).filter(Boolean).join(" ");
  } else if (site === "bilibili") {
    // B站字幕：.bpx-player-subtitle-panel-area 或 .bilibili-player-video-subtitle
    const el =
      document.querySelector(".bpx-player-subtitle-panel-area") ||
      document.querySelector(".bilibili-player-video-subtitle span");
    text = (el?.textContent || "").trim();
  } else if (site === "iqiyi") {
    const el = document.querySelector(".iqp-subtitle") || document.querySelector(".subtitle-content");
    text = (el?.textContent || "").trim();
  } else if (site === "youku") {
    const el = document.querySelector(".sub-text");
    text = (el?.textContent || "").trim();
  } else if (site === "tencent") {
    const el =
      document.querySelector(".txp_subtitle_txt") ||
      document.querySelector(".subtitle_player_normal") ||
      document.querySelector("[class*='subtitle']");
    text = (el?.textContent || "").trim();
  } else if (site === "mgtv") {
    const el = document.querySelector(".subtitle-container") || document.querySelector("[class*='subtitle']");
    text = (el?.textContent || "").trim();
  }

  // 通用兜底：找可见的字幕容器
  if (!text) {
    const candidates = document.querySelectorAll("[class*='subtitle'],[class*='caption'],[class*='lyric']");
    for (const c of candidates) {
      const t = (c.textContent || "").trim();
      if (c.getClientRects().length && getComputedStyle(c).visibility !== "hidden" && t && t.length < 200) { text = t; break; }
    }
  }
  return text;
}

function insertCurrentSubtitle() {
  if (!ui?.qn || ui.qn.dataset.saving === "1") return;
  const sub = getCurrentSubtitle();
  const ta = ui.qn.querySelector("textarea");
  if (!ta) return;
  if (sub) {
    ta.setRangeText(`「${sub}」`, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event("input"));
    ta.focus();
    showQuickMessage(ui.qn, "字幕已插入", "good");
  } else {
    showQuickMessage(ui.qn, "未检测到字幕", "bad");
  }
}

/** Alt/Option+N toggles the draft; Escape remains owned by the video player. */
function onGlobalAltN(e) {
  if (nativeShortcuts) return;
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing || detectSite() === "unknown" || !getVideoElement()) return;
  if (e.code !== "KeyN") return;
  if (e.repeat) return;
  // 抢占优先级：阻止默认行为 + 阻止同节点其他监听器（site 自带的 Alt+N 不再触发）
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  void toggleQuickNote("hotkey");
}

// 在 window capture 阶段最早接管 Alt+N，覆盖站点（如 YouTube/B 站）已绑定的同键
window.addEventListener("keydown", onGlobalAltN, true);

// Theme is extension-owned state. Do not trust messages or attributes from the host page.
const initialThemeRevision = surfaceThemeRevision;
chrome.storage.local.get('uiTheme').then(({uiTheme}) => {
  if (surfaceThemeRevision === initialThemeRevision) applySurfaceTheme(uiTheme);
}).catch(() => {});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.asideLibraryPinned) libraryPresence.pin(changes.asideLibraryPinned.newValue);
  if (area === 'local' && changes.uiTheme) {
    surfaceThemeRevision += 1;
    applySurfaceTheme(changes.uiTheme.newValue);
  }
});

// 初始化注入
if (detectSite() !== "unknown") {
  let domCheckTid = null;
  const scheduleDomCheck = () => {
    if (domCheckTid) return;
    domCheckTid = setTimeout(() => {
      domCheckTid = null;
      if (document.visibilityState === "hidden") return;
      try { hookVideoLifecycle(); } catch { /* ignore */ }
      try { ensurePlayerEntry(); } catch { /* ignore */ }
      updatePlayerEntryState();
      if(ui?.qn)queuePlayerLayout();
    }, 400);
  };

  // Initial injection
  scheduleDomCheck();

  // SPA 重渲染 / 视频元素延迟插入：观察 DOM 变化
  try {
    const mo = new MutationObserver(scheduleDomCheck);
    mo.observe(document.documentElement, { childList: true, characterData:true, subtree: true });
  } catch {
    // ignore — very old browser fallback
  }

  // 标签页切回前台时再检查一次（隐藏期间 MO 可能仍触发但 schedule 会 early-return）
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleDomCheck();
  });
}


})();
