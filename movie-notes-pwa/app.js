// ═══════════════════════════════════════════════════════════════════════
// 观影笔记 PWA — 只读查看端
// ═══════════════════════════════════════════════════════════════════════

const SUPABASE_URL  = "https://nmzzbwsgzkpgkckulgva.supabase.co";
const SUPABASE_ANON = "sb_publishable_khcKIRvYjYCiQGTE556vMg_q7umR6gc";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true
  }
});

// ── State ─────────────────────────────────────────────────────────────

let currentUser     = null;
let sessionChecked  = false;
let allMovies       = [];
let searchQuery     = "";
let sortMode        = "updated"; // updated | created | notes
let moviesLoaded    = false;
let moviesLoading   = false;
let moviesError     = null;
let lastView        = "list";
let booted          = false;
let voluntarySignOut = false;

// 笔记数（「笔记最多」排序用，后台异步加载）
let entryCountsLoaded  = false;
let entryCountsLoading = false;

// 条目内容搜索（服务端 ilike，防抖后触发）
let entryMatchSet   = null; // Set<movieId> | null
let entryMatchQuery = "";
let entrySearchSeq  = 0;
let searchDebounceTid = null;

// Detail view 状态
let currentMovieId      = null;
let currentMovie        = null;
let currentEntries      = [];
let entrySearchQuery    = "";

// ── Cache (stale-while-revalidate) ────────────────────────────────────

const CACHE_VERSION = 2;

function cacheKey(kind, id) {
  const uid = currentUser?.id || "anon";
  return `mn:v${CACHE_VERSION}:${uid}:${kind}${id ? ":" + id : ""}`;
}

function readCache(kind, id) {
  try {
    const raw = localStorage.getItem(cacheKey(kind, id));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function writeCache(kind, id, value) {
  try {
    localStorage.setItem(cacheKey(kind, id), JSON.stringify(value));
  } catch {
    // 配额满：清掉本 user 的 entries 缓存再试一次
    try {
      const prefix = cacheKey("entries", "").slice(0, -1);
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) localStorage.removeItem(k);
      }
      localStorage.setItem(cacheKey(kind, id), JSON.stringify(value));
    } catch {}
  }
}

function clearUserCache() {
  try {
    const uid = currentUser?.id;
    if (!uid) return;
    const prefix = `mn:v${CACHE_VERSION}:${uid}:`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) localStorage.removeItem(k);
    }
  } catch {}
}

// 跳回视频用
const SVG_JUMP = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M9 7h8v8"/></svg>`;

// ── Helpers ───────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }

function showToast(text, duration = 2500) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(el._tid);
  el._tid = setTimeout(() => { el.hidden = true; }, duration);
}

function showLoadingOverlay(text) {
  const el = $("loadingOverlay");
  $("loadingOverlayText").textContent = text || "加载中…";
  el.hidden = false;
}
function hideLoadingOverlay() {
  $("loadingOverlay").hidden = true;
}

function setSyncDot(state, text) {
  const dot  = $("syncDot");
  const lbl  = $("accountStatusText");
  if (!dot || !lbl) return;
  dot.setAttribute("data-state", state);
  lbl.textContent = text || "";
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7)  return `${days} 天前`;
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function formatTimestamp(entry) {
  if (entry.timestamp_type === "range" && entry.formatted_start && entry.formatted_end) {
    return `${entry.formatted_start} → ${entry.formatted_end}`;
  }
  if (entry.formatted_timestamp) return entry.formatted_timestamp;
  if (entry.timestamp_sec != null) {
    const t = Math.floor(entry.timestamp_sec);
    const s = t % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
    const p = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
  }
  return null;
}

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function openVideo(url) {
  if (!url) return;
  // 仅允许 http/https，避免 javascript: 之类的 URL
  if (!/^https?:\/\//i.test(url)) { showToast("视频地址无效"); return; }
  window.open(url, "_blank", "noopener,noreferrer");
}

function timestampedUrl(value, seconds) {
  if (!value) return '';
  try {
    const u = new URL(value);
    if (!['https:', 'http:'].includes(u.protocol)) return '';
    const host = u.hostname;
    if (seconds != null && Number.isFinite(seconds) && ['youtube.com', 'youtu.be', 'bilibili.com'].some(h => host === h || host.endsWith('.' + h))) {
      u.searchParams.set('t', String(Math.max(0, Math.floor(seconds))));
    }
    return u.toString();
  } catch { return ''; }
}

async function shareCurrentMovie() {
  if (!currentMovie) return;
  const title = currentMovie.movie_title || "观影笔记";
  const url = window.location.href;
  const text = `《${title}》— 观影笔记`;

  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    showToast("链接已复制");
  } catch {
    showToast("无法分享：请手动复制地址栏链接");
  }
}

