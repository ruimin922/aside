// Vercel Cron 调用：每天 ping 一次 Supabase，避免免费版项目闲置 7 天后被自动暂停。
// anon key 本身就是公开的（前端代码里也有），无需保密处理。

const SUPABASE_URL = "https://nmzzbwsgzkpgkckulgva.supabase.co";
const SUPABASE_ANON = "sb_publishable_khcKIRvYjYCiQGTE556vMg_q7umR6gc";

export default async function handler(req, res) {
  const started = Date.now();
  const results = {};

  // 1. Auth service health
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: SUPABASE_ANON }
    });
    results.auth = { ok: r.ok, status: r.status };
  } catch (e) {
    results.auth = { ok: false, error: String(e?.message || e) };
  }

  // 2. DB activity ping（RLS 下匿名访问拿到空数组，但请求已落 DB）
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/movies?select=id&limit=1`, {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`
      }
    });
    results.db = { ok: r.ok, status: r.status };
  } catch (e) {
    results.db = { ok: false, error: String(e?.message || e) };
  }

  res.status(200).json({
    ts: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    results
  });
}
