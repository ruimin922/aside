-- ═══════════════════════════════════════════════════════════════════════
-- MovieNotes — Supabase 数据库初始化
-- 在 Supabase 控制台 → SQL Editor → New query 中粘贴执行一次
-- ═══════════════════════════════════════════════════════════════════════

-- 电影表（每用户每部电影一行）
create table if not exists movies (
  id          text primary key,           -- 本地 UUID（text 兼容 fallback 格式）
  user_id     uuid not null references auth.users(id) on delete cascade,
  movie_title text not null,
  tags        text[] not null default '{}',
  video_url   text,
  created_at  timestamptz not null,
  updated_at  timestamptz not null,
  deleted_at  timestamptz                 -- 软删除标记
);

-- 笔记条目表（thumbnails 不同步，仅存本地）
create table if not exists entries (
  id                  text primary key,
  movie_id            text not null references movies(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  timestamp_type      text,
  timestamp_sec       float8,
  timestamp_start_sec float8,
  timestamp_end_sec   float8,
  formatted_timestamp text,
  formatted_start     text,
  formatted_end       text,
  content             text not null default '',
  tags                text[] not null default '{}',
  video_url           text,
  created_at          timestamptz not null
);

-- 行级安全（用户只能读写自己的数据）
alter table movies enable row level security;
alter table entries enable row level security;

create policy "movies: own data only" on movies
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "entries: own data only" on entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 性能索引
create index if not exists movies_user_updated  on movies(user_id, updated_at desc);
create index if not exists entries_movie        on entries(movie_id);
create index if not exists entries_user_created on entries(user_id, created_at desc);

-- ═══════════════════════════════════════════════════════════════════════
-- 配置步骤（SQL 之外）
-- 1. Supabase 控制台 → Authentication → Providers → 开启 Google，
--    填入 Google OAuth Client ID + Secret（在 Google Cloud Console 创建）
-- 2. Authentication → URL Configuration → Redirect URLs → 添加：
--    https://<你的扩展ID>.chromiumapp.org/
--    （扩展 ID 在 chrome://extensions 开发者模式下可见）
-- 3. 将 Project URL 和 anon key 填入 utils/supabase.js 顶部的常量
-- ═══════════════════════════════════════════════════════════════════════