function applyTagFilter(tag) {
  searchQuery = tag;
  const input = $("searchInput");
  if (input) input.value = tag;
  resetEntryMatches();
  if (location.hash) {
    location.hash = ""; // 触发 route() 回到列表
  } else {
    renderList();
  }
}

// ── Auth ──────────────────────────────────────────────────────────────

async function signIn() {
  try {
    $("btnSignIn").disabled = true;
    $("btnSignInLabel").textContent = "跳转中…";
    showLoadingOverlay("正在跳转到 Google…");
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + window.location.pathname,
        skipBrowserRedirect: false
      }
    });
    if (error) throw error;
    setTimeout(() => {
      $("btnSignIn").disabled = false;
      $("btnSignInLabel").textContent = "使用 Google 账号登录";
      hideLoadingOverlay();
    }, 4000);
  } catch (err) {
    $("btnSignIn").disabled = false;
    $("btnSignInLabel").textContent = "使用 Google 账号登录";
    hideLoadingOverlay();
    showToast("登录失败：" + (err?.message || "未知错误"));
  }
}

async function signOut() {
  try {
    voluntarySignOut = true;
    showLoadingOverlay("退出中…");
    clearUserCache();
    await sb.auth.signOut();
    currentUser = null;
    allMovies = [];
    moviesLoaded = false;
    moviesError = null;
    entryCountsLoaded = false;
    entryCountsLoading = false;
    currentEntries = [];
    currentMovieId = null;
    currentMovie = null;
    hideLoadingOverlay();
    showToast("已退出登录");
    location.hash = "";
    showView("list");
    renderAccount();
    renderList();
  } catch (err) {
    hideLoadingOverlay();
    showToast("退出失败：" + (err?.message || "未知错误"));
  }
}

// ── Data ──────────────────────────────────────────────────────────────

function withTimeout(promise, ms, label = "请求") {
  return new Promise((resolve, reject) => {
    const tid = setTimeout(() => reject(new Error(`${label}超时`)), ms);
    promise.then(
      (v) => { clearTimeout(tid); resolve(v); },
      (e) => { clearTimeout(tid); reject(e); }
    );
  });
}

async function fetchAllRows(makeQuery) {
  const owner = currentUser?.id;
  if (!owner) throw new Error("未登录");
  const rows = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await withTimeout(makeQuery().eq('user_id', owner).range(offset, offset + 99), 15000, '加载');
    if (currentUser?.id !== owner) throw new Error('账号已切换');
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 100) return rows;
  }
}

async function fetchMovies() {
  return fetchAllRows(() => sb.from("movies")
    .select("id, movie_title, tags, video_url, created_at, updated_at")
    .is("deleted_at", null).order("id", { ascending: true }));
}

// 后台拉一次所有 entries.movie_id，本地聚合为每部电影的笔记数
async function loadEntryCounts() {
  if (!currentUser || entryCountsLoaded || entryCountsLoading) return;
  entryCountsLoading = true;
  try {
    const data = await fetchAllRows(() => sb.from("entries").select("id,movie_id").is("deleted_at", null).order("id", { ascending: true }));
    const counts = Object.create(null);
    for (const r of (data || [])) {
      counts[r.movie_id] = (counts[r.movie_id] || 0) + 1;
    }
    for (const m of allMovies) m.entry_count = counts[m.id] || 0;
    entryCountsLoaded = true;
    writeCache("counts", null, counts);
    if (sortMode === "notes") renderList();
  } catch {
    // 失败就让「笔记最多」回退按更新时间排（sortMovies 里已处理 0）
  } finally {
    entryCountsLoading = false;
  }
}

