import { localData, withDataLock, getOwner } from "./local-data.js";
import { videoIdentity } from "./platform.js";
import { mergeNote } from "./merge.js";
import { normalizeTagArray } from "./common.js";
export { normalizeTagArray };

const STORAGE_KEY = "movieNotes";
const DRAFT_KEY = "draft";
const THUMB_PREFIX = "thumb:";
const DATA_VERSION_KEY = "storageDataVersion";
const CURRENT_DATA_VERSION = 2;

function thumbKey(entryId) {
  return `${THUMB_PREFIX}${entryId}`;
}

export async function readEntryThumbnail(entryId) {
  if (!entryId) return null;
  try {
    const k = thumbKey(entryId);
    const data = await localData.get(k);
    return data?.[k] ?? null;
  } catch {
    return null;
  }
}

async function writeEntryThumbnail(entryId, dataUrl) {
  if (!entryId || !dataUrl) return false;
  try {
    await localData.set({ [thumbKey(entryId)]: dataUrl });
    return true;
  } catch (e) {
    console.warn("[storage] write thumbnail failed", e?.message);
    return false;
  }
}

async function removeEntryThumbnails(entryIds) {
  const ids = Array.isArray(entryIds) ? entryIds.filter(Boolean) : [];
  if (!ids.length) return;
  try {
    await localData.remove(ids.map(thumbKey));
  } catch {
    // ignore
  }
}

function nowIso() {
  return new Date().toISOString();
}

