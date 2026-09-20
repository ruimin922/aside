// A browser-only implementation of the Chrome APIs used by panel.js.
// Data lives on the preview origin, separate from the installed extension.
(() => {
  const storageKey = 'aside:agentation:preview:v1';
  const changed = new Set();
  const date = '2026-09-20T00:00:00.000Z';
  const tab = { id: 7, url: 'https://www.youtube.com/watch?v=aside-preview' };
  const title = '旁白示例 · 留下观看时产生的想法';
  const defaults = {
    uiTheme: 'dark', asideDataOwner: 'guest',
    'aside:guest:storageDataVersion': 2,
    'aside:guest:movieNotes': [{
      id: 'aside-preview-video', movieTitle: title, videoUrl: tab.url,
      tags: ['示例'], createdAt: date, updatedAt: date,
      entries: [{
        id: 'aside-preview-entry', content: '有些片刻值得停下来，留下一句自己的想法。',
        timestampType: 'point', timestamp: 754, formattedTimestamp: '00:12:34',
        tags: ['灵感'], videoUrl: tab.url, createdAt: date,
      }],
    }],
  };
  function read() {
    const saved = localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved) : structuredClone(defaults);
  }
  function emit(before, after) {
    const changes = {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        changes[key] = { oldValue: before[key], newValue: after[key] };
      }
    }
    if (Object.keys(changes).length) changed.forEach(fn => fn(changes, 'local'));
  }
  function write(next) {
    const before = read();
    localStorage.setItem(storageKey, JSON.stringify(next));
    emit(before, next);
  }
  const store = {
    async get(keys, callback) {
      const data = read();
      const result = keys == null ? data : typeof keys === 'string' || Array.isArray(keys)
        ? Object.fromEntries([].concat(keys).map(key => [key, data[key]]))
        : { ...keys, ...Object.fromEntries(Object.keys(keys).filter(key => key in data).map(key => [key, data[key]])) };
      callback?.(result);
      return result;
    },
    async set(values) { write({ ...read(), ...values }); },
    async remove(keys) {
      const next = read();
      [].concat(keys).forEach(key => delete next[key]);
      write(next);
    },
  };
  window.addEventListener('storage', event => {
    if (event.key === storageKey) emit(JSON.parse(event.oldValue || '{}'), JSON.parse(event.newValue || '{}'));
  });
  const unavailable = { success: false, error: '本地标注预览不连接真实视频或账号，请在已安装的扩展中使用此功能。' };
  const listeners = new Set();
  const isScene = location.pathname === '/__agentation/scene.html';
  const scene = () => isScene ? window : window.parent !== window && window.parent.location.origin === location.origin && window.parent.__asidePreviewDispatch ? window.parent : null;
  // Emulate the browser-level library shortcut while focus is inside the preview iframe.
  // Real installations receive this command from Chrome's background worker.
  window.addEventListener('keydown', event => {
    if (isScene || event.isComposing || event.repeat || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.code !== 'KeyL') return;
    const host = scene();
    if (!host) return;
    event.preventDefault();
    void host.__asidePreviewDispatch({type:'MN_TOGGLE_LIBRARY',tabId:7});
  });
  window.__asidePreviewDispatch = message => new Promise(resolve => {
    let handled = false;
    for (const listener of listeners) {
      const result = listener(message, {tab}, response => { handled = true; resolve(response); });
      if (result === true) handled = true;
    }
    if (!handled) resolve(unavailable);
  });
  async function runtimeMessage(message) {
    const host = scene();
    if (message.type === 'MN_LIBRARY_ACTION' && host) return host.__asidePreviewDispatch({type:'MN_LIBRARY_HOST',action:message.action});
    if (message.type === 'OPEN_SIDE_PANEL_FOCUS' && host) return host.__asidePreviewDispatch({type:'MN_TOGGLE_LIBRARY',tabId:7});
    if (!isScene) return unavailable;
    const key = 'preview:quickDraft:' + (message.url || '');
    if (message.type === 'MN_GET_QUICK_DRAFT') return {success:true,owner:'guest',draft:read()[key] || null};
    if (message.type === 'MN_PUT_QUICK_DRAFT') {
      const old = read()[key];
      await store.set({[key]:{meta:{...old?.meta,...message.meta},text:message.text}});
      return {success:true};
    }
    if (message.type === 'MN_CLEAR_QUICK_DRAFT') { await store.remove(key); return {success:true}; }
    if (message.type === 'MN_SAVE_QUICK_NOTE') {
      const {saveEntry} = await import('/movie-notes-extension/utils/storage.js');
      const meta = message.meta;
      if (!message.text.trim()) return {success:false,error:'内容不能为空'};
      const staged = meta._thumbnailLocalKey;
      const thumbnail = staged ? read()[staged] : meta.thumbnail;
      await saveEntry(meta.title, null, null, {
        id:meta.id,expectedOwner:'guest',content:message.text,timestampType:'point',
        timestamp:meta.timeSec,formattedTimestamp:meta.formatted,tags:meta.entryTags || [],
        videoUrl:tab.url,thumbnail,createdAt:new Date().toISOString(),
      });
      if (staged) await store.remove(staged);
      return {success:true};
    }
    return unavailable;
  }

  window.chrome = {
    storage: {
      local: store,
      session: { async get(key, cb) { cb?.({}); return {}; }, async remove() {} },
      onChanged: { addListener(fn) { changed.add(fn); }, removeListener(fn) { changed.delete(fn); } },
    },
    tabs: {
      async query() { return [tab]; },
      async get() { return tab; },
      async create({ url }) {
        if (/^https?:/.test(url)) window.open(url, '_blank', 'noopener');
        else alert(unavailable.error);
      },
      async sendMessage(id, message) {
        const host = scene();
        if (host) return host.__asidePreviewDispatch(message);
        if (message.type === 'GET_VIDEO_TITLE') return { success: true, title };
        if (message.type === 'GET_VIDEO_TIME') return { success: true, time: 754, formattedTime: '00:12:34' };
        if (message.type === 'GET_CURRENT_SUBTITLE') return { success: true, text: '这里是本地预览的示例字幕。' };
        return unavailable;
      },
    },
    runtime: {
      getURL(path) { return new URL(`/movie-notes-extension/${path}`, location.origin).href; },
      sendMessage(message, callback) {
        const result = runtimeMessage(message).catch(error => ({success:false,error:error.message}));
        if (callback) result.then(callback);
        return result;
      },
      onMessage: { addListener(fn) { listeners.add(fn); }, removeListener(fn) { listeners.delete(fn); } },
    },
  };
})();