function applyCachedCounts() {
  const counts = readCache("counts", null);
  if (!counts) return false;
  for (const m of allMovies) m.entry_count = counts[m.id] || 0;
  return true;
}

async function fetchEntries(movieId) {
  return fetchAllRows(() => sb.from("entries")
    .select("id, video_url, thumbnail, timestamp_type, timestamp_sec, timestamp_start_sec, timestamp_end_sec, formatted_timestamp, formatted_start, formatted_end, content, tags, created_at, updated_at")
    .eq("movie_id", movieId).is("deleted_at", null).order("created_at", { ascending: true }).order("id", { ascending: true }));
}

function readCachedEntries(movieId) { return readCache("entries", movieId); }
function writeCachedEntries(movieId, entries) { writeCache("entries", movieId, entries); }

async function runEntryContentSearch(q) {
  q = (q || "").trim();
  if (!currentUser || q.length < 2) return;
  if (entryMatchQuery === q && entryMatchSet) return;
  const seq = ++entrySearchSeq;
  try {
    // ilike 的 %/_ 需转义，避免把用户输入当成通配符
    const safe = q.replace(/([\\%_])/g, "\\$1");
    const { data, error } = await withTimeout(
      sb.from("entries").select("movie_id").eq("user_id", currentUser.id).is("deleted_at", null).ilike("content", `%${safe}%`).limit(500),
      10000,
      "搜索"
    );
    if (error) throw error;
    if (seq !== entrySearchSeq) return; // 被新一次搜索取代
    entryMatchSet = new Set((data || []).map((r) => r.movie_id));
    entryMatchQuery = q;
    if (lastView === "list") renderList();
  } catch {
    // 网络错误就静默，本地过滤仍然生效
  }
}

function resetEntryMatches() {
  entryMatchSet = null;
  entryMatchQuery = "";
  entrySearchSeq++;
}

async function ensureMoviesLoaded({ silent = false, force = false } = {}) {
  if (!currentUser) return;
  if (moviesLoading) return;
  if (moviesLoaded && !force) return;

  const loadingOwner = currentUser.id;
  moviesLoading = true;
  moviesError = null;

  // 1) 先用本地缓存立刻渲染（stale-while-revalidate）
  let hadCache = false;
  if (!allMovies.length) {
    const cached = readCache("movies", null);
    if (cached?.length) {
      allMovies = cached;
      applyCachedCounts();
      hadCache = true;
      renderList();
    }
  }

  if (!silent && !hadCache && !allMovies.length) {
    $("movieList").innerHTML = `<div class="skeleton-list"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div>`;
  }
  setSyncDot("syncing", "同步中");

  try {
    const fresh = await fetchMovies();
    if (currentUser?.id !== loadingOwner) return;
    // 保留已有 entry_count（刷新期间不丢）
    const prevCounts = Object.create(null);
    for (const m of allMovies) if (m.entry_count != null) prevCounts[m.id] = m.entry_count;
    for (const m of fresh) if (prevCounts[m.id] != null) m.entry_count = prevCounts[m.id];
    allMovies = fresh;
    moviesLoaded = true;
    writeCache("movies", null, fresh);
    setSyncDot("ok", "已同步");
    // 后台补齐笔记数（不阻塞）
    loadEntryCounts();
  } catch (err) {
    if (currentUser?.id !== loadingOwner) return;
    moviesError = err?.message || "网络错误";
    setSyncDot("error", hadCache ? "同步失败（显示缓存）" : "同步失败");
  } finally {
    if (currentUser?.id === loadingOwner) moviesLoading = false;
  }
}

// ── View: List ────────────────────────────────────────────────────────