function safeUUID() {
  try {
    return crypto.randomUUID();
  } catch {
    return `uuid-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
  }
}

// ── URL / Title 规范化（查找去重用）──────────────────────────────────

const _normalizeUrl = videoIdentity;

function _normalizeTitle(t) {
  return (t || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function migrateEntry(e) {
  if (!e || typeof e !== "object") return e;
  const out = { ...e };
  if (!out.timestampType) {
    if (out.timestamp != null && typeof out.timestamp === "number") {
      out.timestampType = "point";
    } else {
      out.timestampType = null;
    }
  }
  if (!Array.isArray(out.tags)) out.tags = [];
  if (out.thumbnail == null) out.thumbnail = null;
  if (typeof out.hasThumbnail !== "boolean") {
    out.hasThumbnail = typeof out.thumbnail === "string" && out.thumbnail.startsWith("data:");
  }
  if (out.timestampStart == null) out.timestampStart = null;
  if (out.timestampEnd == null) out.timestampEnd = null;
  if (out.formattedStart == null) out.formattedStart = null;
  if (out.formattedEnd == null) out.formattedEnd = null;
  return out;
}

function migrateNote(n) {
  if (!n || typeof n !== "object") return n;
  const out = { ...n };
  // v1.4：movieGenre -> tags（兼容旧数据）
  out.tags = normalizeTagArray(out.tags ?? out.movieGenre);
  if (!Array.isArray(out.tags)) out.tags = [];
  // 兼容旧 UI/逻辑仍读取 movieGenre 的情况
  out.movieGenre = out.tags;
  if (out.coverImage == null) out.coverImage = null;
  if (out.videoUrl == null) out.videoUrl = null;
  out.entries = Array.isArray(out.entries) ? out.entries.map(migrateEntry) : [];
  return out;
}

async function readAllRaw() {
  try {
    const data = await localData.get(STORAGE_KEY);
    const arr = Array.isArray(data?.[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
    return arr;
  } catch (e) {
    console.error("storage read failed", e);
    throw new Error("无法读取笔记，已停止写入以保护现有数据");
  }
}

async function writeAll(notes) {
  try {
    await localData.set({ [STORAGE_KEY]: notes });
  } catch (e) {
    console.error("storage write failed", e);
    const hint = e?.message || String(e);
    throw new Error(
      hint.includes("QUOTA") || hint.toLowerCase().includes("quota")
        ? `存储配额不足：${hint}`
        : `写入失败：${hint}`
    );
  }
}

export async function getAllNotes() {
  const raw = await readAllRaw();
  return raw.filter(n => !n.deletedAt).map(migrateNote);
}

// 供同步引擎将 pull 后的合并数据写回本地
async function applyRemoteNotesUnlocked(notes, expectedOwner) {
  if (expectedOwner !== await getOwner()) throw new Error("账号已切换，同步结果未写入");
  if (!notes.length) return getAllNotes();
  const current = await readAllRaw();
  const byId = new Map(current.map(n => [n.id, n]));
  for (const remote of notes) {
    const local = byId.get(remote.id);
    const merged = mergeNote(local, remote);
    merged.syncDirty = local ? local.syncDirty !== false : false;
    merged.syncRevision = local?.syncRevision;
    for (const entry of merged.entries || []) {
      if (entry.thumbnail?.startsWith('data:') && await writeEntryThumbnail(entry.id, entry.thumbnail)) {
        entry.thumbnail = null;
        entry.hasThumbnail = true;
      }
    }
    byId.set(remote.id, merged);
  }
  await writeAll([...byId.values()]);
  return (await getAllNotes());
}

export async function getSyncNotes() { return (await readAllRaw()).map(migrateNote); }

async function markNoteSyncedUnlocked(id, revision, expectedOwner) {
  if (expectedOwner !== await getOwner()) return;
  const notes = await readAllRaw();
  const note = notes.find(n => n.id === id);
  if (note && note.syncRevision === revision) { note.syncDirty = false; await writeAll(notes); }
}

export async function getNoteByTitle(title) {
  const all = (await readAllRaw()).map(migrateNote);
  const norm = _normalizeTitle(title);
  if (!norm) return null;
  return all.find((n) => !n.deletedAt && _normalizeTitle(n.movieTitle) === norm) || null;
}

export async function getNoteByVideoUrl(url) {
  const all = (await readAllRaw()).map(migrateNote);
  const norm = _normalizeUrl(url);
  if (!norm) return null;
  return all.find((n) => !n.deletedAt && n.videoUrl && _normalizeUrl(n.videoUrl) === norm) || null;
}

export async function getNoteById(id) {
  const all = (await readAllRaw()).map(migrateNote);
  return all.find((n) => !n.deletedAt && n.id === id) || null;
}

/**
 * @param {string} movieTitle
 * @param {string[]} movieGenre
 * @param {string|null} coverImage
 * @param {object} entry
 */
async function saveEntryUnlocked(movieTitle, movieGenre, coverImage, entry) {
  const title = (movieTitle || "").trim();
  const tags = normalizeTagArray(movieGenre);
  if (entry?.expectedOwner && entry.expectedOwner !== await getOwner()) throw new Error("账号已切换，请重新打开笔记");
  if (!title) throw new Error("movieTitle 不能为空");
  if (!entry || typeof entry !== "object") throw new Error("entry 无效");

  const all = (await readAllRaw()).map(migrateNote);
  let now = nowIso();

  // 1. 优先按 videoUrl 规范化匹配（去掉时间戳等无关参数）
  // 2. 回退到 title 规范化匹配（忽略大小写与多余空白）
  let note = entry.movieId ? all.find(n => n.id === entry.movieId && !n.deletedAt) : null;
  if (entry.movieId && !note) throw new Error("原影片已不存在，请重新选择");
  const normUrl = entry.videoUrl ? _normalizeUrl(entry.videoUrl) : null;
  if (!note && normUrl) {
    note = all.find((n) => !n.deletedAt && n.videoUrl && _normalizeUrl(n.videoUrl) === normUrl);
  }
  if (!note && !normUrl) {
    const normTitle = _normalizeTitle(title);
    note = all.find((n) => !n.deletedAt && !n.videoUrl && _normalizeTitle(n.movieTitle) === normTitle);
  }
  if (!note) {
    note = migrateNote({
      id: safeUUID(),
      movieTitle: title,
      tags,
      coverImage: null,
      videoUrl: entry.videoUrl || null,
      entries: [],
      createdAt: now,
      updatedAt: now
    });
    all.unshift(note);
  } else {
    if (movieGenre != null) {
      note.tags = tags;
      note.movieGenre = tags;
    }
    // v1.2：不再维护 coverImage
    if (entry.videoUrl) note.videoUrl = entry.videoUrl;
  }

  now = new Date(Math.max(Date.now(), Date.parse(note.updatedAt || 0) + 1 || 0)).toISOString();
  const entryId = entry.id || safeUUID();
  if (all.some(n => n.deletedEntries?.[entryId] || (n.deletedAt && n.entries?.some(e => e.id === entryId)))) throw new Error("这条笔记已经删除，请新建记录");
  const existing = all.flatMap(n => n.entries || []).find(e => e.id === entryId);
  if (existing) return { note: all.find(n => n.entries?.some(e => e.id === entryId)), entry: existing };
  const rawThumb =
    typeof entry.thumbnail === "string" && entry.thumbnail.startsWith("data:")
      ? entry.thumbnail
      : null;

  // 缩略图存到独立 key，主数组只保留 hasThumbnail 标记 —— 避免每次写入都序列化巨大的 base64
  let storedThumb = false;
  if (rawThumb) {
    storedThumb = await writeEntryThumbnail(entryId, rawThumb);
  }

  const newEntry = {
    id: entryId,
    timestampType: entry.timestampType ?? null,
    timestamp: entry.timestamp ?? null,
    timestampStart: entry.timestampStart ?? null,
    timestampEnd: entry.timestampEnd ?? null,
    formattedTimestamp: entry.formattedTimestamp ?? null,
    formattedStart: entry.formattedStart ?? null,
    formattedEnd: entry.formattedEnd ?? null,
    thumbnail: null,
    hasThumbnail: storedThumb,
    content: (entry.content || "").trim(),
    tags: Array.isArray(entry.tags) ? entry.tags.map((t) => String(t).trim()).filter(Boolean) : [],
    videoUrl: entry.videoUrl || null,
    updatedAt: now,
    createdAt: entry.createdAt || now
  };

  note.entries = Array.isArray(note.entries) ? note.entries : [];
  note.entries.push(newEntry);
  note.updatedAt = now;
  note.syncDirty = true;
  note.syncRevision = safeUUID();
  // note.videoUrl：取最近一条 entry 的 url（兜底为 entry.videoUrl）
  if (newEntry.videoUrl) note.videoUrl = newEntry.videoUrl;

  try {
    await writeAll(all);
  } catch (e) {
    if (storedThumb) await removeEntryThumbnails([entryId]);
    throw e;
  }
  return { note: migrateNote(note), entry: newEntry };
}

async function deleteMovieUnlocked(movieId) {
  const all = (await readAllRaw()).map(migrateNote);
  const note = all.find(n => n.id === movieId);
  if (!note) return true;
  const now = new Date(Math.max(Date.now(), Date.parse(note.updatedAt || 0) + 1 || 0)).toISOString();
  note.deletedAt = now;
  note.updatedAt = now;
  note.syncDirty = true;
  note.syncRevision = safeUUID();
  await writeAll(all);
  // Keep thumbnails until explicit cleanup/backup, so interrupted sync is recoverable.
  return true;
}

async function deleteEntryUnlocked(movieId, entryId) {
  const all = (await readAllRaw()).map(migrateNote);
  const note = all.find((n) => n.id === movieId);
  if (!note) return true;
  note.entries = (Array.isArray(note.entries) ? note.entries : []).filter((e) => e.id !== entryId);
  note.updatedAt = new Date(Math.max(Date.now(), Date.parse(note.updatedAt || 0) + 1 || 0)).toISOString();
  note.syncDirty = true;
  note.syncRevision = safeUUID();
  note.deletedEntries = { ...note.deletedEntries, [entryId]: note.updatedAt };
  await writeAll(all);
  await removeEntryThumbnails([entryId]);
  return true;
}

async function updateEntryUnlocked(movieId, entryId, patch) {
  const all = (await readAllRaw()).map(migrateNote);
  const note = all.find((n) => n.id === movieId);
  if (!note) throw new Error("未找到电影");
  const entries = Array.isArray(note.entries) ? note.entries : [];
  const idx = entries.findIndex((e) => e.id === entryId);
  if (idx < 0) throw new Error("未找到迷思");
  const cur = migrateEntry(entries[idx]);
  const next = { ...cur };

  if (patch && typeof patch === "object") {
    if (patch.content != null) next.content = String(patch.content || "").trim();
    if (patch.tags != null) {
      next.tags = Array.isArray(patch.tags)
        ? patch.tags.map((t) => String(t).trim()).filter(Boolean)
        : [];
    }
    if (patch.videoUrl != null) next.videoUrl = String(patch.videoUrl || "").trim() || null;
  }
  if (!next.content) throw new Error("内容不能为空");

  entries[idx] = next;
  note.entries = entries;
  note.updatedAt = new Date(Math.max(Date.now(), Date.parse(note.updatedAt || 0) + 1 || 0)).toISOString();
  next.updatedAt = note.updatedAt;
  note.syncDirty = true;
  note.syncRevision = safeUUID();
  // note.videoUrl：同步为最近一条有 url 的 entry
  const withUrl = [...entries]
    .filter((e) => e?.videoUrl)
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  note.videoUrl = withUrl[0]?.videoUrl || note.videoUrl || null;
  await writeAll(all);
  return { note: migrateNote(note), entry: next };
}

async function updateMovieUnlocked(movieId, patch) {
  const all = (await readAllRaw()).map(migrateNote);
  const note = all.find((n) => n.id === movieId);
  if (!note) throw new Error("未找到电影");
  if (!patch || typeof patch !== "object") return { note: migrateNote(note) };

  if (patch.movieTitle != null) {
    const t = String(patch.movieTitle || "").trim();
    if (!t) throw new Error("电影标题不能为空");
    note.movieTitle = t;
  }
  // v1.4：tags 为主，兼容 movieGenre 入参
  const incomingTags = patch.tags ?? patch.movieGenre;
  if (incomingTags != null) {
    const t = normalizeTagArray(incomingTags);
    note.tags = t;
    note.movieGenre = t; // 兼容旧读取
  }
  if (patch.videoUrl != null) {
    const u = String(patch.videoUrl || "").trim();
    note.videoUrl = u || null;
  }

  note.updatedAt = new Date(Math.max(Date.now(), Date.parse(note.updatedAt || 0) + 1 || 0)).toISOString();
  note.syncDirty = true;
  note.syncRevision = safeUUID();
  await writeAll(all);
  return { note: migrateNote(note) };
}

/* —— 一次性迁移：把 entry.thumbnail（dataURL）搬到独立 thumb:<id> key —— */

async function migrateThumbnailsIfNeededUnlocked() {
  const raw = await readAllRaw();
  let changed = false;
  for (const note of raw) {
    for (const entry of note.entries || []) {
      if (entry.id && entry.thumbnail?.startsWith("data:")) {
        if (!await writeEntryThumbnail(entry.id, entry.thumbnail)) continue;
        entry.hasThumbnail = true;
        entry.thumbnail = null;
        changed = true;
      }
    }
  }
  if (changed) await writeAll(raw);
}

/* —— Draft —— */

const defaultDraft = () => ({
  movieTitle: "",
  movieTags: [],
  timestampMode: "point",
  pointSeconds: null,
  pointFormatted: "",
  rangeStartSeconds: null,
  rangeEndSeconds: null,
  rangeStartFormatted: "",
  rangeEndFormatted: "",
  content: "",
  tags: [],
  savedAt: nowIso()
});

export async function loadDraft() {
  try {
    const data = await localData.get(DRAFT_KEY);
    const d = data?.[DRAFT_KEY];
    if (!d || typeof d !== "object") return null;
    return {
      ...defaultDraft(),
      ...d,
      movieTags: normalizeTagArray(d.movieTags ?? d.movieGenre),
      tags: normalizeTagArray(d.tags)
    };
  } catch (e) {
    console.error("draft load failed", e);
    return null;
  }
}

async function saveDraftUnlocked(draft) {
  try {
    const payload = {
      ...defaultDraft(),
      ...draft,
      savedAt: nowIso()
    };
    await localData.set({ [DRAFT_KEY]: payload });
    return true;
  } catch (e) {
    console.error("draft save failed", e);
    return false;
  }
}

async function clearDraftUnlocked() {
  try {
    await localData.remove(DRAFT_KEY);
    return true;
  } catch (e) {
    return false;
  }
}

/* —— Export Markdown —— */

function formatEntryHeader(it) {
  if (it.timestampType === "range" && it.formattedStart && it.formattedEnd) {
    return `## ⏱ ${it.formattedStart} → ${it.formattedEnd}`;
  }
  if (it.formattedTimestamp) {
    return `## ⏱ ${it.formattedTimestamp}`;
  }
  return "## 无时间戳";
}

