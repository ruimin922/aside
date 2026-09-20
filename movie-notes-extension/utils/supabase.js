import { withDataLock, getOwner } from "./local-data.js";
// ═══════════════════════════════════════════════════════════════════════
// Supabase REST client for Chrome Extension (MV3, no SDK dependency)
// 填入你的 Project URL 和 anon key（Supabase 控制台 → Settings → API）
// ═══════════════════════════════════════════════════════════════════════

export const SUPABASE_URL  = "https://nmzzbwsgzkpgkckulgva.supabase.co";
export const SUPABASE_ANON = "sb_publishable_khcKIRvYjYCiQGTE556vMg_q7umR6gc";

const SESSION_KEY = "supabaseSession";

// ── Session 存储 ──────────────────────────────────────────────────────

export async function loadSession() {
  try {
    const data = await chrome.storage.local.get(SESSION_KEY);
    return data?.[SESSION_KEY] ?? null;
  } catch {
    return null;
  }
}

async function saveSession(session, expectedRefreshToken = null) {
  return withDataLock(async () => {
    await getOwner();
    if (expectedRefreshToken && (await loadSession())?.refresh_token !== expectedRefreshToken) return null;
    await chrome.storage.local.set({ [SESSION_KEY]: session, asideDataOwner: session.user.id });
    return session;
  });
}

export async function clearSession() {
  await withDataLock(async () => {
    await getOwner();
    await chrome.storage.local.set({ [SESSION_KEY]: null, asideDataOwner: "guest" });
  });
}

// ── Access token（自动刷新，并发去重）─────────────────────────────────

// 同时有多个请求触发刷新时，共用同一个 in-flight Promise，避免多次 POST
let _refreshInFlight = null;

export async function getAccessToken() {
  const session = await loadSession();
  if (!session?.access_token) return null;

  // token 在 60s 内到期则刷新
  const expiresAtMs = (session.expires_at ?? 0) * 1000;
  if (Date.now() + 60_000 > expiresAtMs && session.refresh_token) {
    const refreshed = await _refreshSession(session.refresh_token);
    return refreshed?.access_token ?? null;
  }
  return session.access_token;
}

function _refreshSession(refreshToken) {
  if (_refreshInFlight) return _refreshInFlight;
  _refreshInFlight = (async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        signal: AbortSignal.timeout(20000),
        headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON },
        body: JSON.stringify({ refresh_token: refreshToken })
      });
      if (!res.ok) throw new Error("登录凭证刷新失败，请重新登录");
      const session = await res.json();
      return await saveSession(session, refreshToken);
    } catch {
      return null;
    } finally {
      _refreshInFlight = null;
    }
  })();
  return _refreshInFlight;
}

// ── PKCE 工具函数 ─────────────────────────────────────────────────────

function _b64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function _genVerifier() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return _b64url(bytes);
}

async function _genChallenge(verifier) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return _b64url(hash);
}

// ── Google 登录（PKCE via Supabase OAuth）────────────────────────────

// Chrome 原始错误 → 用户可读的中文指引（保持单行，toast 容量有限）
function _translateOAuthError(raw) {
  const msg = String(raw || "");
  if (/Authorization page could not be loaded/i.test(msg)) {
    return "无法打开 Google 登录页，请检查网络/代理后重试";
  }
  if (/user.*(did not approve|denied|cancel)|access.?denied|closed by user|user cancelled/i.test(msg)) {
    return "已取消登录";
  }
  if (/timeout|timed out/i.test(msg)) {
    return "登录超时，请重试";
  }
  if (/network|offline|failed to fetch|err_internet/i.test(msg)) {
    return "网络异常，请检查网络后重试";
  }
  if (/redirect|chromiumapp/i.test(msg)) {
    return "回调地址未在 Supabase 中配置，请联系开发者";
  }
  return msg ? `登录失败：${msg}` : "登录失败，请重试";
}

// launchWebAuthFlow 自身没有超时；偶发挂死时给一个上限
const _AUTH_FLOW_TIMEOUT_MS = 120_000;

let _signInInFlight = null;