function renderTagChips() {
  const wrap = $("tagChips");
  if (!wrap) return;
  if (!currentUser || !allMovies.length) {
    wrap.hidden = true;
    wrap.innerHTML = "";
    return;
  }
  const counts = new Map();
  for (const m of allMovies) {
    for (const t of (m.tags || [])) counts.set(t, (counts.get(t) || 0) + 1);
  }
  if (!counts.size) {
    wrap.hidden = true;
    wrap.innerHTML = "";
    return;
  }
  wrap.hidden = false;
  const current = searchQuery.trim();
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  wrap.innerHTML = sorted.map(([tag, n]) => {
    const active = tag === current;
    return `<button type="button" class="tag-chip${active ? " is-active" : ""}" data-tag="${escHtml(tag)}">${escHtml(tag)}<span class="tag-chip__count">${n}</span></button>`;
  }).join("");
}

function sortMovies(list, mode) {
  const arr = list.slice();
  const ts = (v) => (v ? new Date(v).getTime() : 0);
  if (mode === "created") {
    arr.sort((a, b) => ts(b.created_at) - ts(a.created_at));
  } else if (mode === "notes") {
    arr.sort((a, b) => {
      const diff = (b.entry_count || 0) - (a.entry_count || 0);
      return diff !== 0 ? diff : ts(b.updated_at) - ts(a.updated_at);
    });
  } else {
    arr.sort((a, b) => ts(b.updated_at) - ts(a.updated_at));
  }
  return arr;
}

function renderList() {
  renderTagChips();

  // 会话还没检查完，不要先显示「去登录」CTA，避免已登录用户看到闪烁
  if (!sessionChecked) {
    $("listStats").textContent = "";
    $("movieList").innerHTML = `<div class="skeleton-list"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div>`;
    return;
  }

  if (!currentUser) {
    $("listStats").textContent = "";
    $("movieList").innerHTML = `
      <div class="empty-state empty-state--cta">
        <div class="empty-state__emoji">🎬</div>
        <div class="empty-state__title">登录查看你的笔记</div>
        <div class="empty-state__desc">在 Chrome 扩展里记录的观影迷思，会在登录后同步到这里</div>
        <button class="btn-primary" id="emptyGoSettings">去登录</button>
      </div>
    `;
    const btn = $("emptyGoSettings");
    if (btn) btn.onclick = () => showView("settings");
    return;
  }

  if (moviesLoading && !allMovies.length) {
    $("movieList").innerHTML = `<div class="skeleton-list"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div>`;
    $("listStats").textContent = "";
    return;
  }

  if (moviesError && !allMovies.length) {
    $("listStats").textContent = "";
    $("movieList").innerHTML = `
      <div class="empty-state empty-state--cta">
        <div class="empty-state__emoji">⚠️</div>
        <div class="empty-state__title">加载失败</div>
        <div class="empty-state__desc">${escHtml(moviesError)}</div>
        <button class="btn-primary" id="retryLoad">重试</button>
      </div>
    `;
    const btn = $("retryLoad");
    if (btn) btn.onclick = async () => {
      await ensureMoviesLoaded({ silent: true, force: true });
      renderList();
    };
    return;
  }

  const rawQ = searchQuery.trim();
  const query = rawQ.toLowerCase();
  const entryHit = (m) =>
    entryMatchSet && entryMatchQuery === rawQ && entryMatchSet.has(m.id);
  const base = query
    ? allMovies.filter((m) =>
        (m.movie_title || "").toLowerCase().includes(query) ||
        (m.tags || []).some((t) => t.toLowerCase().includes(query)) ||
        entryHit(m)
      )
    : allMovies;

  const filtered = sortMovies(base, sortMode);

  $("listStats").textContent = allMovies.length
    ? (filtered.length === allMovies.length ? `共 ${allMovies.length} 部` : `${filtered.length} / ${allMovies.length} 部`)
    : "";

  if (!filtered.length) {
    $("movieList").innerHTML = `<div class="empty-state">${query ? "没有匹配的电影" : "还没有笔记，去 Chrome 扩展记一条吧"}</div>`;
    return;
  }

  $("movieList").innerHTML = filtered.map((m) => {
    const tags = (m.tags || []).map((t) =>
      `<button type="button" class="tag" data-tag="${escHtml(t)}">${escHtml(t)}</button>`
    ).join("");
    const jump = m.video_url
      ? `<button type="button" class="card-jump" data-url="${escHtml(m.video_url)}" aria-label="打开视频">${SVG_JUMP}<span>视频</span></button>`
      : "";
    return `
      <div class="movie-card" data-id="${escHtml(m.id)}">
        <div class="movie-card__title">${escHtml(m.movie_title)}</div>
        ${tags ? `<div class="movie-card__tags">${tags}</div>` : ""}
        <div class="movie-card__footer">
          <span class="movie-card__meta">${formatDate(m.updated_at)}</span>
          ${jump}
        </div>
      </div>
    `;
  }).join("");

  $("movieList").querySelectorAll(".movie-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      const tagBtn = e.target.closest(".tag");
      if (tagBtn) { e.stopPropagation(); applyTagFilter(tagBtn.dataset.tag); return; }
      const jumpBtn = e.target.closest(".card-jump");
      if (jumpBtn) { e.stopPropagation(); openVideo(jumpBtn.dataset.url); return; }
      location.hash = `movie/${card.dataset.id}`;
    });
  });
}

