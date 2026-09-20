import { extractNotionPageId, createNotionPageWithMarkdown, verifyNotionConnection, describeNotionError } from "./utils/notion.js";
import { bindHelpSnap } from "./utils/help-snap.js";
import { isSupportedUrl, videoIdentity } from "./utils/platform.js";
import { getOwner } from "./utils/local-data.js";
import {
  getAllNotes,
  saveEntry,
  deleteMovie,
  deleteEntry,
  updateEntry,
  updateMovie,
  loadDraft,
  saveDraft,
  clearDraft,
  exportMovieToMarkdown,
  exportAllToMarkdown,
  downloadTextFile,
  loadNotionConfig,
  saveNotionConfig,
  normalizeTagArray,
  readEntryThumbnail,
  migrateThumbnailsIfNeeded
} from "./utils/storage.js";

import {
  signOut as supabaseSignOut,
  getUser,
  loadSession
} from "./utils/supabase.js";

// OAuth 改由 background service worker 执行，避免侧栏关闭/失焦时中断
async function signInWithGoogle() {
  const resp = await chrome.runtime.sendMessage({ type: "MN_SIGN_IN_GOOGLE" });
  if (!resp?.success) throw new Error(resp?.error || "登录失败");
  return resp.session;
}

import {
  pushNote,
  pushAll,
  softDeleteMovie,
  pull,
  flushPending,
  markPending,
  getPendingIds,
  repairUnpushedIfNeeded,
  isLoggedIn
} from "./utils/sync.js";

import { formatSeconds, extractTagsFromContent } from "./utils/common.js";

const VIEWS = {
  NEW: "NEW",
  LIST: "LIST",
  DETAIL: "DETAIL",
  STATS: "STATS"
};

const state = {
  currentView: VIEWS.LIST,
  supported: false,
  activeTabId: null,
  timestampMode: "point",
  pointSeconds: null,
  rangeStartSeconds: null,
  rangeEndSeconds: null,
  thumbnailDataUrl: null,
  formVideoUrl: null,
  movieTags: [],
  entryTags: [],
  detailMovieId: null,
  detailMovie: null,
  listQuery: "",
  homeSort: "recent",
  draftPrefill: { title: "", movieTags: [] },
  draftSaveTimer: null,
  pendingDraft: null,
  dirty: false,
  savingEntry: false,
  composing: false,
  detailStampSortAsc: (() => {
    try { return (localStorage.getItem("mn:detailStampSortAsc") ?? "1") === "1"; }
    catch { return true; }
  })(),
  // 「快速开始」是否已被用户主动收起；可通过顶部「上手提示」按钮再次打开
  onboardingDismissed: true,
  expandedMovieId: null,
  searchOpen: true,
  // 冷启动小手指引导是否已展示过
  tipPointerSeen: (() => {
    try { return localStorage.getItem("mn:tipPointerSeen") === "1"; }
    catch { return false; }
  })()
};

// 冷启动示例数据：仅用于渲染预览，不入 storage、不同步到云端
const SAMPLE_MOVIES = [
  {
    id: "__sample_vagabond__",
    movieTitle: "【阿涅斯·瓦尔达】天涯沦落女 Sans toit ni loi.1985",
    tags: ["新浪潮", "女性"],
    videoUrl: null,
    updatedAt: "2026-05-18T17:37:48.139Z",
    createdAt: "2026-05-18T17:37:48.139Z",
    entries: [
      {
        id: "__sample_entry_review__",
        timestampType: null,
        timestamp: null,
        timestampStart: null,
        timestampEnd: null,
        formattedTimestamp: null,
        formattedStart: null,
        formattedEnd: null,
        thumbnail: null,
        hasThumbnail: false,
        content:
          "蒙娜不属于任何地方，也不向任何人解释自己的存在。瓦尔达用十二段近乎纪录片的目击，让我们围着她走一圈，却始终走不进去——这是这部电影最温柔也最残忍的处理。",
        tags: ["整体影评"],
        videoUrl: null,
        createdAt: "2026-05-18T17:37:48.139Z"
      },
      {
        id: "__sample_entry_stamp_1__",
        timestampType: "point",
        timestamp: 1935,
        timestampStart: null,
        timestampEnd: null,
        formattedTimestamp: "00:32:15",
        formattedStart: null,
        formattedEnd: null,
        thumbnail: null,
        hasThumbnail: false,
        content:
          "酒馆门口的雪。她在画面外，世界从她身边滑过——这种「让出主角位置」的镜头语言，几乎成了整部片子的呼吸节奏。",
        tags: ["镜头"],
        videoUrl: null,
        createdAt: "2026-05-18T17:38:12.000Z"
      },
      {
        id: "__sample_entry_stamp_2__",
        timestampType: "point",
        timestamp: 3248,
        timestampStart: null,
        timestampEnd: null,
        formattedTimestamp: "00:54:08",
        formattedStart: null,
        formattedEnd: null,
        thumbnail: null,
        hasThumbnail: false,
        content:
          "牧羊人那段独白像是关于另一种自由的注脚——他理解蒙娜的选择，却也指出她正在被这份选择慢慢消耗。",
        tags: ["台词"],
        videoUrl: null,
        createdAt: "2026-05-18T17:40:00.000Z"
      }
    ]
  }
];

function isSampleMovieId(id) {
  return typeof id === "string" && id.startsWith("__sample_");
}

/** 电影级标签（兼容旧 movieGenre） */
function noteMovieTags(note) {
  return normalizeTagArray(note?.tags ?? note?.movieGenre);
}

// ── 同步 ────────────────────────────────────────────────────────────

let _syncUserId = null;   // null = 未登录

function setSyncDot(st) {
  const dot = document.getElementById("syncDot");
  if (dot) dot.dataset.state = st;
  const label = document.getElementById("accountStatusText");
  if (label) label.textContent = ({ syncing: "同步中", ok: "已同步", pending: "待同步", error: "同步失败", hidden: "" })[st] || "等待同步";
}

// 写入后调用（fire-and-forget，不阻塞 UI）
async function syncPush(movieId) {
  if (!_syncUserId) return;
  setSyncDot("syncing");
  try {
    const notes = await getAllNotes();
    const note  = notes.find((n) => n.id === movieId);
    if (note) await pushNote(note, _syncUserId);
    setSyncDot("ok");
  } catch (e) {
    console.warn("[sync] push failed", e?.message);
    await markPending(movieId);
    setSyncDot("pending");
    showToast(`同步失败：${e?.message || "网络错误"}`, "danger");
  }
}

// 删除电影后调用
async function syncDelete(movieId) {
  if (!_syncUserId) return;
  try {
    await softDeleteMovie(movieId);
  } catch (e) {
    console.warn("[sync] soft-delete failed", e?.message);
    setSyncDot("pending");
    showToast("已在本地删除，联网后继续同步", "danger");
  }
}

// ── 账号 UI ─────────────────────────────────────────────────────────

function renderAccountUi(user) {
  const elGuest      = document.getElementById("accountGuest");
  const elUser       = document.getElementById("accountUser");
  const elStatusText = document.getElementById("accountStatusText");
  const elEmail      = document.getElementById("accountEmail");
  const elAvatar     = document.getElementById("accountAvatar");
  const elResync     = document.getElementById("accountResyncRow");

  if (!user) {
    if (elGuest)      elGuest.hidden      = false;
    if (elUser)       elUser.hidden       = true;
    if (elResync)     elResync.hidden     = true;
    if (elStatusText) elStatusText.textContent = "";
    setSyncDot("hidden");
    return;
  }

  if (elGuest)      elGuest.hidden      = true;
  if (elUser)       elUser.hidden       = false;
  if (elResync)     elResync.hidden     = false;
  if (elStatusText) elStatusText.textContent = "等待同步";
  if (elEmail)      elEmail.textContent  = user.email || "";
  if (elAvatar) {
    elAvatar.hidden = true;
    if (user.user_metadata?.avatar_url) {
      elAvatar.src = user.user_metadata.avatar_url;
      elAvatar.onload  = () => { elAvatar.hidden = false; };
      elAvatar.onerror = () => { elAvatar.hidden = true; };
    }
  }
}

async function resyncAll() {
  if (!_syncUserId) { showToast("请先登录", "danger"); return; }
  const btn = document.getElementById("btnResyncAll");
  if (btn) { btn.disabled = true; btn.textContent = "同步中…"; }
  setSyncDot("syncing");
  try {
    const notes = await getAllNotes();
    const totalEntries = notes.reduce((sum, n) => sum + (n.entries?.length || 0), 0);
    if (notes.length === 0) {
      setSyncDot("ok");
      showToast("本地没有笔记可同步", "danger");
      return;
    }
    await pushAll(notes, _syncUserId);
    setSyncDot("ok");
    showToast(`同步完成：${notes.length} 个视频 / ${totalEntries} 条记录`, "good");
  } catch (e) {
    console.warn("[sync] resync failed", e);
    setSyncDot("pending");
    showToast(`同步失败：${e?.message || "网络错误"}`, "danger");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "立即同步"; }
  }
}

async function initAccount() {
  try {
  const session = await loadSession();
  if (!session) { renderAccountUi(null); return; }

  const user = await getUser();
  if (!user)  { renderAccountUi(null); return; }

  _syncUserId = user.id;
  renderAccountUi(user);
  setSyncDot("syncing");

  try {
    // 拉取远端变更并合并到本地
    const local  = await getAllNotes();
    const merged = await pull(local);

    await refreshList();

    // 一次性修复：老版本 bg 未推送的本地数据补推
    await repairUnpushedIfNeeded(await getAllNotes());

    // 重试离线期间失败的推送（含修复产生的 pending）
    await flushPending(await getAllNotes(), _syncUserId);
    const stillPending = await getPendingIds();
    const elStatusText = document.getElementById("accountStatusText");
    if (stillPending.size > 0) {
      setSyncDot("pending");
      if (elStatusText) elStatusText.textContent = `${stillPending.size} 条待同步`;
    } else {
      setSyncDot("ok");
      if (elStatusText) elStatusText.textContent = "已同步";
    }
  } catch (e) {
    console.warn("[sync] init pull failed", e?.message);
    setSyncDot("pending");
    const elStatusText = document.getElementById("accountStatusText");
    if (elStatusText) elStatusText.textContent = "同步待定";
  }
  } catch (e) {
    console.warn("[sync] initAccount failed", e?.message);
    renderAccountUi(null);
  }
}

const exportModalCtx = { mode: "movie" };

const $ = (id) => document.getElementById(id);

const THEME_KEY = "uiTheme";

const el = {
  draftBanner: $("draftBanner"),
  btnRestoreDraft: $("btnRestoreDraft"),
  btnDismissDraft: $("btnDismissDraft"),

  headerHint: $("headerHint"),
  themeToggle: $("themeToggle"),
  viewNew: $("viewNew"),
  viewList: $("viewList"),
  viewDetail: $("viewDetail"),
  viewStats: $("viewStats"),


  movieTitle: $("movieTitle"),
  movieTagsDisplay: $("movieTagsDisplay"),
  movieTagInput: $("movieTagInput"),

  modePoint: $("modePoint"),
  modeRange: $("modeRange"),
  blockPoint: $("blockPoint"),
  blockRange: $("blockRange"),

  btnGetTime: $("btnGetTime"),
  btnClearStamp: $("btnClearStamp"),
  stampPointInput: $("stampPointInput"),
  errTimePoint: $("errTimePoint"),
  thumbPreviewPoint: $("thumbPreviewPoint"),

  btnGetStart: $("btnGetStart"),
  btnGetEnd: $("btnGetEnd"),
  btnClearStart: $("btnClearStart"),
  btnClearEnd: $("btnClearEnd"),
  stampStartInput: $("stampStartInput"),
  stampEndInput: $("stampEndInput"),
  errTimeRange: $("errTimeRange"),
  thumbPreviewRange: $("thumbPreviewRange"),

  entryContent: $("entryContent"),
  longContentHint: $("longContentHint"),
  wordCount: $("wordCount"),
  tagInput: $("tagInput"),
  entryTagsDisplay: $("entryTagsDisplay"),

  btnSave: $("btnSave"),
  btnReset: $("btnReset"),

  toast: $("toast"),

  searchInput: $("searchInput"),
  homeSortLabel: $("homeSortLabel"),
  btnSearchToggle: $("btnSearchToggle"),
  searchExpand: $("searchExpand"),
  btnExportAll: $("btnExportAll"),
  movieList: $("movieList"),
  emptyState: $("emptyState"),
  onboardBanner: $("onboardBanner"),
  btnOnboardToggle: $("btnOnboardToggle"),
  tipToggleWrap: $("tipToggleWrap"),
  tipPointer: $("tipPointer"),

  btnExportMovie: $("btnExportMovie"),
  detailTitleLine: $("detailTitleLine"),
  detailVideoLink: $("detailVideoLink"),
  detailTopVideoLink: $("detailTopVideoLink"),
  detailGenres: $("detailGenres"),
  detailCount: $("detailCount"),
  detailEntries: $("detailEntries"),
  detailMetaDisplay: $("detailMetaDisplay"),

  statsGrid: $("statsGrid"),
  heatmap: $("heatmap"),

  notionToken: $("notionToken"),
  notionParentId: $("notionParentId"),
  btnSaveNotionConfig: $("btnSaveNotionConfig"),

  btnToggleNotion: $("btnToggleNotion"),
  btnToggleToken: $("btnToggleToken"),
  notionSettingsBody: $("notionSettingsBody"),
  notionStatusBadge: $("notionStatusBadge"),

  exportModal: $("exportModal"),
  exportModalBackdrop: $("exportModalBackdrop"),
  exportModalHint: $("exportModalHint"),
  btnExportMd: $("btnExportMd"),
  btnExportNotion: $("btnExportNotion"),
  btnExportModalClose: $("btnExportModalClose"),

  btnBackFromNew: $("btnBackFromNew"),
  btnBackFromDetail: $("btnBackFromDetail"),

  errTitle: $("errTitle"),
  errContent: $("errContent")
};

const markedLib = globalThis.marked;

function configureMarked() {
  if (!markedLib || typeof markedLib.setOptions !== "function") return;
  markedLib.setOptions({ gfm: true, breaks: true });
}

function sanitizeHtml(html) {
  const ALLOWED_TAGS = new Set([
    "p", "br", "strong", "b", "em", "i", "u", "s", "del", "mark",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "blockquote", "pre", "code",
    "a", "hr", "span", "div", "table", "thead", "tbody", "tr", "th", "td"
  ]);
  const ALLOWED_ATTRS = {
    a: ["href", "title", "rel", "target"],
    "*": ["class"]
  };

  function walk(node) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 8) { child.remove(); continue; }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        child.remove();
        continue;
      }
      const allowed = [...(ALLOWED_ATTRS[tag] || []), ...(ALLOWED_ATTRS["*"] || [])];
      for (const attr of [...child.attributes]) {
        if (!allowed.includes(attr.name)) child.removeAttribute(attr.name);
      }
      if (child.hasAttribute("href")) {
        const href = child.getAttribute("href").trim().toLowerCase();
        if (href.startsWith("javascript:") || href.startsWith("data:")) child.removeAttribute("href");
      }
      if (tag === "a") {
        child.setAttribute("rel", "noopener noreferrer");
        child.setAttribute("target", "_blank");
      }
      walk(child);
    }
  }

  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  walk(wrap);
  return wrap.innerHTML;
}

