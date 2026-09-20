-- Apply after schema.sql in the Supabase SQL editor. Additive; no existing notes are removed.
-- Upgrade all writing extensions to 1.6.0; old clients do not understand deletion tombstones.
begin;
alter table public.movies add column if not exists sync_updated_at timestamptz not null default clock_timestamp();
alter table public.entries add column if not exists updated_at timestamptz;
update public.entries set updated_at = created_at where updated_at is null;
alter table public.entries alter column updated_at set not null;
alter table public.entries alter column updated_at set default now();
alter table public.entries add column if not exists deleted_at timestamptz;
-- Bounded preview images, not original videos. Protected by the existing per-user RLS.
alter table public.entries add column if not exists thumbnail text;

-- The entry owner must also own its parent movie, including direct REST writes.
create unique index if not exists movies_id_user_unique on public.movies(id,user_id);
do $$ begin
  if not exists(select 1 from pg_constraint where conname='entries_movie_owner_fk' and conrelid='public.entries'::regclass) then
    alter table public.entries add constraint entries_movie_owner_fk foreign key(movie_id,user_id) references public.movies(id,user_id) on delete cascade;
  end if;
end $$;

create or replace function public.aside_sync_movie(payload jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  mid text := payload->>'id';
  e jsonb;
  changed timestamptz;
  picture text;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if mid is null or length(mid) > 200 or nullif(payload->>'movie_title','') is null then
    raise exception 'Invalid movie';
  end if;
  -- Serialize writers of the same movie inside the server transaction.
  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':' || mid, 0));
  changed := (payload->>'updated_at')::timestamptz;
  if changed is null then raise exception 'Missing revision'; end if;
  insert into public.movies(id,user_id,movie_title,tags,video_url,created_at,updated_at,deleted_at)
  values(mid,uid,payload->>'movie_title',array(select jsonb_array_elements_text(coalesce(payload->'tags','[]'))),
    payload->>'video_url',(payload->>'created_at')::timestamptz,changed,(payload->>'deleted_at')::timestamptz)
  on conflict(id) do update set
    movie_title = case when excluded.updated_at >= movies.updated_at then excluded.movie_title else movies.movie_title end,
    tags = case when excluded.updated_at >= movies.updated_at then excluded.tags else movies.tags end,
    video_url = case when excluded.updated_at >= movies.updated_at then excluded.video_url else movies.video_url end,
    updated_at = greatest(movies.updated_at,excluded.updated_at),
    sync_updated_at = clock_timestamp(),
    deleted_at = coalesce(movies.deleted_at,excluded.deleted_at);

  for e in select value from jsonb_array_elements(coalesce(payload->'entries','[]')) loop
    if nullif(e->>'id','') is null then raise exception 'Invalid entry'; end if;
    if exists(select 1 from public.entries where id=e->>'id' and movie_id<>mid) then
      raise exception 'Entry belongs to another movie';
    end if;
    picture := e->>'thumbnail';
    if picture is not null and (length(picture)>2000000 or picture !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$') then
      raise exception 'Invalid or oversized preview image';
    end if;
    insert into public.entries(id,movie_id,user_id,content,tags,video_url,
      timestamp_type,timestamp_sec,timestamp_start_sec,timestamp_end_sec,
      formatted_timestamp,formatted_start,formatted_end,created_at,updated_at,deleted_at,thumbnail)
    values(e->>'id',mid,uid,coalesce(e->>'content',''),
      array(select jsonb_array_elements_text(coalesce(e->'tags','[]'))),e->>'video_url',
      e->>'timestamp_type',(e->>'timestamp_sec')::float8,(e->>'timestamp_start_sec')::float8,(e->>'timestamp_end_sec')::float8,
      e->>'formatted_timestamp',e->>'formatted_start',e->>'formatted_end',
      (e->>'created_at')::timestamptz,(e->>'updated_at')::timestamptz,(e->>'deleted_at')::timestamptz,picture)
    on conflict(id) do update set
      content=excluded.content,tags=excluded.tags,video_url=excluded.video_url,
      timestamp_type=excluded.timestamp_type,timestamp_sec=excluded.timestamp_sec,
      timestamp_start_sec=excluded.timestamp_start_sec,timestamp_end_sec=excluded.timestamp_end_sec,
      formatted_timestamp=excluded.formatted_timestamp,formatted_start=excluded.formatted_start,formatted_end=excluded.formatted_end,
      updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,
      thumbnail=case when excluded.deleted_at is not null then null else coalesce(excluded.thumbnail,entries.thumbnail) end
    where entries.deleted_at is null and (
      excluded.deleted_at is not null or excluded.updated_at > entries.updated_at
      or (excluded.updated_at = entries.updated_at and entries.thumbnail is null));
  end loop;
end;
$$;
revoke all on function public.aside_sync_movie(jsonb) from public, anon;
grant execute on function public.aside_sync_movie(jsonb) to authenticated;
grant select, insert, update, delete on public.movies, public.entries to authenticated;
notify pgrst, 'reload schema';
commit;