// ── View: Detail ──────────────────────────────────────────────────────

async function renderDetail(movieId) {
  const movie = allMovies.find((m) => m.id === movieId);
  if (!movie) { location.hash = ""; return; }

  const detailOwner = currentUser?.id;
  currentMovieId   = movieId;
  currentMovie     = movie;
  currentEntries   = [];
  entrySearchQuery = "";

  $("detailTitle").textContent = movie.movie_title || "未命名";

  // 顶栏视频按钮
  const videoBtn = $("btnDetailVideo");
  if (videoBtn) {
    videoBtn.hidden = !movie.video_url;
    videoBtn.onclick = () => openVideo(movie.video_url);
  }

  // 电影标签（可点击 → 回列表筛选）
  const tags = (movie.tags || []).map((t) =>
    `<button type="button" class="tag" data-tag="${escHtml(t)}">${escHtml(t)}</button>`
  ).join("");
  $("detailMeta").innerHTML = tags || "";

  // 重置 stats / search
  const statsWrap = $("detailStatsWrap");
  if (statsWrap) statsWrap.hidden = true;
  const entrySearch = $("entrySearch");
  if (entrySearch) entrySearch.value = "";

  // 先用本地缓存立刻渲染
  const cached = readCachedEntries(movieId);
  if (cached?.length) {
    currentEntries = cached;
    renderEntries();
  } else {
    $("entryList").innerHTML = `<div class="skeleton-list"><div class="skeleton-entry"></div><div class="skeleton-entry"></div></div>`;
  }

  try {
    const fresh = await fetchEntries(movieId);
    // 若在等待期间用户已切换到另一部电影，丢弃本次结果
    if (currentMovieId !== movieId || currentUser?.id !== detailOwner) return;
    currentEntries = fresh;
    writeCachedEntries(movieId, fresh);
    renderEntries();
  } catch (err) {
    if (currentMovieId !== movieId || currentUser?.id !== detailOwner) return;
    if (!cached?.length) {
      $("entryList").innerHTML = `<div class="empty-state error">加载失败：${escHtml(err?.message || "未知错误")}</div>`;
    }
    // 有缓存就继续显示缓存，不覆盖
  }
}

