// Durable changes live in each local note, including deletion tombstones.
import { db, loadSession } from './supabase.js';
import { getOwner, storeForOwner, withDataLock } from './local-data.js';
import { getSyncNotes, applyRemoteNotes, markNoteSynced } from './storage.js';

export async function isLoggedIn() { return Boolean((await loadSession())?.user?.id); }
export async function getPendingIds() {
  return new Set((await getSyncNotes()).filter(n => n.syncDirty !== false).map(n => n.id));
}
export async function markPending(id) {
  return withDataLock(async () => {
    const store = await storeForOwner();
    const notes = (await store.get('movieNotes')).movieNotes || [];
    const note = notes.find(n => n.id === id);
    if (note) { note.syncDirty = true; await store.set({ movieNotes: notes }); }
  });
}
export async function repairUnpushedIfNeeded() { /* Legacy notes are dirty until their first successful push. */ }

async function requireOwner(userId) {
  if (!userId || userId === 'guest' || userId !== await getOwner() || userId !== (await loadSession())?.user?.id) {
    throw new Error('账号已切换或未登录，同步已暂停');
  }
}

function toPayload(note, pictures) {
  return {
    id: note.id, movie_title: note.movieTitle, tags: note.tags || [], video_url: note.videoUrl,
    created_at: note.createdAt, updated_at: note.updatedAt, deleted_at: note.deletedAt || null,
    entries: [
      ...(note.entries || []).map(e => ({
        id: e.id, content: e.content || '', tags: e.tags || [], video_url: e.videoUrl,
        timestamp_type: e.timestampType, timestamp_sec: e.timestamp,
        timestamp_start_sec: e.timestampStart, timestamp_end_sec: e.timestampEnd,
        formatted_timestamp: e.formattedTimestamp, formatted_start: e.formattedStart, formatted_end: e.formattedEnd,
        created_at: e.createdAt, updated_at: e.updatedAt || e.createdAt,
        thumbnail: pictures[e.id] || e.thumbnail || null, deleted_at: null
      })),
      ...Object.entries(note.deletedEntries || {}).map(([id, at]) => ({ id, content: '', created_at: at, updated_at: at, deleted_at: at }))
    ]
  };
}

async function pushOne(id, userId) {
  await requireOwner(userId);
  // Resolve fresh data after acquiring the sync lock; callers may have old UI snapshots.
  const store = await storeForOwner(userId);
  const note = ((await store.get('movieNotes')).movieNotes || []).find(n => n.id === id);
  if (!note) return;
  const keys = (note.entries || []).filter(e => e.hasThumbnail).map(e => `thumb:${e.id}`);
  const thumbs = keys.length ? await store.get(keys) : {};
  const pictures = Object.fromEntries(Object.entries(thumbs).map(([k, v]) => [k.slice(6), v]));
  await db.rpc('aside_sync_movie', { payload: toPayload(note, pictures) }, userId);
  await markNoteSynced(note.id, note.syncRevision, userId);
}

export function pushNote(note, userId) {
  return navigator.locks.request('aside:sync', () => pushOne(note.id, userId));
}
export async function softDeleteMovie(id) {
  const userId = (await loadSession())?.user?.id;
  if (userId) await pushNote({ id }, userId);
}
export async function pushAll(_notes, userId) {
  return navigator.locks.request('aside:sync', async () => {
    await requireOwner(userId);
    const notes = await getSyncNotes();
    for (const note of notes) await pushOne(note.id, userId);
  });
}
export async function flushPending(_notes, userId) {
  return navigator.locks.request('aside:sync', async () => {
    await requireOwner(userId);
    for (const note of await getSyncNotes()) {
      if (note.syncDirty !== false) await pushOne(note.id, userId);
    }
  });
}

// A manual retry must reconcile both directions, including an empty visible
// library whose only remaining local records are deletion tombstones.
export async function synchronize(userId, { forcePush = false } = {}) {
  await requireOwner(userId);
  if (forcePush) await pushAll(null, userId);
  else await flushPending(null, userId);
  await requireOwner(userId);
  await pull();
  await requireOwner(userId);
  return getPendingIds();
}

async function selectAll(table, query, userId) {
  const rows = [];
  // Explicit pagination avoids the server's default row cap; full reconciliation avoids client-clock cursors.
  for (let offset = 0; ; offset += 100) {
    const page = await db.select(table, `${query}&limit=100&offset=${offset}`, userId);
    if (!Array.isArray(page)) throw new Error('云端返回了无效的同步数据');
    rows.push(...page);
    if (page.length < 100) return rows;
  }
}

export async function pull() {
  return navigator.locks.request('aside:sync', async () => {
    const userId = (await loadSession())?.user?.id;
    await requireOwner(userId);
    // Fail clearly on old schemas before any local writes.
    const movies = await selectAll('movies', '?select=*&order=id.asc', userId);
    const store = await storeForOwner(userId);
    const known = (await store.get('syncRemoteRevisions')).syncRemoteRevisions || {};
    const localIds = new Set((await getSyncNotes()).map(n => n.id));
    const nextRevisions = { ...known };
    const notes = [];
    for (const movie of movies) {
      const remoteRevision = movie.sync_updated_at || movie.updated_at;
      if (remoteRevision && known[movie.id] === remoteRevision && localIds.has(movie.id)) continue;
      const rows = movie.deleted_at ? [] : await selectAll('entries', `?select=*&movie_id=eq.${encodeURIComponent(movie.id)}&order=id.asc`, userId);
      if (rows.some(e => !Object.hasOwn(e, 'deleted_at') || !Object.hasOwn(e, 'updated_at'))) throw new Error('云端需要升级同步结构；本地笔记已保留');
      const deletedEntries = Object.fromEntries(rows.filter(e => e.deleted_at).map(e => [e.id, e.deleted_at]));
      nextRevisions[movie.id] = remoteRevision || null;
      notes.push({ id: movie.id, movieTitle: movie.movie_title, tags: movie.tags || [], videoUrl: movie.video_url,
        createdAt: movie.created_at, updatedAt: movie.updated_at, deletedAt: movie.deleted_at, deletedEntries,
        entries: rows.filter(e => !e.deleted_at).map(e => ({
          id: e.id, content: e.content, tags: e.tags || [], videoUrl: e.video_url,
          timestampType: e.timestamp_type, timestamp: e.timestamp_sec, timestampStart: e.timestamp_start_sec, timestampEnd: e.timestamp_end_sec,
          formattedTimestamp: e.formatted_timestamp, formattedStart: e.formatted_start, formattedEnd: e.formatted_end,
          createdAt: e.created_at, updatedAt: e.updated_at, thumbnail: e.thumbnail || null, hasThumbnail: Boolean(e.thumbnail)
        })) });
    }
    await requireOwner(userId);
    const merged = await applyRemoteNotes(notes, userId);
    await store.set({ syncRemoteRevisions: nextRevisions });
    return merged;
  });
}
