import { isSupportedUrl, videoIdentity } from "./utils/platform.js";
import { withDataLock, getOwner, storeForOwner } from "./utils/local-data.js";
import { flushPending, pull } from "./utils/sync.js";
import { saveEntry } from "./utils/storage.js";
import { pushNote, markPending } from "./utils/sync.js";
import { loadSession, signInWithGoogle } from "./utils/supabase.js";

async function resolveUserId() {
  try {
    const session = await loadSession();
    return session?.user?.id || null;
  } catch {
    return null;
  }
}

// 后台已保存的 note 尝试推送到 Supabase；失败则标记 pending，下次 panel 打开会重试
async function bestEffortPush(note) {
  if (!note?.id) return;
  const userId = await resolveUserId();
  if (!userId) return; // syncDirty is persisted with the local note
  try {
    await pushNote(note, userId);
  } catch (e) {
    console.warn("[sync] bg push failed", e?.message);
    try { await markPending(note.id); } catch { /* ignore */ }
  }
}

// Toolbar activation is the only injection path on sites outside the supported video list.
const libraryActions = new Map();
function isRestrictedLibraryPage(url) {
  if (!url) return false;
  try {
    const page = new URL(url);
    return !['http:', 'https:', 'file:'].includes(page.protocol)
      || page.hostname === 'chromewebstore.google.com'
      || (page.hostname === 'chrome.google.com' && /^\/webstore(?:\/|$)/.test(page.pathname));
  } catch { return false; }
}

async function openLibraryTab(tab) {
  // Restricted pages cannot host an overlay. Stay in the same browser window.
  const pages = await chrome.tabs.query(Number.isInteger(tab.windowId) ? { windowId: tab.windowId } : { currentWindow: true });
  const existing = pages.find(page => {
    if (!page.url?.startsWith(chrome.runtime.getURL('panel.html'))) return false;
    const query = new URL(page.url).searchParams;
    return query.get('sourceTab') === String(tab.id) && !query.has('embedded') && !query.has('windowed');
  });
  if (existing) await chrome.tabs.update(existing.id, { active: true });
  else await chrome.tabs.create({
    url: chrome.runtime.getURL(`panel.html?sourceTab=${tab.id}&reason=restricted`),
    active: true,
    ...(Number.isInteger(tab.windowId) ? { windowId: tab.windowId } : {}),
    ...(Number.isInteger(tab.index) ? { index: tab.index + 1 } : {})
  });
  return { success: true, surface: 'tab' };
}

async function reportLibraryError(tabId, error) {
  // A busy editor or a stale content script must never change the display mode.
  const message = error || '悬浮记录库未能打开，请刷新当前网页后重试';
  await chrome.action.setTitle({ tabId, title: `旁白 Aside · ${message}` }).catch(() => {});
  await chrome.action.setBadgeText({ tabId, text: '!' }).catch(() => {});
  return { success: false, error: message };
}

async function toggleLibrary(tab) {
  if (!tab?.id) return;
  if (tab.url?.startsWith(chrome.runtime.getURL('panel.html'))) {
    await chrome.tabs.sendMessage(tab.id,{type:'MN_KEYBOARD_COMMAND',command:'toggle-library'},{frameId:0}).catch(()=>{});return;
  }
  if (libraryActions.has(tab.id)) return libraryActions.get(tab.id);
  const job = (async () => {
    try {
      await chrome.action.setTitle({ tabId: tab.id, title: '旁白 Aside' });
      await chrome.action.setBadgeText({ tabId: tab.id, text: '' });
      if (isRestrictedLibraryPage(tab.url)) return await openLibraryTab(tab);
      const command = { type: 'MN_TOGGLE_LIBRARY', tabId: tab.id };
      let result;
      try { result = await chrome.tabs.sendMessage(tab.id, command, {frameId:0}); }
      catch {
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['player-dock.js','library-presence.js','content.js'] });
        } catch (error) {
          // Chrome can also deny injection in protected documents or through site permissions.
          if (/cannot access|extensions gallery cannot be scripted|missing host permission/i.test(error?.message || '')) {
            return await openLibraryTab(tab);
          }
          throw error;
        }
        result = await chrome.tabs.sendMessage(tab.id, command, {frameId:0});
      }
      if (!result?.success) return await reportLibraryError(tab.id, result?.error);
      return result;
    } catch {
      return await reportLibraryError(tab.id);
    }
  })();
  libraryActions.set(tab.id, job);
  try { return await job; } finally { libraryActions.delete(tab.id); }
}
chrome.action.onClicked.addListener(tab => toggleLibrary(tab));