function renderEntries() {
  const list      = $("entryList");
  const statsWrap = $("detailStatsWrap");
  const stats     = $("detailStats");

  if (!currentEntries.length) {
    if (statsWrap) statsWrap.hidden = true;
    list.innerHTML = `<div class="empty-state">这部电影还没有笔记条目</div>`;
    return;
  }

  // stats / search 行（只要有条目就显示，便于看到总数）
  if (statsWrap) statsWrap.hidden = false;

  const q = entrySearchQuery.trim().toLowerCase();
  const filtered = q
    ? currentEntries.filter((e) =>
        (e.content || "").toLowerCase().includes(q) ||
        (e.tags || []).some((t) => t.toLowerCase().includes(q)) ||
        (formatTimestamp(e) || "").toLowerCase().includes(q)
      )
    : currentEntries;

  if (stats) {
    stats.textContent = filtered.length === currentEntries.length
      ? `${currentEntries.length} 条笔记`
      : `${filtered.length} / ${currentEntries.length} 条`;
  }

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">没有匹配的条目</div>`;
    return;
  }

  list.innerHTML = filtered.map((e) => {
    const ts = formatTimestamp(e);
    const entryTags = (e.tags || []).map((t) =>
      `<button type="button" class="tag tag--sm" data-tag="${escHtml(t)}">${escHtml(t)}</button>`
    ).join("");
    const jumpUrl = timestampedUrl(e.video_url || currentMovie?.video_url, e.timestamp_start_sec ?? e.timestamp_sec);
    const preview = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(e.thumbnail || '')
      ? `<img class="entry-preview" src="${escHtml(e.thumbnail)}" alt="视频截图" loading="lazy">` : '';
    const jump = jumpUrl
      ? `<button type="button" class="entry-jump" data-url="${escHtml(jumpUrl)}" aria-label="跳到视频">${SVG_JUMP}<span>跳到视频</span></button>`
      : "";
    const top = (ts || jump)
      ? `<div class="entry-card__top">${ts ? `<span class="entry-card__ts">◷ ${escHtml(ts)}</span>` : "<span></span>"}${jump}</div>`
      : "";
    return `
      <div class="entry-card">
        ${top}
        ${preview}
        <div class="entry-card__content">${escHtml(e.content)}</div>
        ${entryTags ? `<div class="entry-card__tags">${entryTags}</div>` : ""}
        <div class="entry-card__date">${formatDate(e.created_at)}</div>
      </div>
    `;
  }).join("");
}

// ── View: Settings ────────────────────────────────────────────────────

function renderAccount() {
  const guest = $("accountGuest");
  const user  = $("accountUser");

  if (!currentUser) {
    guest.hidden = false;
    user.hidden  = true;
    setSyncDot("hidden", "未登录");
    return;
  }

  guest.hidden = true;
  user.hidden  = false;
  $("accountEmail").textContent = currentUser.email || "";

  const av = $("accountAvatar");
  if (currentUser.user_metadata?.avatar_url) {
    av.src = currentUser.user_metadata.avatar_url;
    av.hidden = false;
  } else {
    av.hidden = true;
  }

  // 如果数据已经加载好，就显示「已同步」；否则保持当前状态（syncing 由 ensureMoviesLoaded 设置）
  if (moviesLoaded) setSyncDot("ok", "已同步");
}

// ── Routing ───────────────────────────────────────────────────────────

let listScrollY = 0;

function showView(name) {
  // 离开列表前记住滚动位置
  if (lastView === "list" && name !== "list") {
    listScrollY = window.scrollY || 0;
  }
  document.querySelectorAll("[data-view]").forEach((el) => { el.hidden = true; });
  const el = document.querySelector(`[data-view="${name}"]`);
  if (el) el.hidden = false;
  const prev = lastView;
  lastView = name;

  if (name === "list" && prev !== "list" && listScrollY > 0) {
    // 回列表：等 DOM hidden 属性生效后再恢复
    const y = listScrollY;
    requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "instant" }));
  } else {
    window.scrollTo({ top: 0, behavior: "instant" });
  }
}