function tagsLine(tags) {
  const t = Array.isArray(tags) ? tags.filter(Boolean) : [];
  if (!t.length) return "";
  return t.map((x) => `#${x}`).join(" ");
}

export function exportMovieToMarkdown(note) {
  const n = migrateNote(note);
  const tags = normalizeTagArray(n.tags).slice(0, 8);
  const typeLine = tags.length ? `**标签**：${tags.join(" / ")}` : "**标签**：—";
  const date = n.updatedAt || n.createdAt || "";
  let md = `# ${n.movieTitle || "未命名"}\n`;
  md += `${typeLine}  \n`;
  md += `**记录于**：${date.slice(0, 10)}\n\n`;
  md += `---\n\n`;
  const entries = [...(n.entries || [])].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  for (const it of entries) {
    md += `${formatEntryHeader(it)}\n\n`;
    const body = (it.content || "").trim();
    if (body) md += `${body}\n\n`;
    const tl = tagsLine(it.tags);
    if (tl) md += `${tl}\n\n`;
    md += `---\n\n`;
  }
  return md;
}

export function exportAllToMarkdown(notes) {
  const list = Array.isArray(notes) ? notes.map(migrateNote) : [];
  let md = `# 观影笔记导出\n\n> 共 ${list.length} 部电影\n\n---\n\n`;
  for (const n of list) {
    md += exportMovieToMarkdown(n);
    md += `\n`;
  }
  return md;
}

