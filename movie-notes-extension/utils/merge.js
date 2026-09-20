const time = value => Date.parse(value || '') || 0;
export const revision = item => item?.updatedAt || item?.createdAt || '';
// Item-level last-write-wins; deletion wins ties. Preserve local-only entries and pictures.
export function mergeNote(local, remote) {
  if (!local) return remote;
  const winner = time(revision(remote)) >= time(revision(local)) ? remote : local;
  const entries = new Map((local.entries || []).map(e => [e.id, e]));
  const deleted = { ...(local.deletedEntries || {}) };
  for (const [id, stamp] of Object.entries(remote.deletedEntries || {})) {
    if (time(stamp) >= time(deleted[id])) deleted[id] = stamp;
  }
  for (const incoming of remote.entries || []) {
    const old = entries.get(incoming.id);
    if (!old || time(revision(incoming)) > time(revision(old))) {
      entries.set(incoming.id, { ...incoming, thumbnail: incoming.thumbnail || old?.thumbnail || null, hasThumbnail: incoming.hasThumbnail || old?.hasThumbnail || false });
    } else if (incoming.thumbnail && !old.thumbnail && !old.hasThumbnail) {
      entries.set(incoming.id, { ...old, thumbnail: incoming.thumbnail, hasThumbnail: true });
    }
  }
  // No implicit resurrection. A deliberate new note receives a new UUID.
  for (const id of Object.keys(deleted)) entries.delete(id);
  return { ...winner, entries: [...entries.values()], deletedEntries: deleted,
    // Movie deletion is terminal; restoring requires an explicit new record.
    deletedAt: local.deletedAt || remote.deletedAt || null };
}