async function route() {
  const hash = location.hash.replace(/^#/, "");

  if (hash === "settings") {
    showView("settings");
    renderAccount();
    return;
  }

  if (hash.startsWith("movie/")) {
    if (!currentUser) { location.hash = ""; return; }
    const movieId = hash.slice(6);
    await ensureMoviesLoaded({ silent: true });
    showView("detail");
    await renderDetail(movieId);
    return;
  }

  // 默认：列表
  showView("list");
  await ensureMoviesLoaded();
  renderList();
}

window.addEventListener("hashchange", route);

// ── Pull-to-refresh ───────────────────────────────────────────────────

function setupPullToRefresh() {
  const indicator = $("ptrIndicator");
  if (!indicator) return;

  const THRESHOLD = 70;
  let startY = 0;
  let pulling = false;
  let armed = false;

  function canPull() {
    // 只有列表页 + 已登录 + 滚到顶 + 无搜索
    if (lastView !== "list") return false;
    if (!currentUser) return false;
    if (window.scrollY > 0) return false;
    return true;
  }

  window.addEventListener("touchstart", (e) => {
    if (!canPull()) { armed = false; return; }
    armed = true;
    startY = e.touches[0].clientY;
    pulling = false;
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    if (!armed) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 10) {
      pulling = true;
      const progress = Math.min(dy / THRESHOLD, 1.2);
      indicator.style.opacity = String(Math.min(progress, 1));
      indicator.style.transform = `translateY(${Math.min(dy * 0.5, 48) - 40}px) scale(${0.8 + progress * 0.2})`;
    }
  }, { passive: true });

  window.addEventListener("touchend", async (e) => {
    if (!armed) return;
    armed = false;
    if (!pulling) return;
    const dy = (e.changedTouches[0]?.clientY ?? 0) - startY;
    pulling = false;

    if (dy >= THRESHOLD && canPull()) {
      indicator.classList.add("is-refreshing");
      indicator.style.cssText = "";
      try {
        moviesLoaded = false;
        moviesError = null;
        await ensureMoviesLoaded({ silent: true, force: true });
        renderList();
        if (!moviesError) showToast("已刷新");
      } finally {
        indicator.classList.remove("is-refreshing");
      }
    } else {
      // 未达阈值，回弹
      indicator.style.cssText = "";
    }
  }, { passive: true });

  window.addEventListener("touchcancel", () => {
    armed = false;
    pulling = false;
    indicator.classList.remove("is-refreshing");
    indicator.style.cssText = "";
  });
}

// ── Offline indicator ─────────────────────────────────────────────────

function setupOfflineIndicator() {
  const banner = $("offlineBanner");
  if (!banner) return;
  const update = () => {
    banner.hidden = navigator.onLine !== false ? true : false;
  };
  window.addEventListener("online", async () => {
    update();
    if (currentUser) {
      moviesLoaded = false;
      await ensureMoviesLoaded({ silent: true, force: true });
      renderList();
    }
  });
  window.addEventListener("offline", update);
  update();
}

// ── Init ──────────────────────────────────────────────────────────────