export function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* —— Notion 集成（仅存 token / 父页面 ID） —— */

const NOTION_KEY = "notionConfig";

export async function loadNotionConfig() {
  try {
    const data = await localData.get(NOTION_KEY);
    const c = data?.[NOTION_KEY];
    if (!c || typeof c !== "object") return { token: "", parentPageId: "" };
    return {
      token: String(c.token || "").trim(),
      parentPageId: String(c.parentPageId || "").trim(),
      parentTitle: String(c.parentTitle || ""),
      verifiedAt: String(c.verifiedAt || "")
    };
  } catch {
    return { token: "", parentPageId: "" };
  }
}

async function saveNotionConfigUnlocked(cfg, expectedOwner) {
  if (expectedOwner != null && await getOwner() !== expectedOwner) throw new Error("账号已切换，请在当前账号重新连接");
  const token = String(cfg?.token || "").trim();
  const parentPageId = String(cfg?.parentPageId || "").trim();
  const value = { token, parentPageId, parentTitle: String(cfg?.parentTitle || ""), verifiedAt: String(cfg?.verifiedAt || "") };
  await localData.set({ [NOTION_KEY]: value });
  return value;
}

export function saveEntry(...args) { return withDataLock(() => saveEntryUnlocked(...args)); }

export function deleteMovie(...args) { return withDataLock(() => deleteMovieUnlocked(...args)); }

export function deleteEntry(...args) { return withDataLock(() => deleteEntryUnlocked(...args)); }

export function updateEntry(...args) { return withDataLock(() => updateEntryUnlocked(...args)); }

export function updateMovie(...args) { return withDataLock(() => updateMovieUnlocked(...args)); }

export function migrateThumbnailsIfNeeded(...args) { return withDataLock(() => migrateThumbnailsIfNeededUnlocked(...args)); }

export function saveDraft(...args) { return withDataLock(() => saveDraftUnlocked(...args)); }

export function clearDraft(...args) { return withDataLock(() => clearDraftUnlocked(...args)); }

export function saveNotionConfig(...args) { return withDataLock(() => saveNotionConfigUnlocked(...args)); }

export function applyRemoteNotes(...args) { return withDataLock(() => applyRemoteNotesUnlocked(...args)); }

export function markNoteSynced(...args) { return withDataLock(() => markNoteSyncedUnlocked(...args)); }