export function signInWithGoogle() {
  if (_signInInFlight) return _signInInFlight;
  const p = (async () => {
    try {
      const verifier    = _genVerifier();
      const challenge   = await _genChallenge(verifier);
      const redirectUrl = chrome.identity.getRedirectURL();

      const authUrl = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
      authUrl.searchParams.set("provider", "google");
      authUrl.searchParams.set("redirect_to", redirectUrl);
      authUrl.searchParams.set("code_challenge", challenge);
      authUrl.searchParams.set("code_challenge_method", "S256");

      console.log("[auth] redirectUrl =", redirectUrl);
      console.log("[auth] authUrl =", authUrl.toString());

      const callbackUrl = await new Promise((resolve, reject) => {
        let settled = false;
        const tid = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error("timeout"));
        }, _AUTH_FLOW_TIMEOUT_MS);

        try {
          chrome.identity.launchWebAuthFlow(
            { url: authUrl.toString(), interactive: true },
            (url) => {
              if (settled) return;
              settled = true;
              clearTimeout(tid);
              const err = chrome.runtime.lastError?.message;
              // Never log OAuth callback codes.
              if (err) reject(new Error(err));
              else if (!url) reject(new Error("user cancelled"));
              else resolve(url);
            }
          );
        } catch (e) {
          if (settled) return;
          settled = true;
          clearTimeout(tid);
          reject(e);
        }
      });

      const code = new URL(callbackUrl).searchParams.get("code");
      if (!code) throw new Error("未收到授权码，请重试");

      const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
        method: "POST",
        signal: AbortSignal.timeout(20000),
        headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON },
        body: JSON.stringify({ auth_code: code, code_verifier: verifier })
      });
      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        throw new Error(err.error_description || err.msg || "凭证交换失败");
      }
      const session = await tokenRes.json();
      await saveSession(session);
      return session;
    } catch (e) {
      throw new Error(_translateOAuthError(e?.message ?? e));
    } finally {
      _signInInFlight = null;
    }
  })();
  _signInInFlight = p;
  return p;
}

export async function signOut() {
  const token = await getAccessToken();
  if (token) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
        signal: AbortSignal.timeout(20000),
      headers: { "Authorization": `Bearer ${token}`, "apikey": SUPABASE_ANON }
    }).catch(() => {});
  }
  await clearSession();
}

export async function getUser() {
  const token = await getAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { "Authorization": `Bearer ${token}`, "apikey": SUPABASE_ANON }
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ── REST DB 封装 ──────────────────────────────────────────────────────

async function _dbFetch(path, options = {}, expectedUserId = null) {
  const token = await getAccessToken();
  if (!token) throw new Error("未登录");
  if (expectedUserId && (await loadSession())?.user?.id !== expectedUserId) throw new Error("账号已切换，同步已暂停");
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    signal: AbortSignal.timeout(20000),
    headers: {
      "Authorization": `Bearer ${token}`,
      "apikey": SUPABASE_ANON,
      "Content-Type": "application/json",
      ...options.headers
    }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (["PGRST202", "PGRST204", "42703"].includes(err.code)) throw new Error("云端需要升级同步结构；本地笔记已保留，请执行 002-reliable-sync.sql");
    throw new Error(err.message || err.error_description || `DB error ${res.status}`);
  }
  // return=minimal 会返回 201 + 空 body，res.json() 会在空 body 上抛错
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export const db = {
  select: (table, query = "", userId = null) =>
    _dbFetch(`/${table}${query}`, {}, userId),

  rpc: (name, body, userId) => _dbFetch(`/rpc/${name}`, { method: "POST", body: JSON.stringify(body) }, userId),

  upsert: (table, data) =>
    _dbFetch(`/${table}`, {
      method: "POST",
        signal: AbortSignal.timeout(20000),
      headers: { "Prefer": "return=minimal,resolution=merge-duplicates" },
      body: JSON.stringify(data)
    }),

  patch: (table, query, data) =>
    _dbFetch(`/${table}${query}`, {
      method: "PATCH",
      headers: { "Prefer": "return=minimal" },
      body: JSON.stringify(data)
    }),

  delete: (table, query) =>
    _dbFetch(`/${table}${query}`, { method: "DELETE" })
};