function renderMarkdown(text) {
  if (!markedLib || typeof markedLib.parse !== "function") {
    return `<p>${escapeHtml(text || "")}</p>`;
  }
  try {
    return sanitizeHtml(markedLib.parse(text || ""));
  } catch {
    return `<p>${escapeHtml(text || "")}</p>`;
  }
}

function parseTimeToSeconds(str) {
  const s = (str || "").trim();
  if (!s) return null;
  const parts = s.split(":").map((p) => p.trim());
  if (parts.some((p) => p === "" || Number.isNaN(Number(p)))) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => n < 0 || !Number.isFinite(n))) return null;
  if (parts.length === 2) {
    const [mm, ss] = nums;
    if (ss >= 60) return null;
    return mm * 60 + ss;
  }
  if (parts.length === 3) {
    const [hh, mm, ss] = nums;
    if (mm >= 60 || ss >= 60) return null;
    return hh * 3600 + mm * 60 + ss;
  }
  return null;
}

function formatLocalTime(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    if (d.getFullYear() === now.getFullYear()) {
      return `${d.getMonth() + 1}月${d.getDate()}日 ${time}`;
    }
    return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${time}`;
  } catch {
    return "";
  }
}

function platformFromUrl(url) {
  if (/bilibili\.com/i.test(url)) return "Bilibili";
  if (/youtu\.?be(\.com)?/i.test(url)) return "YouTube";
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return h.length > 24 ? h.slice(0, 24) + "…" : h;
  } catch {
    return "原视频";
  }
}

function formatRelativeTime(iso) {
  const t = new Date(iso || 0).getTime();
  if (!t) return "";
  const diff = Date.now() - t;
  if (diff < 60e3) return "刚刚";
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)} 分钟前`;
  if (diff < 86400e3) return `${Math.floor(diff / 3600e3)} 小时前`;
  if (diff < 30 * 86400e3) return `${Math.floor(diff / 86400e3)} 天前`;
  return "30 天前";
}

function escapeHtml(s) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function base64UrlEncodeUtf8(str) {
  const enc = new TextEncoder();
  const bytes = enc.encode(String(str || ""));
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const b64 = btoa(bin);
  return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function openShareCardInTab(payload) {
  const url = `${chrome.runtime.getURL("share.html")}?img=1#${base64UrlEncodeUtf8(JSON.stringify({ ...payload, theme: document.documentElement.dataset.theme }))}`;
  try {
    await chrome.tabs.create({ url });
  } catch {
    showToast("分享页打开失败，请重试", "danger");
  }
}

async function tryShareOrCopy(text, title) {
  const t = String(text || "").trim();
  if (!t) return false;
  try {
    if (navigator.share && typeof navigator.share === "function") {
      await navigator.share({ title: String(title || "").slice(0, 120) || "分享", text: t });
      return true;
    }
  } catch {
    // ignore, fallback to copy
  }
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(t);
      showToast("已复制到剪贴板", "good");
      return true;
    }
  } catch {
    // ignore
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    ta.remove();
    showToast("已复制到剪贴板", "good");
    return true;
  } catch {
    showToast("分享失败，请重试", "danger");
    return false;
  }
}

function applyV14MovieTagPill(node, text) {
  const g = (text || "").trim() || "—";
  node.textContent = g;
  node.className = "v14-pill v14-pill--movie";
}

/** 构建视频时间戳深链（YouTube/Bilibili 精确秒，其他返回原 URL） */
function buildTimestampDeepLink(videoUrl, timeSec) {
  if (!videoUrl || timeSec == null || typeof timeSec !== "number") return videoUrl || null;
  try {
    const u = new URL(videoUrl);
    if (u.hostname.includes("youtube.com") || u.hostname.includes("youtu.be")) {
      u.searchParams.set("t", `${Math.floor(timeSec)}s`);
      return u.toString();
    }
    if (u.hostname.includes("bilibili.com")) {
      u.searchParams.set("t", String(Math.floor(timeSec)));
      return u.toString();
    }
    return videoUrl;
  } catch {
    return videoUrl;
  }
}

/**
 * Notion 专用 Markdown 导出：比普通导出多了可点击时间跳转链接和截图提示。
 * 供 createNotionPageWithMarkdown 调用。
 */
function exportMovieToNotionMarkdown(note) {
  const tags = normalizeTagArray(note.tags || []).slice(0, 8);
  const typeLine = tags.length ? `**标签**：${tags.join(" / ")}` : "**标签**：—";
  const date = (note.updatedAt || note.createdAt || "").slice(0, 10);
  let md = `# ${note.movieTitle || "未命名"}\n`;
  md += `${typeLine}  \n`;
  md += `**记录于**：${date}\n\n`;
  md += `---\n\n`;

  const entries = [...(note.entries || [])].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  for (const it of entries) {
    // 时间戳标题行
    if (it.timestampType === "range" && it.formattedStart && it.formattedEnd) {
      md += `## ⏱ ${it.formattedStart} → ${it.formattedEnd}\n\n`;
    } else if (it.formattedTimestamp) {
      md += `## ⏱ ${it.formattedTimestamp}\n\n`;
    } else {
      md += `## 无时间戳\n\n`;
    }

    // 可点击跳转链接
    const videoUrl = it.videoUrl || note.videoUrl || null;
    const jumpSec = it.timestampType === "range" ? it.timestampStart : it.timestamp;
    const deepLink = buildTimestampDeepLink(videoUrl, jumpSec);
    if (deepLink) {
      const label = it.timestampType === "range" && it.formattedStart
        ? `从 ${it.formattedStart} 跳转观看`
        : it.formattedTimestamp
          ? `从 ${it.formattedTimestamp} 跳转观看`
          : "跳转观看";
      md += `🔗 [${label}](${deepLink})\n\n`;
    }

    const body = (it.content || "").trim();
    if (body) md += `${body}\n\n`;

    const entryTags = Array.isArray(it.tags) ? it.tags.filter(Boolean) : [];
    if (entryTags.length) md += `${entryTags.map((t) => `#${t}`).join(" ")}\n\n`;

    md += `---\n\n`;
  }
  return md;
}



function countChars(s) {
  return Array.from(s || "").length;
}

// ── In-panel confirm dialog ──────────────────────────────────
function showConfirm(message, okText = "确定", cancelText = "取消") {
  return new Promise((resolve) => {
    const modal   = document.getElementById("confirmModal");
    const msg     = document.getElementById("confirmModalMsg");
    const btnOk   = document.getElementById("confirmModalOk");
    const btnCancel = document.getElementById("confirmModalCancel");
    const backdrop  = document.getElementById("confirmModalBackdrop");
    if (!modal) { resolve(window.confirm(message)); return; }

    msg.textContent  = message;
    btnOk.textContent     = okText;
    btnCancel.textContent = cancelText;
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    btnOk.focus();

    const finish = (result) => {
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
      btnOk.removeEventListener("click", onOk);
      btnCancel.removeEventListener("click", onCancel);
      backdrop.removeEventListener("click", onCancel);
      resolve(result);
    };
    const onOk     = () => finish(true);
    const onCancel = () => finish(false);
    btnOk.addEventListener("click", onOk);
    btnCancel.addEventListener("click", onCancel);
    backdrop.addEventListener("click", onCancel);
  });
}

let toastTimer = null;
function showToast(text, kind = "good", durationMs = 2200) {
  window.clearTimeout(toastTimer);
  el.toast.textContent = text;
  const k = kind === "danger" ? "danger" : kind === "warn" ? "warn" : "good";
  el.toast.dataset.kind = k;
  el.toast.classList.add("toast--show");
  toastTimer = window.setTimeout(() => el.toast.classList.remove("toast--show"), durationMs);
}

function applyTheme(mode) {
  const light = mode === "light";
  document.documentElement.dataset.theme = light ? "light" : "dark";
  const btn = el.themeToggle;
  if (btn) {
    btn.setAttribute("aria-pressed", light ? "true" : "false");
    btn.title = light ? "切换至深色" : "切换至浅色";
    // Icon visibility is handled by CSS selectors on html[data-theme]; don't overwrite SVG content.
  }
}

async function loadTheme() {
  // Smoky purple is the default; preserve any explicitly saved light/dark choice.
  const defaultTheme = "dark";
  try {
    const { [THEME_KEY]: t } = await chrome.storage.local.get(THEME_KEY);
    applyTheme(t === "light" || t === "dark" ? t : defaultTheme);
  } catch {
    applyTheme(defaultTheme);
  }
}

async function toggleTheme() {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  applyTheme(next);
  try {
    await chrome.storage.local.set({ [THEME_KEY]: next === "light" ? "light" : "dark" });
  } catch {}
}

function setView(next) {
  state.currentView = next;
  el.viewNew.classList.toggle("view--active", next === VIEWS.NEW);
  el.viewList.classList.toggle("view--active", next === VIEWS.LIST);
  el.viewDetail.classList.toggle("view--active", next === VIEWS.DETAIL);
  el.viewStats.classList.toggle("view--active", next === VIEWS.STATS);
  // ensure meta fields are visible by default when entering viewNew normally
  if (next === VIEWS.NEW) {
    clearErrors();
    updateWordCount();
    const mf = document.getElementById("newMovieMetaFields");
    if (mf) mf.hidden = false;
  }

  // Tab bar: hidden in detail (sub-view), visible elsewhere
  const tabBar = document.getElementById("tabBar");
  if (tabBar) tabBar.classList.toggle("tab-bar--hidden", next === VIEWS.DETAIL || next === VIEWS.NEW);

  // Tab active states
  const tabMap = {
    [VIEWS.LIST]:   "tabList",
    [VIEWS.DETAIL]: "tabList",
    [VIEWS.NEW]:    "tabList",
    [VIEWS.STATS]:  "tabSettings",
  };
  ["tabList", "tabSettings"].forEach((id) => {
    document.getElementById(id)?.classList.toggle("tab-bar__item--active", tabMap[next] === id);
  });

  if (next === VIEWS.LIST) refreshList();
  if (next === VIEWS.STATS) { closeNotionSettings(); renderLog(); }
}

function syncHomeSortLabel() {
  if (!el.homeSortLabel) return;
  const isEntries = state.homeSort === "entries";
  el.homeSortLabel.innerHTML = isEntries
    ? `最多记录 <span class="home-sort-label__caret">▾</span>`
    : `最近编辑 <span class="home-sort-label__caret">▾</span>`;
}

function openExportModal(mode) {
  exportModalCtx.mode = mode;
  if (el.exportModalHint) {
    if (mode === "movie") {
      const t = state.detailMovie?.movieTitle || "当前视频";
      el.exportModalHint.textContent = `将导出「${t}」`;
    } else {
      el.exportModalHint.textContent = "将导出全部视频笔记";
    }
  }
  if (el.exportModal) {
    el.exportModal.hidden = false;
    el.exportModal.setAttribute("aria-hidden", "false");
  }
}

function closeExportModal() {
  if (el.exportModal) {
    el.exportModal.hidden = true;
    el.exportModal.setAttribute("aria-hidden", "true");
  }
}