chrome.commands?.onCommand.addListener(async (command, sourceTab) => {
  if (command !== 'quick-note') return;
  const tab = sourceTab || (await chrome.tabs.query({active:true,currentWindow:true}))[0];
  if (!tab?.id) return;
  const ownPage = tab.url?.startsWith(chrome.runtime.getURL('panel.html'));
  if (!ownPage && !isSupportedUrl(tab.url)) {
    if (command === 'quick-note') await toggleLibrary(tab);
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id,{type:'MN_KEYBOARD_COMMAND',command},{frameId:0});
  } catch { if (command === 'quick-note') await toggleLibrary(tab); }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'MN_LIBRARY_ACTION') {
    // Only our extension page can control the host. Never trust a website message.
    if (!sender.url?.startsWith(chrome.runtime.getURL('panel.html')) || !Number.isInteger(msg.tabId)
        || !['close', 'quick'].includes(msg.action)) {
      sendResponse({ success: false, error: '无效窗口操作' }); return;
    }
    chrome.tabs.sendMessage(msg.tabId, { type: 'MN_LIBRARY_HOST', action: msg.action }, {frameId:0})
      .then(sendResponse, e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (["MN_GET_QUICK_DRAFT", "MN_PUT_QUICK_DRAFT", "MN_CLEAR_QUICK_DRAFT"].includes(msg?.type)) {
    if (!sender.tab || !isSupportedUrl(sender.tab.url)) { sendResponse({ success: false, error: "不支持的视频页面" }); return; }
    void withDataLock(async () => {
      const owner = await getOwner();
      if (msg.owner && msg.owner !== owner) throw new Error("账号已切换，草稿仍保留在原账号");
      const store = await storeForOwner(owner);
      const drafts = (await store.get('quickDrafts')).quickDrafts || {};
      const identity = videoIdentity(msg.url || sender.tab.url);
      const key = `${identity}:tab:${sender.tab.id}`;
      if (msg.type === 'MN_GET_QUICK_DRAFT') {
        if (!drafts[key]) {
          // Recover a draft from a closed tab without taking over another open editor.
          for (const [oldKey, draft] of Object.entries(drafts)) {
            if (draft.identity !== identity) continue;
            const tab = await chrome.tabs.get(draft.tabId).catch(() => null);
            if (tab && videoIdentity(tab.url) === identity) continue;
            drafts[key] = { ...draft, tabId: sender.tab.id };
            delete drafts[oldKey];
            await store.set({ quickDrafts: drafts });
            break;
          }
        }
        return { success: true, draft: drafts[key] || null, owner };
      }
      if (msg.type === 'MN_CLEAR_QUICK_DRAFT') {
        if (!drafts[key] || drafts[key].meta?.id === msg.entryId) delete drafts[key];
      } else {
        drafts[key] = { identity, tabId: sender.tab.id, text: String(msg.text || ''), meta: { ...drafts[key]?.meta, ...msg.meta }, updatedAt: new Date().toISOString() };
      }
      await store.set({ quickDrafts: drafts });
      return { success: true };
    }).then(sendResponse, e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (msg?.type === "MN_CAPTURE_VISIBLE_TAB") {
    (async () => {
      try {
        const windowId = sender.tab?.windowId ?? (await chrome.windows.getCurrent()).id;
        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
        sendResponse({ success: true, dataUrl });
      } catch (e) {
        console.error("MN_CAPTURE_VISIBLE_TAB", e);
        sendResponse({ success: false, error: e?.message || "capture failed" });
      }
    })();
    return true;
  }

  if (msg?.type === "MN_SAVE_QUICK_NOTE") {
    (async () => {
      try {
        if (!sender.tab || !isSupportedUrl(sender.tab.url)) throw new Error("不支持的视频页面");
        const { meta, text } = msg;
        const title = (meta?.title || "").trim();
        if (!title) throw new Error("标题为空");
        const content = String(text ?? "").trim();
        if (!content) throw new Error("内容不能为空");

        let thumbnail = meta?.thumbnail ?? null;
        const lk = meta?._thumbnailLocalKey;
        if (lk) {
          try {
            const got = await chrome.storage.local.get(lk);
            thumbnail = got[lk] ?? null;
          } finally {
            try {
              await chrome.storage.local.remove(lk);
            } catch {
              // ignore
            }
          }
        } else {
          const sk = meta?._thumbnailSessionKey;
          if (sk) {
            try {
              const got = await chrome.storage.session.get(sk);
              thumbnail = got[sk] ?? null;
            } finally {
              try {
                await chrome.storage.session.remove(sk);
              } catch {
                // ignore
              }
            }
          }
        }

        const entryBase = {
          id: meta?.id,
          expectedOwner: meta?.owner,
          timestampType: "point",
          timestamp: meta?.timeSec ?? null,
          formattedTimestamp: meta?.formatted ?? null,
          timestampStart: null,
          timestampEnd: null,
          formattedStart: null,
          formattedEnd: null,
          content,
          tags: Array.isArray(meta?.entryTags)
            ? meta.entryTags.map((t) => String(t).trim()).filter(Boolean)
            : [],
          videoUrl: meta?.url ?? null,
          createdAt: new Date().toISOString()
        };

        let savedResult = null;
        let droppedThumb = false;
        try {
          savedResult = await saveEntry(title, null, null, { ...entryBase, thumbnail });
        } catch (e1) {
          const m1 = String(e1?.message || "");
          const quotaLike =
            /quota|QUOTA|超过|exceeded|MAX_WRITE|resource|too large|length|写入失败|存储配额/i.test(m1);
          if (thumbnail && quotaLike) {
            savedResult = await saveEntry(title, null, null, { ...entryBase, thumbnail: null });
            droppedThumb = true;
          } else {
            throw e1;
          }
        }

        // A local commit is the save acknowledgement; network work is retryable independently.
        const missingThumb = Boolean(meta?.thumbnail || meta?._thumbnailLocalKey || meta?._thumbnailSessionKey) && !savedResult.entry.hasThumbnail;
        sendResponse({ success: true, savedLocally: true, droppedThumb: droppedThumb || missingThumb });
        void bestEffortPush(savedResult?.note);
      } catch (e) {
        console.error("MN_SAVE_QUICK_NOTE", e);
        sendResponse({ success: false, error: e?.message || "保存失败" });
      }
    })();
    return true;
  }

  if (msg?.type === "OPEN_SIDE_PANEL_FOCUS") {
    toggleLibrary(sender.tab).then(result => sendResponse({ ok: Boolean(result?.success), error: result?.error }), e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg?.type === "TAB_MEDIA_STATE") {
    const tabId = sender.tab?.id;
    if (tabId == null) return;
    scheduleBadgeUpdate(tabId, Boolean(msg.paused));
  }

  // 在 service worker 里执行 OAuth：相比 side panel 更稳，
  // 避免侧栏失焦/关闭时 launchWebAuthFlow 弹窗中断
  if (msg?.type === "MN_SIGN_IN_GOOGLE") {
    (async () => {
      try {
        const session = await signInWithGoogle();
        sendResponse({ success: true, session });
      } catch (e) {
        sendResponse({ success: false, error: e?.message || "登录失败" });
      }
    })();
    return true;
  }
});

// 快速切标签 / seek 时 paused 状态会反复抖动；延迟合批到最后一次
const _pendingBadge = new Map(); // tabId → { paused, tid }
function scheduleBadgeUpdate(tabId, paused) {
  const prev = _pendingBadge.get(tabId);
  if (prev) clearTimeout(prev.tid);
  const tid = setTimeout(() => {
    _pendingBadge.delete(tabId);
    try {
      if (paused) {
        chrome.action.setBadgeText({ tabId, text: "记" });
        chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" });
      } else {
        chrome.action.setBadgeText({ tabId, text: "" });
      }
    } catch {
      // ignore
    }
  }, 120);
  _pendingBadge.set(tabId, { paused, tid });
}

async function retrySync() {
  const session = await loadSession();
  if (!session?.user?.id) return;
  try { await flushPending(null, session.user.id); await pull(); }
  catch (e) { console.warn('[sync] pending:', e.message); }
}
chrome.alarms.create('aside-sync', { periodInMinutes: 2 });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'aside-sync') void retrySync(); });
chrome.runtime.onStartup.addListener(() => { void retrySync(); });
