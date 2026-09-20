// One lock shared by extension pages and the service worker. Content scripts use messages.
export function withDataLock(fn) {
  return navigator.locks.request('aside:data', fn);
}

const OWNER = 'asideDataOwner';
const OWNED = ['movieNotes', 'draft', 'storageDataVersion', 'syncLastPull', 'syncPending', 'syncRepairV1', 'notionConfig'];

async function initializeOwner() {
  const state = await chrome.storage.local.get([OWNER, 'supabaseSession']);
  if (state[OWNER] != null) return state[OWNER];
  // Initialize before replacing the legacy session; retain legacy keys as a recovery copy.
  const owner = state.supabaseSession?.user?.id || 'guest';
  const old = await chrome.storage.local.get(null);
  const copy = {};
  for (const [key, value] of Object.entries(old)) {
    if (OWNED.includes(key) || key.startsWith('thumb:')) copy[`aside:${owner}:${key}`] = value;
  }
  // Marker and data in one write so interrupted migration is safe to retry.
  await chrome.storage.local.set({ ...copy, [OWNER]: owner });
  return owner;
}

export async function storeForOwner(owner = null) {
  owner ??= await getOwner();
  const prefix = `aside:${owner}:`;
  return {
    owner,
    async get(keys) {
      const list = [].concat(keys);
      const result = await chrome.storage.local.get(list.map(k => prefix + k));
      return Object.fromEntries(list.map(k => [k, result[prefix + k]]));
    },
    async set(values) {
      await chrome.storage.local.set(Object.fromEntries(Object.entries(values).map(([k, v]) => [prefix + k, v])));
    },
    async remove(keys) { await chrome.storage.local.remove([].concat(keys).map(k => prefix + k)); }
  };
}

// Access only from operations protected by withDataLock, or use storeForOwner to pin a snapshot.
export const localData = {
  async get(keys) { return (await storeForOwner()).get(keys); },
  async set(values) { return (await storeForOwner()).set(values); },
  async remove(keys) { return (await storeForOwner()).remove(keys); }
};

export async function activateOwner(owner) {
  const previous = await getOwner();
  if (previous === owner) return;
  // Guest notes stay in the guest library. Never silently upload another library.
  await chrome.storage.local.set({ [OWNER]: owner });
}

export function getOwner() { return navigator.locks.request("aside:owner-init", initializeOwner); }