async function onExportModalMarkdown() {
  closeExportModal();
  if (exportModalCtx.mode === "movie") {
    const note = state.detailMovie;
    if (!note) return;
    const md = exportMovieToMarkdown(note);
    const name = (note.movieTitle || "export").replace(/[\\/:*?"<>|]/g, "_");
    downloadTextFile(`${name}.md`, md);
    showToast("已下载 Markdown", "good");
  } else {
    const all = await getAllNotes();
    const md = exportAllToMarkdown(all);
    downloadTextFile(`视频笔记-全部-${new Date().toISOString().slice(0, 10)}.md`, md);
    showToast("已下载 Markdown", "good");
  }
}

let savedNotionConfig = {};
let notionConnectBusy = false;
let notionConfigDirty = false;
let pendingNotionExport = null;
function notionInputsChanged() {
  return el.notionToken.value.trim() !== (savedNotionConfig.token || '') ||
    (extractNotionPageId(el.notionParentId.value) || el.notionParentId.value.trim()) !== (extractNotionPageId(savedNotionConfig.parentPageId) || savedNotionConfig.parentPageId || '');
}
function updateNotionBadge(cfg) {
  savedNotionConfig = cfg;
  const badge = el.notionStatusBadge;
  badge.hidden = false;
  badge.className = 'notion-settings__badge';
  badge.textContent = cfg?.token && cfg?.parentPageId ? (cfg.verifiedAt ? '已验证写入' : '待验证写入') : '未连接';
  $('btnDisconnectNotion').hidden = !cfg?.token;
}
function notionPageUrl(id) {
  const parsed = extractNotionPageId(id);
  return parsed ? `https://www.notion.so/${parsed.replaceAll('-', '')}` : '';
}
function renderNotionFeedback(title, message, { error, links = [], lines = [] } = {}) {
  const box = $('notionConnectionStatus');
  box.replaceChildren(); box.hidden = false;
  box.dataset.kind = error ? 'error' : 'info';
  const heading = document.createElement('strong'); heading.textContent = title; box.append(heading);
  const copy = document.createElement('p'); copy.textContent = message; box.append(copy);
  if (lines.length) {
    const list = document.createElement('ul');
    for (const line of lines) { const li = document.createElement('li'); li.textContent = line; list.append(li); }
    box.append(list);
  }
  for (const {id, label} of links) {
    const url = notionPageUrl(id); if (!url) continue;
    const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noreferrer';
    link.textContent = label; box.append(link);
  }
  if (error?.code || error?.status) {
    const details = document.createElement('details'); const summary = document.createElement('summary');
    summary.textContent = '错误详情'; const pre = document.createElement('pre');
    // Never render credentials, even if a remote validation message echoes input.
    let detail = `${error.status || ''} ${error.code || ''}\n${error.message || ''}`;
    for (const secret of [el.notionToken.value.trim(), savedNotionConfig.token]) if (secret) detail = detail.split(secret).join('[已隐藏]');
    pre.textContent = detail; details.append(summary, pre); box.append(details);
  }
}
async function connectNotion() {
  if (notionConnectBusy || notionExportBusy) return;
  notionConnectBusy = true;
  const token = el.notionToken.value.trim(), parent = el.notionParentId.value.trim();
  const button = el.btnSaveNotionConfig;
  const controls = [button, el.notionToken, el.notionParentId, el.btnToggleToken, $('btnDisconnectNotion')];
  controls.forEach(control => control.disabled = true);
  button.textContent = '正在验证…';
  renderNotionFeedback('正在验证', '检查目标页面，并创建测试页面以确认写入权限。');
  let verified;
  try {
    const owner = await getOwner();
    verified = await verifyNotionConnection(token, parent);
    const saved = await saveNotionConfig(verified, owner);
    el.notionToken.value = saved.token; el.notionParentId.value = notionPageUrl(saved.parentPageId);
    el.notionToken.type = 'password'; el.btnToggleToken.textContent = '显示'; el.btnToggleToken.setAttribute('aria-label', '显示连接密钥');
    notionConfigDirty = false; updateNotionBadge(saved);
    renderNotionFeedback('已连接 · 可以导出', `目标页面：${saved.parentTitle}。已实际写入测试页面，设置已保存。`, {links:[{id:saved.parentPageId,label:'打开目标页面 ↗'},{id:verified.testPageId,label:'查看连接测试 ↗'}]});
    $('btnResumeNotionExport').hidden = !pendingNotionExport;
  } catch (error) {
    el.notionStatusBadge.textContent = verified ? '尚未保存' : '验证未通过';
    renderNotionFeedback(verified ? '已验证，但设置未保存' : '尚未连接', verified ? '浏览器未能保存设置。目标页面中已生成连接测试；请先检查浏览器存储后再试。' : describeNotionError(error), {error, links:[{id:verified?.testPageId || error.partialPageId,label:'查看已生成的页面 ↗'}]});
  } finally {
    notionConnectBusy = false; controls.forEach(control => control.disabled = false); button.textContent = '验证并连接';
  }
}

function openNotionSettings() {
  if (!el.notionSettingsBody || !el.btnToggleNotion) return;
  el.notionSettingsBody.hidden = false;
  el.notionSettingsBody.inert = false;
  el.notionSettingsBody.classList.add("notion-settings__body--open");
  el.btnToggleNotion.setAttribute("aria-expanded", "true");
}

function closeNotionSettings() {
  if (!el.notionSettingsBody || !el.btnToggleNotion) return;
  if (el.notionSettingsBody.contains(document.activeElement)) el.btnToggleNotion.focus();
  el.notionSettingsBody.hidden = true;
  el.notionSettingsBody.inert = true;
  el.notionToken.type = "password";
  el.btnToggleToken.textContent = "显示";
  el.btnToggleToken.setAttribute("aria-label", "显示连接密钥");
  el.notionSettingsBody.classList.remove("notion-settings__body--open");
  el.btnToggleNotion.setAttribute("aria-expanded", "false");
}

let notionExportBusy = false;
async function onExportModalNotion(button = el.btnExportNotion) {
  if (notionExportBusy || notionConnectBusy) return;
  notionExportBusy = true;
  const mode = exportModalCtx.mode;
  const previous = button?.innerHTML;
  let cfg;
  try {
    cfg = await loadNotionConfig();
    if (!cfg.token || !cfg.parentPageId || notionConfigDirty) {
      pendingNotionExport = {mode, movie:state.detailMovie};
      closeExportModal(); setView(VIEWS.STATS); openNotionSettings();
      el.btnToggleNotion.scrollIntoView({block:'start'});
      renderNotionFeedback('先连接，再导出', '完成下面两项信息，点击「验证并连接」。连接成功后可以继续这次导出。');
      return;
    }
    if (button) {button.disabled = true; button.textContent = '正在导出…';}
    const notes = mode === 'movie' ? [state.detailMovie].filter(Boolean) : await getAllNotes();
    if (!notes.length) {showToast('还没有可导出的记录', 'warn'); return;}
    const successes = [], failures = [];
    let attempted = 0;
    for (const note of notes) {
      if (button) button.textContent = `正在导出 ${attempted + 1}/${notes.length}…`;
      attempted++;
      try {
        const page = await createNotionPageWithMarkdown(cfg.token, cfg.parentPageId, note.movieTitle, exportMovieToNotionMarkdown(note));
        successes.push({id:page.id,label:`${note.movieTitle} ↗`});
      } catch (error) {
        failures.push({title:note.movieTitle,error});
        // Stop a batch on shared auth/network failures; retain completed-page links.
        if ([401,403,404,429].includes(error.status) || ['preview','network','invalid_parent'].includes(error.code) || error.uncertainWrite) break;
      }
    }
    pendingNotionExport = null; $('btnResumeNotionExport').hidden = true;
    closeExportModal(); setView(VIEWS.STATS); openNotionSettings();
    const skipped = notes.length - attempted;
    if (!failures.length) {
      renderNotionFeedback(`已导出 ${successes.length} 个视频`, '每个视频已生成一个子页面。再次导出会新建页面，不会覆盖之前的内容。', {links:[{id:cfg.parentPageId,label:'打开目标页面 ↗'},...successes]});
    } else {
      const first = failures[0].error;
      renderNotionFeedback(`已完成 ${successes.length} 个，失败 ${failures.length} 个${skipped ? `，未开始 ${skipped} 个` : ''}`,
        describeNotionError(first), {error:first,links:[{id:cfg.parentPageId,label:'检查目标页面 ↗'},...successes,...failures.filter(item=>item.error.partialPageId).map(item=>({id:item.error.partialPageId,label:`查看未完整写入的「${item.title}」 ↗`}))],
        lines:failures.map(item=>`${item.title}：${describeNotionError(item.error)}`)});
    }
    $('notionConnectionStatus').scrollIntoView({block:'center',behavior:'smooth'});
  } catch (error) {
    closeExportModal(); setView(VIEWS.STATS); openNotionSettings();
    renderNotionFeedback('未能开始导出', '未能读取笔记或连接设置，请重试。', {error});
  } finally {
    notionExportBusy = false;
    if (button) {button.disabled = false;button.innerHTML = previous;}
  }
}

function setTimestampMode(mode) {
  state.timestampMode = mode === "range" ? "range" : "point";
  el.modePoint.classList.toggle("ts-mode__btn--on", state.timestampMode === "point");
  el.modeRange.classList.toggle("ts-mode__btn--on", state.timestampMode === "range");
  el.blockPoint.hidden = state.timestampMode !== "point";
  el.blockRange.hidden = state.timestampMode !== "range";
  // 切换模式时不共用预览
  el.thumbPreviewPoint.hidden = true;
  el.thumbPreviewRange.hidden = true;
}

function syncPointUiFromState() {
  if (state.pointSeconds != null) {
    el.stampPointInput.value = formatSeconds(state.pointSeconds) || "";
    el.btnClearStamp.disabled = false;
  } else {
    el.stampPointInput.value = "";
    el.btnClearStamp.disabled = true;
  }
}

function syncRangeUiFromState() {
  el.stampStartInput.value =
    state.rangeStartSeconds != null ? formatSeconds(state.rangeStartSeconds) : "";
  el.stampEndInput.value = state.rangeEndSeconds != null ? formatSeconds(state.rangeEndSeconds) : "";
}

function clearErrors() {
  el.errTitle.textContent = "";
  el.errContent.textContent = "";
  el.errTimePoint.textContent = "";
  el.errTimeRange.textContent = "";
  el.movieTitle.classList.remove("is-invalid");
  el.entryContent.classList.remove("is-invalid");
  el.stampPointInput.classList.remove("is-invalid");
  el.stampStartInput.classList.remove("is-invalid");
  el.stampEndInput.classList.remove("is-invalid");
}

function autosizeTextarea() {
  el.entryContent.style.height = "auto";
  el.entryContent.style.height = `${Math.min(360, Math.max(120, el.entryContent.scrollHeight))}px`;
}

function updateWordCount() {
  const n = countChars(el.entryContent.value);
  el.wordCount.textContent = `${n} 字`;
  el.longContentHint.hidden = true;
  el.btnSave.disabled = state.savingEntry || !el.entryContent.value.trim();
}

const panelContext = new URLSearchParams(location.search);
const sourceTabId = panelContext.has('sourceTab') ? Number(panelContext.get('sourceTab')) : null;
const embedded = panelContext.get('embedded') === '1';
const floatingSurface = embedded;
document.documentElement.classList.toggle('is-embedded', floatingSurface);
async function getActiveTab() {
  if (Number.isInteger(sourceTabId)) {
    const tab = await chrome.tabs.get(sourceTabId).catch(() => null);
    return { tabId: tab?.id ?? null, url: tab?.url || '' };
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { tabId: null, url: "" };
  return { tabId: tab.id, url: tab.url || "" };
}

async function safeSend(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg, {frameId:0});
  } catch (e) {
    return { success: false, error: e?.message || "发送失败" };
  }
}

async function maybePrefillTitleAndCover() {
  const { tabId, url } = await getActiveTab();
  state.activeTabId = tabId;
  state.supported = Boolean(tabId) && isSupportedUrl(url);
  el.headerHint.textContent = "记录观看时产生的想法。";

  const timeDisabled = !state.supported;
  el.btnGetTime.disabled = timeDisabled;
  document.getElementById('timeAvailability').hidden = !timeDisabled;
  document.getElementById('btnCaptureCurrent').textContent = '记录新笔记';
  el.btnGetStart.disabled = timeDisabled;
  el.btnGetEnd.disabled = timeDisabled;

  if (!state.supported) return;

  const res = await safeSend(tabId, { type: "GET_VIDEO_TITLE" });
  if (res?.success && (res.title || "").trim()) {
    if (!el.movieTitle.value.trim()) { el.movieTitle.value = res.title.trim(); state.formVideoUrl=url; }
  }
}

function makePill(label, onRemove) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "v14-pill v14-pill--movie v14-pill--removable";
  const txt = document.createElement("span");
  txt.textContent = label;
  const x = document.createElement("span");
  x.className = "pill-x";
  x.textContent = "×";
  x.setAttribute("aria-hidden", "true");
  btn.appendChild(txt);
  btn.appendChild(x);
  btn.addEventListener("click", onRemove);
  return btn;
}

function renderMovieTagsUi() {
  el.movieTagsDisplay.innerHTML = "";
  for (const g of state.movieTags) {
    el.movieTagsDisplay.appendChild(
      makePill(`#${g}`, () => {
        state.movieTags = state.movieTags.filter((x) => x !== g);
        renderMovieTagsUi();
        scheduleDraftSave();
      })
    );
  }
}