async function init() {
  showView("list");
  // 先用「未登录」空态填充列表，避免 getSession 慢时骨架一直转
  renderList();
  renderAccount();

  $("btnSettings").onclick     = () => { location.hash = "settings"; };
  $("btnSettingsBack").onclick = () => { location.hash = ""; };
  $("btnBack").onclick         = () => { location.hash = ""; };
  $("btnDetailShare").onclick  = shareCurrentMovie;
  $("btnSignIn").onclick       = signIn;
  $("btnSignOut").onclick      = signOut;

  $("searchInput").addEventListener("input", (e) => {
    searchQuery = e.target.value;
    renderList();
    clearTimeout(searchDebounceTid);
    const q = searchQuery.trim();
    if (q.length < 2) {
      resetEntryMatches();
      return;
    }
    searchDebounceTid = setTimeout(() => runEntryContentSearch(q), 250);
  });

  // 标签筛选 chips
  $("tagChips")?.addEventListener("click", (e) => {
    const chip = e.target.closest(".tag-chip");
    if (!chip) return;
    const tag = chip.dataset.tag || "";
    const active = chip.classList.contains("is-active");
    searchQuery = active ? "" : tag;
    const input = $("searchInput");
    if (input) input.value = searchQuery;
    resetEntryMatches();
    renderList();
  });

  // 排序 chips
  $("sortChips")?.addEventListener("click", (e) => {
    const chip = e.target.closest(".sort-chip");
    if (!chip || !chip.dataset.sort) return;
    if (chip.dataset.sort === sortMode) return;
    sortMode = chip.dataset.sort;
    document.querySelectorAll("#sortChips .sort-chip").forEach((c) => {
      const active = c.dataset.sort === sortMode;
      c.classList.toggle("is-active", active);
      c.setAttribute("aria-selected", active ? "true" : "false");
    });
    renderList();
  });

  // 详情页：条目内搜索
  const entrySearch = $("entrySearch");
  if (entrySearch) {
    entrySearch.addEventListener("input", (e) => {
      entrySearchQuery = e.target.value;
      renderEntries();
    });
  }


  // 详情页：标签点击 → 回列表筛选；entry-jump → 打开视频
  document.querySelector('[data-view="detail"]')?.addEventListener("click", (e) => {
    const tagBtn = e.target.closest(".tag");
    if (tagBtn && tagBtn.dataset.tag) { applyTagFilter(tagBtn.dataset.tag); return; }
    const jumpBtn = e.target.closest(".entry-jump");
    if (jumpBtn) { openVideo(jumpBtn.dataset.url); return; }
  });

  setupPullToRefresh();
  setupOfflineIndicator();

  // 识别 OAuth 回调：PKCE 走 ?code=...，implicit 走 #access_token=...
  const rawHash   = window.location.hash || "";
  const rawSearch = window.location.search || "";
  const isOAuthReturn =
    /access_token=|error_description=|error=/.test(rawHash) ||
    /[?&]code=/.test(rawSearch);

  if (isOAuthReturn) {
    showLoadingOverlay("登录中…");
  }

  const forceHideTimer = setTimeout(() => hideLoadingOverlay(), 3000);

  // 订阅 auth 状态变化（for 登录 / 登出后的运行期）
  sb.auth.onAuthStateChange(async (event, session) => {
    const prevUser = currentUser;
    currentUser = session?.user ?? null;
    sessionChecked = true;

    if (prevUser?.id !== currentUser?.id) {
      currentMovieId = null;
      currentMovie = null;
      currentEntries = [];
      moviesLoading = false;
      resetEntryMatches();
      $("entryList").innerHTML = "";
    }
    renderAccount();

    if (currentUser && (!prevUser || prevUser.id !== currentUser.id)) {
      moviesLoaded = false;
      moviesError = null;
      entryCountsLoaded = false;
      entryCountsLoading = false;
      allMovies = [];
      await ensureMoviesLoaded({ silent: true });
    }

    if (!currentUser && prevUser) {
      allMovies = [];
      moviesLoaded = false;
      moviesError = null;
      entryCountsLoaded = false;
      entryCountsLoading = false;
    }

    if (booted) {
      if (event === "SIGNED_IN") {
        showToast(`欢迎，${currentUser?.email || "已登录"}`);
        // Task A：登录成功后自动回到列表
        location.hash = "";
      } else if (event === "SIGNED_OUT" && !voluntarySignOut) {
        // Task D：非主动登出（token 过期 / 被吊销）
        showToast("登录已过期，请重新登录");
        location.hash = "settings";
      }
      voluntarySignOut = false;
      await route();
    }
  });

  try {
    const prevUser = currentUser;
    const { data: { session } } = await sb.auth.getSession();
    currentUser = session?.user ?? null;
    sessionChecked = true;
    if (prevUser?.id !== currentUser?.id) {
      currentMovieId = null;
      currentMovie = null;
      currentEntries = [];
      moviesLoading = false;
      resetEntryMatches();
      $("entryList").innerHTML = "";
    }
    renderAccount();

    if (currentUser) {
      await ensureMoviesLoaded({ silent: true });
    }

    if (isOAuthReturn) {
      history.replaceState(null, "", window.location.pathname);
      if (currentUser) {
        showToast(`欢迎，${currentUser.email || "已登录"}`);
      } else {
        showToast("登录未完成，请重试");
      }
    }

    await route();
  } catch (err) {
    console.error("[init] failed:", err);
    sessionChecked = true;
    showToast("初始化失败：" + (err?.message || "未知错误"));
    await route().catch(() => {});
  } finally {
    clearTimeout(forceHideTimer);
    hideLoadingOverlay();
    booted = true;
  }
}

document.addEventListener("DOMContentLoaded", init);

// ── Service Worker ────────────────────────────────────────────────────

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js")
    .then((reg) => {
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      reg.addEventListener("updatefound", () => {
        const newSw = reg.installing;
        if (!newSw) return;
        newSw.addEventListener("statechange", () => {
          if (newSw.state === "installed" && navigator.serviceWorker.controller) {
            newSw.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
    })
    .catch(() => {});

  let _reloadedForSw = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (_reloadedForSw) return;
    _reloadedForSw = true;
    window.location.reload();
  });
}