function addMovieTagFromRaw(raw) {
  let g = (raw || "").trim();
  if (!g) return;
  g = g.replace(/^#+/, "").trim();
  if (!g) return;
  if (state.movieTags.includes(g)) return;
  state.movieTags.push(g);
  if (el.movieTagInput) el.movieTagInput.value = "";
  renderMovieTagsUi();
  scheduleDraftSave();
}

function renderEntryTags() {
  el.entryTagsDisplay.innerHTML = "";
  for (const t of state.entryTags) {
    el.entryTagsDisplay.appendChild(
      makePill(`#${t}`, () => {
        state.entryTags = state.entryTags.filter((x) => x !== t);
        renderEntryTags();
      })
    );
  }
}

function addEntryTag(raw) {
  let t = (raw || "").trim();
  if (!t) return;
  t = t.replace(/^#+/, "").trim();
  if (!t) return;
  if (state.entryTags.includes(t)) return;
  state.entryTags.push(t);
  el.tagInput.value = "";
  renderEntryTags();
}

async function onGetCurrentTime(which) {
  clearErrors();
  const { tabId, url } = await getActiveTab();
  const expectedUrl = state.newFromDetail ? state.detailMovie?.videoUrl : state.formVideoUrl;
  if (expectedUrl && videoIdentity(url) !== videoIdentity(expectedUrl)) {
    showToast('请先打开所属视频，也可以手动填写时间', 'warn'); return;
  }
  state.activeTabId = tabId;
  state.supported = Boolean(tabId) && isSupportedUrl(url);
  if (!state.supported) {
    showToast("当前页面不支持获取时间戳", "warn");
    return;
  }
  const res = await safeSend(tabId, { type: "GET_VIDEO_TIME" });
  if (!res?.success) {
    el.errTimePoint.textContent = res?.error || "未检测到视频，请确认视频已加载";
    showToast("未检测到视频，请确认视频已加载", "warn");
    return;
  }
  const sec = Number(res.time);
  const fmt = res.formattedTime || formatSeconds(sec);
  if (which === "start") {
    state.rangeStartSeconds = sec;
    el.stampStartInput.value = fmt;
    el.errTimeRange.textContent = "";
  } else if (which === "end") {
    state.rangeEndSeconds = sec;
    el.stampEndInput.value = fmt;
    el.errTimeRange.textContent = "";
  } else {
    state.pointSeconds = sec;
    el.stampPointInput.value = fmt;
    el.btnClearStamp.disabled = false;
    el.errTimePoint.textContent = "";
  }

  // v1.2：点击“获取”立刻截图预览（失败则静默）
  try {
    const shot = await captureThumbnailAt(sec);
    if (shot) {
      state.thumbnailDataUrl = shot;
      if (which === "start" || which === "end") {
        el.thumbPreviewRange.src = shot;
        el.thumbPreviewRange.hidden = false;
      } else {
        el.thumbPreviewPoint.src = shot;
        el.thumbPreviewPoint.hidden = false;
      }
    }
  } catch {
    // ignore
  }
  scheduleDraftSave();
}

async function insertEditorSubtitle() {
  if (state.currentView !== VIEWS.NEW || state.savingEntry) return;
  const {tabId, url} = await getActiveTab();
  const expectedUrl = state.newFromDetail ? state.detailMovie?.videoUrl : state.formVideoUrl;
  if (!tabId || !isSupportedUrl(url) || (expectedUrl && videoIdentity(url) !== videoIdentity(expectedUrl))) {
    showToast('请先打开这条记录所属的视频', 'warn'); return;
  }
  const textarea=el.entryContent;
  const start=textarea.selectionStart, end=textarea.selectionEnd, before=textarea.value;
  const result=await safeSend(tabId,{type:'GET_CURRENT_SUBTITLE'});
  if (!result?.success) { showToast(result?.error || '当前没有可读取的字幕', 'warn');return; }
  // Do not replace text that changed while awaiting a different tab's response.
  if (state.currentView !== VIEWS.NEW || textarea.value !== before || state.savingEntry) return;
  textarea.setRangeText(`「${result.text}」`,start,end,'end');
  textarea.dispatchEvent(new Event('input',{bubbles:true}));
  textarea.focus();showToast('字幕已插入','good');
}

async function navigateWithKeyboard(next) {
  if (state.currentView === VIEWS.NEW) {
    if (state.savingEntry) return;
    clearTimeout(state.draftSaveTimer);
    try { await saveDraft(collectDraftPayload()); }
    catch { showToast('草稿保存失败，请稍后重试','warn');return; }
  }
  setView(next);
  document.getElementById(next === VIEWS.STATS ? 'tabSettings' : 'tabList')?.focus();
}

function validatePointInput() {
  const raw = el.stampPointInput.value.trim();
  if (!raw) {
    state.pointSeconds = null;
    el.btnClearStamp.disabled = true;
    el.stampPointInput.classList.remove("is-invalid");
    el.errTimePoint.textContent = "";
    return true;
  }
  const sec = parseTimeToSeconds(raw);
  if (sec == null) {
    el.stampPointInput.classList.add("is-invalid");
    el.errTimePoint.textContent = "格式应为 MM:SS 或 HH:MM:SS";
    return false;
  }
  state.pointSeconds = sec;
  el.btnClearStamp.disabled = false;
  el.stampPointInput.classList.remove("is-invalid");
  el.errTimePoint.textContent = "";
  return true;
}

function validateRangeInputs() {
  const rs = el.stampStartInput.value.trim();
  const re = el.stampEndInput.value.trim();
  if (!rs && !re) {
    state.rangeStartSeconds = null;
    state.rangeEndSeconds = null;
    el.stampStartInput.classList.remove("is-invalid");
    el.stampEndInput.classList.remove("is-invalid");
    el.errTimeRange.textContent = "";
    return true;
  }
  if (!rs || !re) {
    el.errTimeRange.textContent = "请填写起点和终点";
    if (!rs) el.stampStartInput.classList.add("is-invalid");
    else el.stampStartInput.classList.remove("is-invalid");
    if (!re) el.stampEndInput.classList.add("is-invalid");
    else el.stampEndInput.classList.remove("is-invalid");
    return false;
  }
  const s = parseTimeToSeconds(rs);
  const e = parseTimeToSeconds(re);
  let ok = true;
  if (s == null) {
    el.stampStartInput.classList.add("is-invalid");
    ok = false;
  } else el.stampStartInput.classList.remove("is-invalid");
  if (e == null) {
    el.stampEndInput.classList.add("is-invalid");
    ok = false;
  } else el.stampEndInput.classList.remove("is-invalid");
  if (!ok) {
    el.errTimeRange.textContent = "格式应为 MM:SS 或 HH:MM:SS";
    return false;
  }
  state.rangeStartSeconds = s;
  state.rangeEndSeconds = e;
  if (e <= s) {
    el.errTimeRange.textContent = "终点时间必须晚于起点时间";
    return false;
  }
  el.errTimeRange.textContent = "";
  return true;
}

function buildTimestampPayload() {
  if (state.timestampMode === "point") {
    if (!validatePointInput()) return { ok: false };
    if (state.pointSeconds == null) {
      return {
        ok: true,
        payload: {
          timestampType: null,
          timestamp: null,
          formattedTimestamp: null,
          timestampStart: null,
          timestampEnd: null,
          formattedStart: null,
          formattedEnd: null
        }
      };
    }
    return {
      ok: true,
      payload: {
        timestampType: "point",
        timestamp: state.pointSeconds,
        formattedTimestamp: formatSeconds(state.pointSeconds),
        timestampStart: null,
        timestampEnd: null,
        formattedStart: null,
        formattedEnd: null
      }
    };
  }
  if (!validateRangeInputs()) return { ok: false };
  const rs = el.stampStartInput.value.trim();
  const re = el.stampEndInput.value.trim();
  if (!rs && !re) {
    return {
      ok: true,
      payload: {
        timestampType: null,
        timestamp: null,
        formattedTimestamp: null,
        timestampStart: null,
        timestampEnd: null,
        formattedStart: null,
        formattedEnd: null
      }
    };
  }
  if (state.rangeStartSeconds == null || state.rangeEndSeconds == null) {
    el.errTimeRange.textContent = "请填写完整的时间区间";
    return { ok: false };
  }
  if (state.rangeEndSeconds <= state.rangeStartSeconds) {
    el.errTimeRange.textContent = "终点时间必须晚于起点时间";
    return { ok: false };
  }
  return {
    ok: true,
    payload: {
      timestampType: "range",
      timestamp: null,
      formattedTimestamp: null,
      timestampStart: state.rangeStartSeconds,
      timestampEnd: state.rangeEndSeconds,
      formattedStart: formatSeconds(state.rangeStartSeconds),
      formattedEnd: formatSeconds(state.rangeEndSeconds)
    }
  };
}

async function titlesMatchTab(movieTitle) {
  const { tabId, url } = await getActiveTab();
  if (!tabId || !isSupportedUrl(url)) return false;
  const res = await safeSend(tabId, { type: "GET_VIDEO_TITLE" });
  if (!res?.success) return false;
  const a = (movieTitle || "").trim().toLowerCase();
  const b = (res.title || "").trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

async function seekVideo(seconds, movieTitle) {
  const { tabId, url } = await getActiveTab();
  if (!tabId || !isSupportedUrl(url)) {
    showToast("请先打开对应视频页面再跳转", "warn");
    return;
  }
  const ok = await titlesMatchTab(movieTitle);
  if (!ok) {
    showToast("请先打开对应视频页面再跳转", "warn");
    return;
  }
  const res = await safeSend(tabId, { type: "SEEK_VIDEO", time: seconds });
  if (!res?.success) {
    showToast(res?.error || "跳转失败", "warn");
  }
}

async function captureThumbnailAt(timeSec) {
  if (timeSec == null || Number.isNaN(timeSec)) return null;
  const { tabId, url } = await getActiveTab();
  if (!tabId || !isSupportedUrl(url)) return null;
  const res = await safeSend(tabId, { type: "CAPTURE_FRAME_AT_TIME", time: timeSec });
  if (res?.success && res.dataURL) return res.dataURL;
  return null;
}

async function onSave() {
  if (state.savingEntry || !el.entryContent.value.trim()) return;
  clearErrors();
  const title = el.movieTitle.value.trim();
  const content = el.entryContent.value.trim();
  const movieTags = [...state.movieTags];

  let ok = true;
  if (!title) {
    ok = false;
    el.errTitle.textContent = "请输入视频标题";
    el.movieTitle.classList.add("is-invalid");
  }
  const built = buildTimestampPayload();
  if (!built.ok) return;
  const ts = built.payload;
  if (!ok) return;

  state.savingEntry = true;
  el.btnSave.disabled = true;
  const saveLabel = el.btnSave.textContent;
  el.btnSave.textContent = "保存中…";
  try {
    const thumbnail = state.thumbnailDataUrl || null;

    const { tabId, url } = await getActiveTab();
    let videoUrl = state.formVideoUrl || null;
    if (state.newFromDetail && state.detailMovie) {
      videoUrl = state.detailMovie.videoUrl;
    }
    const { note: savedNote } = await saveEntry(title, movieTags, null, {
      movieId: state.newFromDetail ? state.detailMovieId : null,
      timestampType: ts.timestampType,
      timestamp: ts.timestamp,
      formattedTimestamp: ts.formattedTimestamp,
      timestampStart: ts.timestampStart,
      timestampEnd: ts.timestampEnd,
      formattedStart: ts.formattedStart,
      formattedEnd: ts.formattedEnd,
      thumbnail,
      content,
      tags: [...state.entryTags],
      createdAt: new Date().toISOString(),
      videoUrl
    });
    void syncPush(savedNote.id);

    clearTimeout(state.draftSaveTimer);
    await clearDraft();
    if (el.draftBanner) el.draftBanner.hidden = true;
    showToast("记录已保存", "good");

    el.entryContent.value = "";
    autosizeTextarea();
    updateWordCount();
    state.pointSeconds = null;
    state.rangeStartSeconds = null;
    state.rangeEndSeconds = null;
    state.thumbnailDataUrl = null;
    el.stampPointInput.value = "";
    el.stampStartInput.value = "";
    el.stampEndInput.value = "";
    el.btnClearStamp.disabled = true;
    el.thumbPreviewPoint.hidden = true;
    el.thumbPreviewRange.hidden = true;
    el.thumbPreviewPoint.removeAttribute("src");
    el.thumbPreviewRange.removeAttribute("src");
    state.entryTags = [];
    renderEntryTags();

    state.dirty = false;
    refreshList();
    setView(VIEWS.LIST);
  } catch (e) {
    console.error(e);
    showToast(e?.message || "保存失败，请重试", "danger");
  } finally {
    state.savingEntry = false;
    updateWordCount();
    el.btnSave.textContent = saveLabel || "保存";
  }
}

function onReset() {
  clearErrors();
  el.movieTitle.value = state.draftPrefill.title || "";
  state.movieTags = [...(state.draftPrefill.movieTags || [])];
  renderMovieTagsUi();
  el.entryContent.value = "";
  state.entryTags = [];
  renderEntryTags();
  autosizeTextarea();
  updateWordCount();
  state.pointSeconds = null;
  state.rangeStartSeconds = null;
  state.rangeEndSeconds = null;
  state.thumbnailDataUrl = null;
  el.stampPointInput.value = "";
  el.stampStartInput.value = "";
  el.stampEndInput.value = "";
  el.btnClearStamp.disabled = true;
  el.thumbPreviewPoint.hidden = true;
  el.thumbPreviewRange.hidden = true;
  el.thumbPreviewPoint.removeAttribute("src");
  el.thumbPreviewRange.removeAttribute("src");
  state.dirty = false;
  setTimestampMode("point");
  scheduleDraftSave();
}

function collectDraftPayload() {
  return {
    movieTitle: el.movieTitle.value,
    sourceMovieId: state.newFromDetail ? state.detailMovieId : null,
    videoUrl: state.formVideoUrl,
    thumbnail: state.thumbnailDataUrl || null,
    movieTags: [...state.movieTags],
    timestampMode: state.timestampMode,
    pointSeconds: state.pointSeconds,
    rangeStartSeconds: state.rangeStartSeconds,
    rangeEndSeconds: state.rangeEndSeconds,
    stampPointInput: el.stampPointInput.value,
    stampStartInput: el.stampStartInput.value,
    stampEndInput: el.stampEndInput.value,
    content: el.entryContent.value,
    tags: [...state.entryTags]
  };
}

function scheduleDraftSave() {
  window.clearTimeout(state.draftSaveTimer);
  state.draftSaveTimer = window.setTimeout(async () => {
    const d = collectDraftPayload();
    const has =
      d.movieTitle.trim() ||
      d.content.trim() ||
      (d.movieTags && d.movieTags.length) ||
      d.tags.length ||
      d.stampPointInput.trim() ||
      d.stampStartInput.trim() ||
      d.stampEndInput.trim();
    if (!has) {
      await clearDraft();
      return;
    }
    await saveDraft(d);
  }, 500);
}

async function tryRestoreDraft(d) {
  if (!d) return;
  // v1.4：不显示草稿横幅，直接自动恢复
  await applyDraft(d);
}

async function applyDraft(d) {
  el.movieTitle.value = d.movieTitle || "";
  state.thumbnailDataUrl=d.thumbnail || null;
  state.formVideoUrl=d.videoUrl || null;
  if(d.sourceMovieId){const notes=await getAllNotes();state.detailMovie=notes.find(n=>n.id===d.sourceMovieId)||null;state.detailMovieId=state.detailMovie?.id||null;state.newFromDetail=Boolean(state.detailMovie);}
  state.movieTags = normalizeTagArray(d.movieTags ?? d.movieGenre);
  renderMovieTagsUi();
  setTimestampMode(d.timestampMode === "range" ? "range" : "point");
  state.pointSeconds = typeof d.pointSeconds === "number" ? d.pointSeconds : null;
  state.rangeStartSeconds = typeof d.rangeStartSeconds === "number" ? d.rangeStartSeconds : null;
  state.rangeEndSeconds = typeof d.rangeEndSeconds === "number" ? d.rangeEndSeconds : null;
  el.stampPointInput.value = d.stampPointInput != null ? d.stampPointInput : "";
  validatePointInput();
  el.stampStartInput.value = d.stampStartInput != null ? d.stampStartInput : "";
  el.stampEndInput.value = d.stampEndInput != null ? d.stampEndInput : "";
  validateRangeInputs();
  el.entryContent.value = d.content || "";
  state.entryTags = Array.isArray(d.tags) ? [...d.tags] : [];
  renderEntryTags();
  autosizeTextarea();
  updateWordCount();
  if (el.draftBanner) el.draftBanner.hidden = true;
  state.pendingDraft = null;
}

function filterNotesByQuery(all, q) {
  const query = (q || "").trim().toLowerCase();
  if (!query) return all;
  const hit = (s) => String(s || "").toLowerCase().includes(query);
  return all.filter((n) => {
    if (hit(n.movieTitle)) return true;
    // 电影级标签（风格）
    const movieTags = noteMovieTags(n);
    if (movieTags.some(hit)) return true;
    // 记录内容 + 记录级标签
    const entries = Array.isArray(n.entries) ? n.entries : [];
    return entries.some((e) => {
      if (hit(e.content)) return true;
      const etags = Array.isArray(e.tags) ? e.tags : [];
      return etags.some(hit);
    });
  });
}

function filterNotesByTime(all, tf) {
  if (tf === "all") return all;
  const now = Date.now();
  const ms = tf === "week" ? 7 * 864e5 : 30 * 864e5;
  return all.filter((n) => {
    const t = new Date(n.updatedAt || n.createdAt || 0).getTime();
    return now - t <= ms;
  });
}

function filterNotesByTag(all, tag) {
  if (!tag) return all;
  return all.filter((n) => {
    const entries = Array.isArray(n.entries) ? n.entries : [];
    return entries.some((e) => Array.isArray(e.tags) && e.tags.includes(tag));
  });
}

function sortNotes(all, sortBy) {
  const arr = [...all];
  if (sortBy === "entries") {
    arr.sort((a, b) => (b.entries?.length || 0) - (a.entries?.length || 0));
  } else if (sortBy === "genre") {
    arr.sort((a, b) => {
      const ga = noteMovieTags(a)[0] || "";
      const gb = noteMovieTags(b)[0] || "";
      return ga.localeCompare(gb, "zh-CN");
    });
  } else {
    arr.sort(
      (a, b) =>
        new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
    );
  }
  return arr;
}

function collectAllTags(notes) {
  const set = new Set();
  for (const n of notes) {
    for (const e of n.entries || []) {
      for (const t of e.tags || []) {
        if (t) set.add(t);
      }
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

// Keep an interrupted fold reversible without leaving hidden content focusable.
const previewMotions = new WeakMap();
function setMoviePreviewExpanded(card, expanded, animate = false) {
  const preview = card.querySelector('.note-preview');
  const sheet = preview.querySelector('.note-preview__sheet');
  const toggle = card.querySelector('.movie-card__toggle');
  const wasHidden = preview.hidden;
  const startHeight = wasHidden ? 0 : preview.getBoundingClientRect().height;
  const previous = previewMotions.get(card);
  previous?.forEach(motion => motion.cancel());
  previewMotions.delete(card);
  card.classList.toggle('is-expanded', expanded);
  toggle.setAttribute('aria-expanded', String(expanded));
  preview.inert = !expanded;
  if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    preview.hidden = !expanded;
    return;
  }
  preview.hidden = false;
  const targetHeight = expanded ? preview.scrollHeight : 0;
  const options = { duration: expanded ? 360 : 230, easing: 'cubic-bezier(.22,.7,.22,1)', fill: 'both' };
  const height = preview.animate([{ height: `${startHeight}px` }, { height: `${targetHeight}px` }], options);
  const tucked = { transform: 'perspective(700px) translateY(-24px) rotateX(-9deg) scale(.97)', opacity: 0 };
  const open = { transform: 'perspective(700px) translateY(0) rotateX(0deg) scale(1)', opacity: 1 };
  const page = sheet.animate(expanded ? [tucked, open] : [open, tucked], options);
  const motions = [height, page];
  previewMotions.set(card, motions);
  Promise.all(motions.map(motion => motion.finished)).then(() => {
    if (previewMotions.get(card) !== motions) return;
    preview.hidden = !expanded;
    motions.forEach(motion => motion.cancel());
    previewMotions.delete(card);
  }).catch(() => { /* A second click reversed this animation. */ });
}

let listRenderVersion = 0;
async function refreshList() {
  const version = ++listRenderVersion;
  const allRaw = await getAllNotes();
  if (version !== listRenderVersion) return;
  const all = filterNotesByQuery(allRaw, state.listQuery);
  all.sort(state.homeSort === 'entries'
    ? (a,b) => (b.entries?.length || 0) - (a.entries?.length || 0)
    : (a,b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
  document.getElementById('librarySummary').textContent = `${allRaw.length} 个视频 · ${allRaw.reduce((n,v)=>n+(v.entries?.length||0),0)} 条记录`;
  updateTipToggleUi();
  if (!allRaw.length && !state.tipPointerSeen) showTipPointerHint();
  el.movieList.replaceChildren();
  el.emptyState.classList.toggle('empty--show', !all.length);
  el.emptyState.querySelector('.empty__title').textContent = state.listQuery ? '没有找到相关记录' : '从一个想法开始';
  el.emptyState.querySelector('.empty__sub').textContent = state.listQuery ? '试试其他关键词，也可以搜索记录正文和标签。' : '播放电影、访谈或视频播客，留下第一条记录。';
  for (const note of all) {
    const card = document.createElement('article');
    card.className = 'movie-card'; card.dataset.movieId = note.id;
    const top = document.createElement('div'); top.className = 'movie-card__head';
    const toggle = document.createElement('button'); toggle.type='button'; toggle.className='movie-card__toggle';
    const chevron = document.createElement('span'); chevron.className='movie-card__chevron'; chevron.textContent='›'; chevron.setAttribute('aria-hidden','true');
    const body = document.createElement('span'); body.className='movie-card__body';
    const title = document.createElement('span'); title.className='movie-card__title'; title.textContent=note.movieTitle || '未命名视频';
    const meta = document.createElement('span'); meta.className='movie-card__bottom';
    const url = note.videoUrl || note.entries?.find(e=>e.videoUrl)?.videoUrl;
    meta.textContent = `${url ? platformFromUrl(url)+' · ' : ''}${note.entries?.length || 0} 条记录 · ${formatRelativeTime(note.updatedAt || note.createdAt)}`;
    body.append(title,meta); toggle.append(chevron,body);
    const detail = document.createElement('button'); detail.type='button'; detail.className='movie-card__detail'; detail.textContent='查看详情';
    detail.addEventListener('click',()=>openDetail(note.id));
    top.append(toggle,detail);
    const preview = document.createElement('div'); preview.className='note-preview'; preview.id=`preview-${note.id}`;
    const sheet = document.createElement('div'); sheet.className = 'note-preview__sheet'; preview.append(sheet);
    toggle.setAttribute('aria-controls', preview.id);
    const entries = [...(note.entries || [])].sort((a,b)=>(a.timestampStart??a.timestamp??Infinity)-(b.timestampStart??b.timestamp??Infinity));
    for (const entry of entries) {
      const row = document.createElement('div'); row.className='note-preview__row';
      const seconds = entry.timestampStart ?? entry.timestamp;
      const stamp = document.createElement(seconds == null ? 'span' : 'button'); stamp.className='note-preview__time';
      stamp.textContent = seconds == null ? '随想' : entry.timestampType === 'range' ? `${formatSeconds(seconds)}–${formatSeconds(entry.timestampEnd)}` : formatSeconds(seconds);
      if (seconds != null) { stamp.type='button'; stamp.title='跳转到视频中的这个时间'; stamp.addEventListener('click',()=>seekNoteVideo(note,seconds)); }
      const copy = document.createElement('div'); copy.className='note-preview__copy';
      const text = document.createElement('p'); text.className='note-preview__text'; text.textContent=entry.content || '';
      copy.append(text);
      if ((entry.content || '').length > 140 || (entry.content || '').split('\n').length > 3) {
        text.classList.add('is-clamped');
        const more = document.createElement('button'); more.type='button'; more.className='note-preview__more'; more.textContent='展开全文'; more.setAttribute('aria-expanded','false');
        more.addEventListener('click',()=>{const clamped=text.classList.toggle('is-clamped');more.textContent=clamped?'展开全文':'收起';more.setAttribute('aria-expanded',String(!clamped));});copy.append(more);
      }
      if (entry.tags?.length) {
        const tags=document.createElement('div'); tags.className='note-preview__tags';
        entry.tags.forEach(t=>{const tag=document.createElement('span');tag.textContent='#'+t;tags.append(tag);});copy.append(tags);
      }
      row.append(stamp,copy);sheet.append(row);
    }
    if (!entries.length) { const empty=document.createElement('p');empty.className='preview-empty';empty.textContent='这个视频还没有记录';sheet.append(empty); }
    card.append(top,preview);
    setMoviePreviewExpanded(card, state.expandedMovieId === note.id);
    toggle.addEventListener('click',()=>{
      const opening = toggle.getAttribute('aria-expanded') !== 'true';
      el.movieList.querySelectorAll('.movie-card.is-expanded').forEach(other => {
        if (other !== card) setMoviePreviewExpanded(other, false, true);
      });
      state.expandedMovieId = opening ? note.id : null;
      setMoviePreviewExpanded(card, opening, true);
    });
    el.movieList.append(card);
  }
}

async function seekNoteVideo(note, seconds) {
  const source = note.videoUrl || note.entries?.find(e=>e.videoUrl)?.videoUrl;
  if (!source || !isSupportedUrl(source)) { showToast('这条记录没有可打开的视频链接','warn'); return; }
  const current = await getActiveTab();
  if (current.tabId && videoIdentity(source) === videoIdentity(current.url)) {
    const result = await safeSend(current.tabId,{type:'SEEK_VIDEO',time:seconds});
    if (!result?.success) showToast(result?.error || '暂时无法跳转','warn');
    return;
  }
  const u=new URL(source);
  if (u.hostname.endsWith('youtube.com') || u.hostname.endsWith('bilibili.com')) u.searchParams.set('t',String(Math.floor(seconds)));
  else showToast('已打开原视频，请定位到 '+formatSeconds(seconds),'good');
  await chrome.tabs.create({url:u.href});
}

function renderSampleCards() {
  for (const s of SAMPLE_MOVIES) {
    const card = document.createElement("div");
    card.className = "movie-card";

    const left = document.createElement("div");
    left.className = "movie-card__body";

    const title = document.createElement("div");
    title.className = "movie-card__title";
    title.textContent = s.movieTitle;

    const meta = document.createElement("div");
    meta.className = "movie-card__meta";
    for (const g of s.tags) {
      const badge = document.createElement("span");
      applyV14MovieTagPill(badge, g);
      meta.appendChild(badge);
    }

    const bottom = document.createElement("div");
    bottom.className = "movie-card__bottom";
    const count = document.createElement("span");
    count.className = "movie-card__count";
    count.textContent = `${s.entries.length} 条记录`;
    const updated = document.createElement("span");
    updated.className = "movie-card__updated";
    updated.textContent = `最近编辑：${formatRelativeTime(s.updatedAt)}`;
    bottom.appendChild(count);
    bottom.appendChild(updated);

    left.appendChild(title);
    left.appendChild(meta);
    left.appendChild(bottom);

    card.appendChild(left);
    const sampleSlot = document.createElement("div");
    sampleSlot.className = "movie-card__actions";
    const sampleBadge = document.createElement("span");
    sampleBadge.className = "movie-card__sample-badge";
    sampleBadge.textContent = "示例";
    sampleSlot.appendChild(sampleBadge);
    card.appendChild(sampleSlot);
    card.addEventListener("click", () => openDetail(s.id));
    el.movieList.appendChild(card);
  }
}

function setOnboardingExpanded(expanded) {
  state.onboardingDismissed = !expanded;
  dismissTipPointerHint(true);
  if (expanded) { void refreshShortcutLabels(); el.onboardBanner.hidden=false; if (!el.onboardBanner.open) { el.onboardBanner.showModal(); el.onboardBanner.querySelector('.help-scroll').scrollTop = 0; } }
  else { el.onboardBanner.close(); el.onboardBanner.hidden=true; el.btnOnboardToggle.focus(); }
  updateTipToggleUi();
}
function toggleOnboarding() { setOnboardingExpanded(state.onboardingDismissed); }
function updateTipToggleUi() {
  if (!el.btnOnboardToggle) return;
  el.btnOnboardToggle.setAttribute('aria-expanded', String(!state.onboardingDismissed));
  el.btnOnboardToggle.title='使用帮助与快捷键';
}

let _tipPointerTimer = null;
function showTipPointerHint() {
  if (!el.tipPointer) return;
  el.tipPointer.hidden = false;
  el.tipPointer.classList.remove("tip-pointer--leaving");
  if (_tipPointerTimer) clearTimeout(_tipPointerTimer);
  _tipPointerTimer = setTimeout(() => dismissTipPointerHint(true), 9000);
}
function dismissTipPointerHint(persist) {
  if (!el.tipPointer || el.tipPointer.hidden) {
    if (persist) {
      state.tipPointerSeen = true;
      try { localStorage.setItem("mn:tipPointerSeen", "1"); } catch {}
    }
    return;
  }
  if (_tipPointerTimer) { clearTimeout(_tipPointerTimer); _tipPointerTimer = null; }
  el.tipPointer.classList.add("tip-pointer--leaving");
  setTimeout(() => {
    if (el.tipPointer) el.tipPointer.hidden = true;
  }, 220);
  if (persist) {
    state.tipPointerSeen = true;
    try { localStorage.setItem("mn:tipPointerSeen", "1"); } catch {}
  }
}

/**
 * 悬浮球等在页面内写入 chrome.storage.local 的 movieNotes 时，侧边栏若已打开不会自动重读。
 * 通过 onChanged + 回到前台时 refresh，与数据保持同步。
 */
async function syncUiAfterExternalStorageWrite() {
  try {
    if (state.currentView === VIEWS.DETAIL && state.detailMovieId) {
      if (el.detailEntries?.querySelector("textarea")) return;
      const all = await getAllNotes();
      const refreshed = all.find((n) => n.id === state.detailMovieId);
      if (refreshed) {
        state.detailMovie = refreshed;
        renderDetail(refreshed);
      } else {
        state.detailMovie = null;
        state.detailMovieId = null;
        setView(VIEWS.LIST);
        await refreshList();
      }
    } else if (state.currentView === VIEWS.STATS) {
      await renderLog();
    } else if (state.currentView === VIEWS.LIST) {
      await refreshList();
    }
    // VIEWS.NEW：用户正在编辑草稿，不打扰
  } catch (e) {
    console.error("syncUiAfterExternalStorageWrite", e);
  }
}

async function openDetail(movieId) {
  if (isSampleMovieId(movieId)) {
    const sample = SAMPLE_MOVIES.find((s) => s.id === movieId);
    if (!sample) { showToast("未找到该示例", "warn"); return; }
    state.detailMovieId = movieId;
    state.detailMovie = sample;
    renderDetail(sample);
    setView(VIEWS.DETAIL);
    showToast("这是示例。可以左上角返回，然后写下你自己的第一部电影", "good", 3000);
    return;
  }
  const all = await getAllNotes();
  const note = all.find((n) => n.id === movieId);
  if (!note) {
    showToast("未找到该视频", "warn");
    return;
  }
  state.detailMovieId = movieId;
  state.detailMovie = note;

  renderDetail(note);
  setView(VIEWS.DETAIL);
}

// ── 就地编辑：保存电影元信息 ─────────────────────────────────────────

async function saveDetailMeta(patch) {
  const note = state.detailMovie;
  if (!note) return;
  if (isSampleMovieId(note.id)) {
    showToast("示例不可编辑，写下你自己的第一条记录吧", "good", 2400);
    renderDetail(note);
    return;
  }
  try {
    await updateMovie(note.id, patch);
    void syncPush(note.id);
    const allNow = await getAllNotes();
    const refreshed = allNow.find((n) => n.id === note.id);
    if (refreshed) {
      state.detailMovie = refreshed;
      renderDetail(refreshed);
      refreshList();
    }
  } catch (e) {
    showToast(e?.message || "保存失败", "danger");
  }
}

// ── 就地编辑：标签行 ─────────────────────────────────────────────────

function renderDetailMovieTags(note) {
  const container = el.detailGenres;
  if (!container) return;
  container.innerHTML = "";
  const tags = noteMovieTags(note).slice(0, 3);

  tags.forEach((tag, i) => {
    const pill = document.createElement("span");
    pill.className = "v14-pill v14-pill--movie v14-pill--editable";

    const txt = document.createElement("span");
    txt.textContent = tag;
    pill.appendChild(txt);

    const rmBtn = document.createElement("button");
    rmBtn.type = "button";
    rmBtn.className = "v14-pill__remove";
    rmBtn.setAttribute("aria-label", `删除标签 ${tag}`);
    rmBtn.textContent = "×";
    rmBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await saveDetailMeta({ tags: tags.filter((_, j) => j !== i) });
    });
    pill.appendChild(rmBtn);
    container.appendChild(pill);
  });

  if (tags.length < 3) {
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "v14-pill v14-pill--add";
    addBtn.textContent = "＋ 标签";
    addBtn.addEventListener("click", () => {
      addBtn.remove();
      const inp = document.createElement("input");
      inp.type = "text";
      inp.className = "v14-pill__input";
      inp.placeholder = "标签名";
      inp.maxLength = 20;
      container.appendChild(inp);
      inp.focus();

      let _tagCommitted = false;
      const commit = async (save) => {
        if (_tagCommitted) return;
        _tagCommitted = true;
        const val = inp.value.trim();
        inp.remove();
        if (save && val) {
          await saveDetailMeta({ tags: [...tags, val].slice(0, 3) });
        } else {
          renderDetailMovieTags(state.detailMovie);
        }
      };
      inp.addEventListener("blur", () => commit(true));
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); commit(true); }
        if (e.key === "Escape") { e.preventDefault(); commit(false); }
      });
    });
    container.appendChild(addBtn);
  }
}

function _attachTitleEdit(titleEl) {
  titleEl.onclick = () => {
    if (titleEl.dataset.editing) return;
    titleEl.dataset.editing = "1";
    const original = state.detailMovie?.movieTitle || "";
    const inp = document.createElement("input");
    inp.className = "detailHero__title-input";
    inp.value = original;
    titleEl.replaceWith(inp);
    inp.focus(); inp.select();
    let committed = false;
    const done = async (save) => {
      if (committed) return;
      committed = true;
      const next = inp.value.trim();
      const div = document.createElement("div");
      div.className = "detailHero__title detailHero__title--editable";
      div.id = "detailTitleLine";
      div.title = "点击编辑视频标题";
      div.textContent = (save && next) ? next : original;
      inp.replaceWith(div);
      el.detailTitleLine = div;
      _attachTitleEdit(div); // 每次替换后绑定全新闭包，不复用旧引用
      if (save && next && next !== original) {
        await saveDetailMeta({ movieTitle: next });
      }
    };
    inp.addEventListener("blur", () => done(true));
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); done(true); }
      if (e.key === "Escape") { e.preventDefault(); done(false); }
    });
  };
}

function renderDetail(note) {
const title = note.movieTitle || "（未命名）";
  const titleEl = el.detailTitleLine;
  if (titleEl) {
    titleEl.textContent = title;
    _attachTitleEdit(titleEl);
  }
  renderDetailMovieTags(note);
  const entries = Array.isArray(note.entries) ? [...note.entries] : [];
  entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  el.detailCount.textContent = `${entries.length} 条记录`;

  const lastUrl =
    entries.find((e) => e?.videoUrl)?.videoUrl || note.videoUrl || "";

  if (el.detailTopVideoLink) {
    el.detailTopVideoLink.textContent = "";
    el.detailTopVideoLink.setAttribute("aria-disabled", "true");
  }

  if (el.detailVideoLink) {
    if (!lastUrl) {
      el.detailVideoLink.hidden = true;
    } else {
      const extIcon = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" style="flex-shrink:0;vertical-align:-1px" aria-hidden="true"><path d="M6 1.5h2.5v2.5M8.5 1.5 4.5 5.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.5 6.5v1a.5.5 0 0 1-.5.5H2a.5.5 0 0 1-.5-.5V2A.5.5 0 0 1 2 1.5H3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
      el.detailVideoLink.hidden = false;
      el.detailVideoLink.disabled = false;
      el.detailVideoLink.innerHTML = `${extIcon} ${platformFromUrl(lastUrl)}`;
      el.detailVideoLink.onclick = async () => {
        try {
          await chrome.tabs.create({ url: lastUrl });
        } catch {
          // ignore
        }
      };
    }
  }

  el.detailEntries.innerHTML = "";

  // 分离：整体影评（无时间戳） vs 时间戳记录
  const reviews = entries.filter((e) => !e.timestampType);
  const stamps  = entries.filter((e) =>  e.timestampType);

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "entry-card";
    empty.innerHTML = `<div class="entry-card__content entry-card__content--empty">点击“＋ 记录”，为这个视频写下第一条想法。</div>`;
    el.detailEntries.appendChild(empty);
    return;
  }

  function appendSectionLabel(text, opts) {
    const lbl = document.createElement("div");
    lbl.className = "section-label";
    const span = document.createElement("span");
    span.textContent = text;
    lbl.appendChild(span);
    if (opts?.withSortToggle) {
      const asc = state.detailStampSortAsc;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "section-label__sort";
      btn.dataset.dir = asc ? "asc" : "desc";
      btn.title = asc ? "当前：时间正序" : "当前：时间倒序";
      btn.setAttribute("aria-label", "切换时间排序");
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="m6 11 6-6 6 6"/></svg>`;
      btn.addEventListener("click", () => {
        state.detailStampSortAsc = !state.detailStampSortAsc;
        try { localStorage.setItem("mn:detailStampSortAsc", state.detailStampSortAsc ? "1" : "0"); } catch {}
        if (state.detailMovie) renderDetail(state.detailMovie);
      });
      lbl.appendChild(btn);
    }
    el.detailEntries.appendChild(lbl);
  }

  // 记录按视频时间戳排序（无时间戳的回退用 createdAt）
  const stampSec = (e) => {
    if (e.timestampType === "range") return Number(e.timestampStart ?? e.timestamp ?? 0);
    return Number(e.timestamp ?? 0);
  };
  stamps.sort((a, b) => {
    const diff = stampSec(a) - stampSec(b);
    if (diff !== 0) return state.detailStampSortAsc ? diff : -diff;
    const t = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return state.detailStampSortAsc ? t : -t;
  });

  const allOrdered = [];
  if (reviews.length) {
    appendSectionLabel("我的影评");
    for (const it of reviews) allOrdered.push(it);
  }
  if (stamps.length) {
    appendSectionLabel("记录", { withSortToggle: true });
    for (const it of stamps) allOrdered.push(it);
  }

  for (const it of allOrdered) {
    const card = document.createElement("div");
    card.className = "entry-card";

    if (it.thumbnail || it.hasThumbnail) {
      const thumb = document.createElement("img");
      thumb.className = "entry-thumb";
      thumb.alt = "视频帧";
      thumb.title = "点击放大查看";
      let resolvedSrc = it.thumbnail || null;
      if (resolvedSrc) {
        thumb.src = resolvedSrc;
      } else {
        // 懒加载：缩略图存在独立 key 里
        readEntryThumbnail(it.id).then((src) => {
          if (!src) { thumb.remove(); return; }
          resolvedSrc = src;
          thumb.src = src;
        }).catch(() => thumb.remove());
      }
      thumb.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (!resolvedSrc) return;
        try {
          chrome.tabs.create({ url: resolvedSrc });
        } catch {
          // ignore
        }
      });
      card.appendChild(thumb);
    }

    const top = document.createElement("div");
    top.className = "entry-card__top";

    let t;
    if (it.timestampType === "range" && it.formattedStart && it.formattedEnd) {
      // 区间：拆成起点 + → + 终点，两端各自可点击跳转
      t = document.createElement("span");
      t.className = "time-tag-range";

      const btnStart = document.createElement("button");
      btnStart.type = "button";
      btnStart.className = "time-tag-btn time-tag--on";
      btnStart.textContent = `◷ ${it.formattedStart}`;
      btnStart.addEventListener("click", () => {
        if (typeof it.timestampStart === "number") seekNoteVideo(note, it.timestampStart);
      });

      const arrow = document.createElement("span");
      arrow.className = "time-tag-arrow";
      arrow.textContent = "→";

      const btnEnd = document.createElement("button");
      btnEnd.type = "button";
      btnEnd.className = "time-tag-btn time-tag--on";
      btnEnd.textContent = `◷ ${it.formattedEnd}`;
      btnEnd.addEventListener("click", () => {
        if (typeof it.timestampEnd === "number") seekNoteVideo(note, it.timestampEnd);
      });

      t.appendChild(btnStart);
      t.appendChild(arrow);
      t.appendChild(btnEnd);
    } else {
      t = document.createElement("button");
      t.type = "button";
      t.className = "time-tag-btn";
      if (it.formattedTimestamp || it.timestamp != null) {
        t.classList.add("time-tag--on");
        t.textContent = it.formattedTimestamp ? `◷ ${it.formattedTimestamp}` : `◷ ${formatSeconds(it.timestamp)}`;
        t.addEventListener("click", () => {
          if (typeof it.timestamp === "number") seekNoteVideo(note, it.timestamp);
        });
      } else {
        t.classList.add("time-tag--off");
        t.textContent = "无时间戳";
        t.disabled = true;
      }
    }

    const del = document.createElement("button");
    del.className = "text-link entry-card__action entry-card__del";
    del.type = "button";
    del.title = "删除此条记录";
    del.textContent = "删除";
    del.addEventListener("click", async () => {
      if (isSampleMovieId(note.id)) {
        showToast("示例不可编辑，写下你自己的第一条记录吧", "good", 2400);
        return;
      }
      const sure = await showConfirm("确定删除这条记录吗？", "删除");
      if (!sure) return;
      try {
        await deleteEntry(note.id, it.id);
        void syncPush(note.id);
        const allNow = await getAllNotes();
        const refreshed = allNow.find((n) => n.id === note.id);
        if (refreshed) {
          state.detailMovie = refreshed;
          renderDetail(refreshed);
          refreshList();
        }
        showToast("已删除此条记录", "good");
      } catch (e) {
        console.error(e);
        showToast("删除失败，请重试", "danger");
      }
    });

    const edit = document.createElement("button");
    edit.className = "text-link entry-card__action entry-card__edit";
    edit.type = "button";
    edit.title = "编辑此条记录";
    edit.textContent = "编辑";

    const share = document.createElement("button");
    share.className = "text-link entry-card__action entry-card__share";
    share.type = "button";
    share.title = "分享/复制此条记录";
    share.textContent = "分享";
    share.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const movieTitle = note.movieTitle || "（未命名）";
      const when =
        it.timestampType === "range" && it.formattedStart && it.formattedEnd
          ? `◷ ${it.formattedStart} → ${it.formattedEnd}`
          : it.formattedTimestamp
            ? `◷ ${it.formattedTimestamp}`
            : typeof it.timestamp === "number"
              ? `◷ ${formatSeconds(it.timestamp)}`
              : "无时间刻度";
      const url = it.videoUrl || note.videoUrl || "";

      // Raw timestamp in seconds for building a deep-link URL
      const timestampSeconds =
        it.timestampType === "range" && typeof it.timestampStart === "number"
          ? it.timestampStart
          : typeof it.timestamp === "number"
            ? it.timestamp
            : null;

      let thumbForShare = it.thumbnail || null;
      if (!thumbForShare && it.hasThumbnail) {
        try { thumbForShare = await readEntryThumbnail(it.id); } catch { thumbForShare = null; }
      }

      const payload = {
        v: 1,
        movieTitle,
        when,
        createdAt: it.createdAt || note.updatedAt || note.createdAt || "",
        content: (it.content || "").trim(),
        tags: Array.isArray(it.tags) ? it.tags : [],
        videoUrl: url || "",
        timestampSeconds,
        thumbnail: thumbForShare
      };

      await openShareCardInTab(payload);
    });

    top.appendChild(t);

    const createdTop = document.createElement("span");
    createdTop.className = "entry-card__created";
    createdTop.textContent = formatLocalTime(it.createdAt);

    const btnGroup = document.createElement("div");
    btnGroup.className = "entry-card__btn-group";
    btnGroup.appendChild(share);
    btnGroup.appendChild(edit);
    btnGroup.appendChild(del);

    const topActions = document.createElement("div");
    topActions.className = "entry-card__actions";
    topActions.appendChild(createdTop);
    topActions.appendChild(btnGroup);
    top.appendChild(topActions);

    const content = document.createElement("div");
    content.className = "entry-card__content md-content md-content--serif";
    content.innerHTML = renderMarkdown(it.content || "");

    const tagsRow = document.createElement("div");
    tagsRow.className = "entry-tags-row";
    for (const tg of it.tags || []) {
      const span = document.createElement("span");
      span.className = "mini-tag";
      span.textContent = `#${tg}`;
      tagsRow.appendChild(span);
    }

    // Reading-time estimate (1 Chinese char ≈ 0.4 s at 250 chars/min)
    const charCount = (it.content || "").replace(/\s/g, "").length;
    const readMin = Math.max(1, Math.round(charCount / 250));
    const readTimeEl = document.createElement("div");
    readTimeEl.className = "entry-card__read-time";
    readTimeEl.textContent = `约 ${readMin} 分钟`;

    card.appendChild(content);
    if (tagsRow.childNodes.length) card.appendChild(tagsRow);
    if (charCount > 80) card.appendChild(readTimeEl);
    card.appendChild(top);

    el.detailEntries.appendChild(card);

    edit.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      if (isSampleMovieId(note.id)) {
        showToast("示例不可编辑，写下你自己的第一条记录吧", "good", 2400);
        return;
      }
      if (card.dataset.editing === "1") return;
      card.dataset.editing = "1";

      const origin = (it.content || "").trim();
      const editor = document.createElement("div");
      editor.className = "entry-editor";
      const ta = document.createElement("textarea");
      ta.className = "textarea entry-editor__ta";
      ta.rows = 6;
      ta.value = origin;

      // ── Inline tag editor ──────────────────────────────────────
      let editTags = [...(it.tags || [])];

      const tagLabel = document.createElement("div");
      tagLabel.className = "entry-editor__hint";
      tagLabel.textContent = "标签";

      const tagChips = document.createElement("div");
      tagChips.className = "entry-editor__tag-preview";

      const tagIn = document.createElement("input");
      tagIn.type = "text";
      tagIn.className = "input input--compact";
      tagIn.placeholder = "回车添加标签…";
      tagIn.autocomplete = "off";

      const renderEditTags = () => {
        tagChips.innerHTML = "";
        for (const t of editTags) {
          tagChips.appendChild(makePill(`#${t}`, () => {
            editTags = editTags.filter((x) => x !== t);
            renderEditTags();
          }));
        }
        tagChips.hidden = editTags.length === 0;
      };
      renderEditTags();

      let tagComposing = false;
      tagIn.addEventListener("compositionstart", () => { tagComposing = true; });
      tagIn.addEventListener("compositionend",   () => { tagComposing = false; });
      tagIn.addEventListener("keydown", (e) => {
        if (tagComposing || e.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          const raw = tagIn.value.trim().replace(/^#+/, "").trim();
          if (raw && !editTags.includes(raw)) {
            editTags.push(raw);
            renderEditTags();
          }
          tagIn.value = "";
        }
      });

      const row = document.createElement("div");
      row.className = "entry-editor__actions";
      const shortcutLabel = document.createElement("span");
      shortcutLabel.className = "shortcut-hint";
      shortcutLabel.textContent = "⌘ Enter";
      const btnOk = document.createElement("button");
      btnOk.type = "button";
      btnOk.className = "btn btn--mini btn--primary";
      btnOk.textContent = "保存";
      const btnCancel = document.createElement("button");
      btnCancel.type = "button";
      btnCancel.className = "btn btn--mini btn--secondary";
      btnCancel.textContent = "取消";
      row.appendChild(shortcutLabel);
      row.appendChild(btnCancel);
      row.appendChild(btnOk);

      editor.appendChild(ta);
      editor.appendChild(tagLabel);
      editor.appendChild(tagChips);
      editor.appendChild(tagIn);
      editor.appendChild(row);

      content.replaceWith(editor);
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);

      const exitEdit = () => {
        editor.replaceWith(content);
        card.dataset.editing = "0";
      };

      const doSaveEdit = async () => {
        const nextText = (ta.value || "").trim();
        if (!nextText) {
          showToast("内容不能为空", "warn");
          return;
        }
        btnOk.disabled = true;
        btnOk.textContent = "保存中…";
        try {
          await updateEntry(note.id, it.id, { content: nextText, tags: editTags });
          void syncPush(note.id);
          const allNow = await getAllNotes();
          const refreshed = allNow.find((n) => n.id === note.id);
          if (refreshed) {
            state.detailMovie = refreshed;
            renderDetail(refreshed);
            refreshList();
          }
          showToast("已保存修改", "good");
        } catch (e) {
          console.error(e);
          showToast(e?.message || "保存失败，请重试", "danger");
          btnOk.disabled = false;
          btnOk.textContent = "保存";
        }
      };

      ta.addEventListener("keydown", (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.isComposing) {
          e.preventDefault();
          doSaveEdit();
        }
      });

      btnCancel.addEventListener("click", () => exitEdit());
      btnOk.addEventListener("click", () => doSaveEdit());
    });
  }

}

function jumpToNewPrefilled(title, tags, hideMovieMeta = false, fromDetail = false) {
  state.newFromDetail = fromDetail;
  state.formVideoUrl = fromDetail ? state.detailMovie?.videoUrl || null : null;
  state.thumbnailDataUrl = null;
  el.thumbPreviewPoint.hidden = true; el.thumbPreviewRange.hidden = true;
  state.draftPrefill = { title: (title || "").trim(), movieTags: normalizeTagArray(tags) };
  el.movieTitle.value = state.draftPrefill.title;
  state.movieTags = [...state.draftPrefill.movieTags];
  renderMovieTagsUi();
  el.entryContent.value = "";
  state.entryTags = [];
  renderEntryTags();
  autosizeTextarea();
  updateWordCount();
  state.pointSeconds = null;
  state.rangeStartSeconds = null;
  state.rangeEndSeconds = null;
  el.stampPointInput.value = "";
  el.stampStartInput.value = "";
  el.stampEndInput.value = "";
  el.btnClearStamp.disabled = true;
  setTimestampMode("point");
  setView(VIEWS.NEW);
  const metaFields = document.getElementById("newMovieMetaFields");
  if (metaFields) metaFields.hidden = false;
}

async function renderLog() {

  const notes = await getAllNotes();
  const totalMovies = notes.length;
  let totalEntries = 0;
  const daySet = new Set();
  const dayCount = {};

  const toLocalYmd = (iso) => {
    const d = new Date(iso || 0);
    if (!d || Number.isNaN(d.getTime())) return "";
    const pad2 = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };

  for (const n of notes) {
    const entries = Array.isArray(n.entries) ? n.entries : [];
    totalEntries += entries.length;
    for (const e of entries) {
      const ymd = toLocalYmd(e.createdAt || n.updatedAt || n.createdAt);
      if (!ymd) continue;
      daySet.add(ymd);
      dayCount[ymd] = (dayCount[ymd] || 0) + 1;
    }
  }

  el.statsGrid.innerHTML = "";
  const cells = [
    ["视频数", String(totalMovies)],
    ["记录数", String(totalEntries)],
    ["总记录天数", String(daySet.size)]
  ];
  for (const [k, v] of cells) {
    const box = document.createElement("div");
    box.className = "stat-cell";
    box.innerHTML = `<div class="stat-cell__k">${escapeHtml(k)}</div><div class="stat-cell__v">${escapeHtml(
      v
    )}</div>`;
    el.statsGrid.appendChild(box);
  }

  if (!el.heatmap) return;
  el.heatmap.innerHTML = "";

  const colorFor = (n) => {
    if (!n) return "var(--accent-soft)";
    if (n === 1) return "color-mix(in srgb, var(--accent) 35%, transparent)";
    if (n <= 3) return "color-mix(in srgb, var(--accent) 65%, transparent)";
    return "var(--accent)";
  };

  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    const row = document.createElement("div");
    row.className = "hm-row";
    const label = document.createElement("div");
    label.className = "hm-label";
    label.textContent = `${m + 1}月`;
    const grid = document.createElement("div");
    grid.className = "hm-grid";

    const pad2 = (n) => String(n).padStart(2, "0");
    for (let day = 1; day <= daysInMonth; day++) {
      const ymd = `${y}-${pad2(m + 1)}-${pad2(day)}`;
      const n = dayCount[ymd] || 0;
      const cell = document.createElement("div");
      cell.className = "hm-cell";
      cell.style.background = colorFor(n);
      cell.title = `${ymd}：记录了 ${n} 条记录`;
      grid.appendChild(cell);
    }

    row.appendChild(label);
    row.appendChild(grid);
    el.heatmap.appendChild(row);
  }

  try {
    const notionCfg = await loadNotionConfig();
    if (!notionConfigDirty && !notionConnectBusy) {
      if (el.notionToken) el.notionToken.value = notionCfg.token;
      if (el.notionParentId) el.notionParentId.value = notionPageUrl(notionCfg.parentPageId) || notionCfg.parentPageId;
      updateNotionBadge(notionCfg);
      if ($('notionConnectionStatus').hidden && notionCfg.token) {
        renderNotionFeedback(notionCfg.verifiedAt ? '上次已验证写入' : '已保存 · 写入尚未验证',
          notionCfg.verifiedAt ? `目标页面：${notionCfg.parentTitle || '未命名页面'}。权限变更后请重新验证。` : '旧版只验证页面可读。点击「验证并连接」，确认可以实际创建笔记页面。',
          {links:[{id:notionCfg.parentPageId,label:'打开目标页面 ↗'}]});
      }
    }
  } catch {
    // ignore
  }
}

function bindEvents() {
  window.addEventListener('message', event => {
    if (!embedded || event.source !== window.parent || event.data?.type !== 'MN_NAVIGATE_HOME') return;
    void navigateWithKeyboard(VIEWS.LIST);
  });
  document.getElementById('btnCloseLibrary').hidden=!floatingSurface;
  document.getElementById('btnCloseLibrary').addEventListener('click',()=>runLibraryAction('close'));
  document.getElementById('btnOpenFull').hidden=!floatingSurface;
  document.getElementById('btnOpenFull').addEventListener('click',async()=>{
    if (state.currentView === VIEWS.NEW) { clearTimeout(state.draftSaveTimer); await saveDraft(collectDraftPayload()); }
    await chrome.tabs.create({url:chrome.runtime.getURL(`panel.html?sourceTab=${sourceTabId}`)});
    await runLibraryAction('close');
  });
  document.getElementById('btnCloseHelp').addEventListener('click',()=>setOnboardingExpanded(false));
  document.getElementById('btnHelpDone').addEventListener('click',()=>setOnboardingExpanded(false));
  const helpScroll = el.onboardBanner.querySelector('.help-scroll');
  bindHelpSnap(helpScroll, el.onboardBanner);
  helpScroll.addEventListener('scroll', () => {
    const inShortcuts = helpScroll.scrollTop >= helpScroll.querySelector('.help-tutorial').offsetHeight * .6;
    el.onboardBanner.querySelector('.help-footer span').textContent = inShortcuts ? '向上滚动，返回教程' : '向下滚动，查看快捷键';
  }, { passive: true });
  const shortcutSection = el.onboardBanner.querySelector('.help-shortcuts');
  if ('IntersectionObserver' in window) {
    shortcutSection.classList.add('will-reveal');
    const reveal = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        shortcutSection.classList.add('is-revealed');
        reveal.disconnect();
      }
    }, { root: el.onboardBanner.querySelector('.help-scroll'), threshold: 0.12 });
    reveal.observe(shortcutSection);
  }
  el.onboardBanner.addEventListener('cancel',e=>{e.preventDefault();setOnboardingExpanded(false);});
  el.onboardBanner.addEventListener('click',e=>{if(e.target===el.onboardBanner){const r=el.onboardBanner.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)setOnboardingExpanded(false);}});
  document.getElementById('btnShortcutSettings').addEventListener('click',()=>chrome.tabs.create({url:'chrome://extensions/shortcuts'}));
  document.getElementById('btnEditorSubtitle').addEventListener('click',insertEditorSubtitle);
  document.addEventListener('keydown',e=>{
    if(e.isComposing || e.keyCode === 229 || e.repeat || e.defaultPrevented) return;
    const modalOpen = !el.onboardBanner.hidden || el.confirmModal?.hidden === false || el.exportModal?.hidden === false;
    if (e.key==='Escape' && !modalOpen) {
      if (state.currentView===VIEWS.DETAIL && el.detailEntries.querySelector('textarea')) return;
      if (state.currentView !== VIEWS.LIST) { e.preventDefault();void navigateWithKeyboard(VIEWS.LIST);return; }
      if (floatingSurface) { e.preventDefault();void runLibraryAction('close');return; }
    }
    if (e.key === 'Tab' && embedded && !modalOpen) {
      const controls=[...document.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')].filter(n=>n.getClientRects().length && getComputedStyle(n).visibility!=='hidden');
      const first=controls[0],last=controls.at(-1);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === document.body)) { e.preventDefault();last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === document.body)) { e.preventDefault();first?.focus(); }
      return;
    }
    if (!modalOpen && state.currentView === VIEWS.NEW && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (e.code === 'KeyS') { e.preventDefault();void insertEditorSubtitle(); }
      if (e.code === 'KeyT') {
        e.preventDefault();
        // In range mode, update the focused endpoint; otherwise the start, without discarding the range.
        if (!state.savingEntry) void onGetCurrentTime(state.timestampMode === 'range' ? (e.target === el.stampEndInput ? 'end' : 'start') : 'point');
      }
      return;
    }
    if (!modalOpen && state.currentView === VIEWS.LIST && e.target === el.searchInput && e.key === 'ArrowDown') {
      e.preventDefault();el.movieList.querySelector('.movie-card__toggle')?.focus();return;
    }
    const typing=e.target.closest?.('input,textarea,select,[contenteditable="true"]');
    if (typing || modalOpen || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key==='/') { e.preventDefault(); if(state.currentView!==VIEWS.NEW) {setView(VIEWS.LIST);el.searchInput.focus();} }
    else if(e.key==='?') { e.preventDefault();setOnboardingExpanded(true); }
    else if(e.key.toLowerCase()==='n') { e.preventDefault();if(state.currentView===VIEWS.NEW)el.entryContent.focus();else void startCapture(true); }
    else if(e.key.toLowerCase()==='s') { e.preventDefault();void navigateWithKeyboard(VIEWS.STATS); }
    else if(e.key.toLowerCase()==='l') { e.preventDefault();void navigateWithKeyboard(VIEWS.LIST); }
    else if (state.currentView === VIEWS.LIST && e.target.matches('.movie-card__toggle')) {
      const toggles=[...el.movieList.querySelectorAll('.movie-card__toggle')],index=toggles.indexOf(e.target);
      if (e.key==='ArrowDown' || e.key==='ArrowUp') { e.preventDefault();toggles[Math.max(0,Math.min(toggles.length-1,index+(e.key==='ArrowDown'?1:-1)))]?.focus(); }
      if ((e.key==='ArrowRight' && e.target.getAttribute('aria-expanded')==='false') || (e.key==='ArrowLeft' && e.target.getAttribute('aria-expanded')==='true')) { e.preventDefault();e.target.click(); }
    }
  });
  chrome.runtime.onMessage?.addListener((msg,_sender,respond)=>{
    if (msg?.type!=='MN_KEYBOARD_COMMAND') return;
    if (msg.command==='toggle-library') setView(VIEWS.LIST);
    if (msg.command==='quick-note' && !state.composing && el.onboardBanner.hidden && el.confirmModal?.hidden !== false && el.exportModal?.hidden !== false) {
      if (state.currentView===VIEWS.NEW) el.entryContent.focus();else void startCapture(true);
    }
    respond({success:true});
  });
  document.getElementById('btnCaptureCurrent').addEventListener('click',()=>startCapture(false));
  document.getElementById('btnDeleteMovie').addEventListener('click',async()=>{
    const note=state.detailMovie;
    if(!note || isSampleMovieId(note.id)) return;
    if(!await showConfirm(`确定删除「${note.movieTitle}」的全部记录吗？此操作不可撤销。`,'删除')) return;
    try { await deleteMovie(note.id);void syncDelete(note.id);state.detailMovie=null;state.detailMovieId=null;setView(VIEWS.LIST);showToast('已删除视频及其记录','good'); }
    catch { showToast('删除失败，请重试','danger'); }
  });
  el.themeToggle?.addEventListener("click", () => {
    toggleTheme();
  });

  // Tab bar
  document.getElementById("tabList")?.addEventListener("click", () => {
    if (state.currentView !== VIEWS.LIST) setView(VIEWS.LIST);
  });
  document.getElementById("tabNew")?.addEventListener("click", async () => { // element removed, kept for safety
    setView(VIEWS.NEW);
    await maybePrefillTitleAndCover();
    tryFocusEntry();
  });
  document.getElementById("tabSettings")?.addEventListener("click", () => setView(VIEWS.STATS));

  el.btnSearchToggle?.addEventListener('click',()=>el.searchInput.focus());

  el.btnOnboardToggle?.addEventListener("click", () => {
    toggleOnboarding();
    // 点击后让小手指消失
    dismissTipPointerHint(true);
  });

  el.btnToggleNotion?.addEventListener("click", () => {
    const isOpen = el.btnToggleNotion.getAttribute("aria-expanded") === "true";
    if (isOpen) {
      closeNotionSettings();
    } else {
      openNotionSettings();
    }
  });

  el.btnToggleToken?.addEventListener("click", () => {
    const input = el.notionToken;
    if (!input) return;
    const isHidden = input.type === "password";
    input.type = isHidden ? "text" : "password";
    el.btnToggleToken.textContent = isHidden ? "隐藏" : "显示";
    el.btnToggleToken.setAttribute("aria-label", isHidden ? "隐藏连接密钥" : "显示连接密钥");
  });

  // ⌘/Ctrl+Enter 在 Notion 设置展开区域内触发保存
  el.notionSettingsBody?.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      el.btnSaveNotionConfig?.click();
    }
  });

  el.btnSaveNotionConfig?.addEventListener('click', connectNotion);
  for (const input of [el.notionToken, el.notionParentId]) input.addEventListener('input', () => {
    notionConfigDirty = notionInputsChanged();
    el.notionStatusBadge.textContent = notionConfigDirty ? '尚未保存' : (savedNotionConfig.verifiedAt ? '已验证写入' : '待验证写入');
    $('btnResumeNotionExport').hidden = true;
    renderNotionFeedback('连接信息已更改', '点击「验证并连接」后生效。导出不会使用未验证的新设置。');
  });
  $('btnDisconnectNotion').addEventListener('click', async () => {
    if (notionConnectBusy || notionExportBusy) return;
    try {
      const saved = await saveNotionConfig({token:'',parentPageId:''});
      el.notionToken.value = ''; el.notionParentId.value = ''; notionConfigDirty = false; updateNotionBadge(saved);
      $('btnResumeNotionExport').hidden = true;
      renderNotionFeedback('连接已清除', '此浏览器中保存的密钥已清除。Notion 中已有的页面保持不变。');
    } catch { renderNotionFeedback('未能清除连接', '浏览器未能保存更改，请重试。'); }
  });
  $('btnResumeNotionExport').addEventListener('click', async event => {
    if (!pendingNotionExport) return;
    exportModalCtx.mode = pendingNotionExport.mode;
    if (pendingNotionExport.mode === 'movie') state.detailMovie = pendingNotionExport.movie;
    await onExportModalNotion(event.currentTarget);
  });

  el.modePoint.addEventListener("click", () => {
    setTimestampMode("point");
    scheduleDraftSave();
  });
  el.modeRange.addEventListener("click", () => {
    setTimestampMode("range");
    scheduleDraftSave();
  });

  el.btnGetTime.addEventListener("click", () => onGetCurrentTime("point"));
  el.btnGetStart.addEventListener("click", () => onGetCurrentTime("start"));
  el.btnGetEnd.addEventListener("click", () => onGetCurrentTime("end"));

  el.btnClearStamp.addEventListener("click", () => {
    state.pointSeconds = null;
    el.stampPointInput.value = "";
    el.btnClearStamp.disabled = true;
    el.errTimePoint.textContent = "";
    el.stampPointInput.classList.remove("is-invalid");
    state.thumbnailDataUrl = null;
    el.thumbPreviewPoint.hidden = true;
    el.thumbPreviewPoint.removeAttribute("src");
  });

  el.btnClearStart?.addEventListener("click", () => {
    state.rangeStartSeconds = null;
    el.stampStartInput.value = "";
    el.errTimeRange.textContent = "";
    el.stampStartInput.classList.remove("is-invalid");
    validateRangeInputs();
    if (!el.stampStartInput.value.trim() && !el.stampEndInput.value.trim()) {
      state.thumbnailDataUrl = null;
      el.thumbPreviewRange.hidden = true;
      el.thumbPreviewRange.removeAttribute("src");
    }
  });
  el.btnClearEnd?.addEventListener("click", () => {
    state.rangeEndSeconds = null;
    el.stampEndInput.value = "";
    el.errTimeRange.textContent = "";
    el.stampEndInput.classList.remove("is-invalid");
    validateRangeInputs();
    if (!el.stampStartInput.value.trim() && !el.stampEndInput.value.trim()) {
      state.thumbnailDataUrl = null;
      el.thumbPreviewRange.hidden = true;
      el.thumbPreviewRange.removeAttribute("src");
    }
  });

  el.stampPointInput.addEventListener("blur", () => validatePointInput());
  el.stampPointInput.addEventListener("input", () => {
    state.dirty = true;
    scheduleDraftSave();
  });
  el.stampStartInput.addEventListener("blur", () => validateRangeInputs());
  el.stampEndInput.addEventListener("blur", () => validateRangeInputs());
  el.stampStartInput.addEventListener("input", () => {
    state.dirty = true;
    scheduleDraftSave();
  });
  el.stampEndInput.addEventListener("input", () => {
    state.dirty = true;
    scheduleDraftSave();
  });

  el.btnSave.addEventListener("click", onSave);
  el.btnReset.addEventListener("click", onReset);

  el.entryContent.addEventListener("input", () => {
    state.dirty = true;
    autosizeTextarea();
    updateWordCount();
    scheduleDraftSave();
  });

  el.movieTitle.addEventListener("input", () => {
    state.dirty = true;
    scheduleDraftSave();
  });

  // Cmd/Ctrl+Enter anywhere in the new-note form → save
  el.viewNew.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      el.btnSave?.click();
    }
  });

  el.tagInput.addEventListener("keydown", (e) => {
    if (e.isComposing || state.composing || e.keyCode === 229) return;
    if (e.key === "Enter") {
      e.preventDefault();
      addEntryTag(el.tagInput.value);
      state.dirty = true;
      scheduleDraftSave();
    }
  });

  el.tagInput.addEventListener("compositionstart", () => {
    state.composing = true;
  });
  el.tagInput.addEventListener("compositionend", () => {
    state.composing = false;
  });

  el.movieTagInput?.addEventListener("keydown", (e) => {
    if (e.isComposing || state.composing || e.keyCode === 229) return;
    if (e.key === "Enter" || e.key === " " || e.code === "Space") {
      e.preventDefault();
      addMovieTagFromRaw(el.movieTagInput.value);
      state.dirty = true;
      scheduleDraftSave();
    }
  });

  el.movieTagInput?.addEventListener("compositionstart", () => {
    state.composing = true;
  });
  el.movieTagInput?.addEventListener("compositionend", () => {
    state.composing = false;
  });

  el.movieTagInput?.addEventListener("input", () => {
    state.dirty = true;
    scheduleDraftSave();
  });

  el.searchInput.addEventListener("input", (e) => {
    state.listQuery = e.target.value || "";
    refreshList();
  });

  el.homeSortLabel?.addEventListener("click", () => {
    state.homeSort = state.homeSort === "recent" ? "entries" : "recent";
    syncHomeSortLabel();
    refreshList();
  });

  // ── 账号 ──────────────────────────────────────────────────────────
  document.getElementById("btnGoogleLogin")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "登录中…";
    try {
      await signInWithGoogle();
      // OAuth 完成后立即隐藏 guest 区，防止「登录中」按钮残留
      const guestEl = document.getElementById("accountGuest");
      if (guestEl) guestEl.hidden = true;

      const user = await getUser();
      if (!user) throw new Error("获取用户信息失败");
      _syncUserId = user.id;
      renderAccountUi(user);
      setSyncDot("syncing");
      showToast("登录成功，正在同步…", "good");

      // 首次登录：把本地全部数据推上去
      const notes = await getAllNotes();
      await pushAll(notes, _syncUserId);

      // 拉取远端（其他设备上的数据）
      const merged = await pull(notes);
      await refreshList();
      setSyncDot("ok");
      showToast("同步完成 ✓", "good");
      // 兜底：确保账号 UI 与最终状态一致
      renderAccountUi(user);
    } catch (e) {
      console.error("[sync] login failed", e);
      // 只有真正失败（_syncUserId 未设置）才恢复按钮
      if (_syncUserId) {
        setSyncDot("pending");
        showToast(e?.message || "同步未完成，本地笔记已保留", "danger", 6000);
        return;
      }
      showToast(e?.message || "登录失败，请重试", "danger", 4500);
      // 恢复 guest 区和按钮
      const guestEl2 = document.getElementById("accountGuest");
      if (guestEl2) guestEl2.hidden = false;
      btn.disabled = false;
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.6 2.4 30.1 0 24 0 14.8 0 7 5.5 3.1 13.5l7.8 6C12.7 13.8 17.9 9.5 24 9.5z"/>
        <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17z"/>
        <path fill="#FBBC05" d="M10.9 28.5A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.1.8-4.5l-7.8-6A24 24 0 0 0 0 24c0 3.8.9 7.4 2.5 10.6l8.4-6.1z"/>
        <path fill="#34A853" d="M24 48c6.1 0 11.2-2 14.9-5.4l-7.5-5.8c-2 1.4-4.6 2.2-7.4 2.2-6.1 0-11.3-4.1-13.1-9.7l-8.4 6.1C7 43.2 14.8 48 24 48z"/>
      </svg> 使用 Google 账号登录`;
    }
  });

  document.getElementById("btnSignOut")?.addEventListener("click", async () => {
    const sure = await showConfirm("退出后切换到未登录笔记库。当前账号的笔记保留在本机，重新登录该账号后可查看。", "退出");
    if (!sure) return;
    await supabaseSignOut();
    _syncUserId = null;
    renderAccountUi(null);
    showToast("已退出登录", "good");
  });

  document.getElementById("btnResyncAll")?.addEventListener("click", () => resyncAll());

  el.btnExportAll.addEventListener("click", async () => {
    exportModalCtx.mode = 'all';
    try { await onExportModalMarkdown(); } catch { showToast('导出失败，请重试', 'danger'); }
  });
  document.getElementById('btnExportAllNotion').addEventListener('click', async event => {
    if (notionExportBusy) return;
    exportModalCtx.mode = 'all';
    await onExportModalNotion(event.currentTarget);
  });

  el.btnExportMovie.addEventListener("click", () => {
    if (!state.detailMovie) return;
    if (isSampleMovieId(state.detailMovie.id)) {
      showToast("示例不可导出，开始记录你的第一部电影吧", "good", 2400);
      return;
    }
    openExportModal("movie");
  });

  el.btnExportMd?.addEventListener("click", () => onExportModalMarkdown());
  el.btnExportNotion?.addEventListener("click", () => onExportModalNotion());
  el.exportModalBackdrop?.addEventListener("click", () => closeExportModal());
  el.btnExportModalClose?.addEventListener("click", () => closeExportModal());

  el.btnBackFromDetail?.addEventListener("click", () => setView(VIEWS.LIST));

  document.getElementById("btnAddMoreTop")?.addEventListener("click", () => {
    if (state.detailMovie && isSampleMovieId(state.detailMovie.id)) {
      showToast("示例不可追加记录，先返回写下你自己的第一部电影吧", "good", 2600);
      return;
    }
    if (state.detailMovie) {
      jumpToNewPrefilled(state.detailMovie.movieTitle, noteMovieTags(state.detailMovie), true, true);
    } else {
      setView(VIEWS.NEW);
    }
  });


  const hasUnsaved = () => {
    if (state.dirty) return true;
    if (el.movieTitle.value.trim()) return true;
    if (el.entryContent.value.trim()) return true;
    if (state.movieTags.length) return true;
    if (state.entryTags.length) return true;
    if (el.stampPointInput.value.trim() || el.stampStartInput.value.trim() || el.stampEndInput.value.trim())
      return true;
    if (state.thumbnailDataUrl) return true;
    return false;
  };

  el.btnBackFromNew?.addEventListener("click", async () => {
    clearTimeout(state.draftSaveTimer);
    try { await saveDraft(collectDraftPayload()); } catch { showToast('草稿保存失败，请重试','warn'); return; }
    if (state.newFromDetail && state.detailMovie) {
      setView(VIEWS.DETAIL);
    } else {
      setView(VIEWS.LIST);
    }
  });

  // v1.4：草稿横幅已移除；恢复/忽略按钮不存在

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      maybePrefillTitleAndCover();
      tryFocusEntry();
      void refreshList();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.uiTheme) applyTheme(changes.uiTheme.newValue);
    if (area === "local" && changes.asideDataOwner?.oldValue != null && changes.asideDataOwner.oldValue !== changes.asideDataOwner.newValue) {
      // Drop old account UI, timers and in-flight editing state.
      location.reload();
      return;
    }
    if (area === "session" && changes.focusEntry) {
      tryFocusEntry();
    }
    if (area === "local" && Object.keys(changes).some(k => k.endsWith(":movieNotes"))) {
      void syncUiAfterExternalStorageWrite();
    }
  });
}

function tryFocusEntry() {
  chrome.storage.session.get("focusEntry", (r) => {
    if (r?.focusEntry) {
      if (state.currentView !== VIEWS.NEW) setView(VIEWS.NEW);
      el.entryContent.focus();
      chrome.storage.session.remove("focusEntry");
    }
  });
}

async function startCapture(fromKeyboard = false) {
  if (embedded && state.supported) { await runLibraryAction('quick'); return; }
  if (!el.entryContent.value.trim()) {
    state.newFromDetail=false;state.formVideoUrl=null;el.movieTitle.value='';state.movieTags=[];renderMovieTagsUi();
  }
  setView(VIEWS.NEW); await maybePrefillTitleAndCover();
  if (fromKeyboard) el.entryContent.focus();
}
async function refreshShortcutLabels() {
  const isMac = /Mac|iPhone|iPad/i.test(navigator.userAgentData?.platform || navigator.platform || '');
  const alt = isMac ? 'Option' : 'Alt';
  const localLabels = { subtitle: `${alt} + S`, timestamp: `${alt} + T`, editor: `${alt} + S / T`, save: isMac ? '⌘ Enter' : 'Ctrl + Enter' };
  document.querySelectorAll('[data-local-shortcut]').forEach(node => { node.textContent = localLabels[node.dataset.localShortcut] || ''; });
  const formatShortcut = value => value.replace(/⌥\s*(?:\+\s*)?/g,'Option + ').replace(/⌘\s*(?:\+\s*)?/g,'⌘ + ').replace(/⇧\s*(?:\+\s*)?/g,'Shift + ').replace(/⌃\s*(?:\+\s*)?/g,'Ctrl + ').replace(/\bAlt\b/g,alt).replace(/\bCommand\b/g,isMac ? '⌘' : 'Command').replace(/\s*\+\s*/g,' + ').trim();
  document.querySelectorAll('[data-command]').forEach(node => { node.textContent = formatShortcut(node.textContent); });
  if (!chrome.commands?.getAll) return;
  try {
    const commands=await chrome.commands.getAll();
    document.querySelectorAll('[data-command]').forEach(node=>{
      const command=commands.find(c=>c.name===node.dataset.command);
      node.textContent=command?.shortcut ? formatShortcut(command.shortcut) : '未设置';
    });
  } catch { /* retain readable defaults while Chrome is unavailable */ }
}

async function runLibraryAction(action) {
  try {
    if (state.currentView === VIEWS.NEW) { clearTimeout(state.draftSaveTimer); await saveDraft(collectDraftPayload()); }
    const result=await chrome.runtime.sendMessage({type:'MN_LIBRARY_ACTION',tabId:sourceTabId,action});
    if (!result?.success) showToast(result?.error || '请先在支持的网站播放视频','warn');
  } catch { showToast('页面已更新，请刷新视频页面后重试','warn'); }
}

async function init() {
  void refreshShortcutLabels();
  // 后台迁移：把 entry.thumbnail（dataURL）搬到独立 key，减少主数组体积
  await getOwner();
  await migrateThumbnailsIfNeeded();
  await loadTheme();
  configureMarked();
  renderMovieTagsUi();
  syncHomeSortLabel();
  bindEvents();
  autosizeTextarea();
  updateWordCount();
  setTimestampMode("point");
  syncPointUiFromState();
  syncRangeUiFromState();

  const draft = await loadDraft();
  if (
    draft &&
    (draft.movieTitle ||
      draft.content ||
      (draft.movieTags && draft.movieTags.length) ||
      (draft.movieGenre && draft.movieGenre.length) ||
      (draft.tags && draft.tags.length))
  ) {
    await tryRestoreDraft(draft);
  }

  await maybePrefillTitleAndCover();
  await refreshList();
  tryFocusEntry();

  setView(VIEWS.LIST);

  // 账号初始化（异步，不阻塞首屏渲染）
  void initAccount();
}

init();
