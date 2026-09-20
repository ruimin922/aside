import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-000000000002';
const old = '2026-01-01T00:00:00Z';
const recent = '2026-02-01T00:00:00Z';
const later = '2026-03-01T00:00:00Z';
const sample = () => ({ id: 'movie-1', movie_title: 'Movie', created_at: old, updated_at: old, tags: ['film'], entries: [
  { id: 'entry-1', content: 'original', created_at: old, updated_at: old, thumbnail: 'data:image/jpeg;base64,YQ==' }
] });

test('PostgreSQL migration, atomic sync, image recovery, deletion, RLS and conflict handling', async t => {
  const pg = new PGlite();
  try {
    await pg.exec(`create role anon; create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key);
      insert into auth.users values('${A}'),('${B}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;`);
    await pg.exec(await readFile(new URL('../movie-notes-extension/supabase/schema.sql', import.meta.url), 'utf8'));
    const migration = await readFile(new URL('../movie-notes-extension/supabase/002-reliable-sync.sql', import.meta.url), 'utf8');
    await pg.exec(migration);
    await pg.exec(migration); // safely rerunnable
    await pg.exec('grant select,insert,update,delete on public.movies,public.entries to authenticated;');
    const asUser = async uid => {
      await pg.exec('reset role;');
      await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
      await pg.exec('set role authenticated;');
    };
    const push = async payload => pg.query('select public.aside_sync_movie($1::jsonb)', [JSON.stringify(payload)]);
    await asUser(A);
    await t.test('new note and thumbnail committed together', async () => {
      await push(sample());
      assert.equal((await pg.query('select thumbnail from entries')).rows[0].thumbnail, 'data:image/jpeg;base64,YQ==');
    });
    await t.test('newer entry wins against stale pushes', async () => {
      const next = sample(); next.updated_at = recent; next.entries[0].updated_at = recent; next.entries[0].content = 'new edit';
      await push(next); await push(sample());
      assert.equal((await pg.query('select content from entries')).rows[0].content, 'new edit');
    });
    await t.test('server revision advances even for a payload with an older client clock', async () => {
      const before = (await pg.query('select sync_updated_at::text as stamp from movies')).rows[0].stamp;
      await push(sample());
      const after = (await pg.query('select sync_updated_at::text as stamp from movies')).rows[0].stamp;
      assert.notEqual(before, after);
    });
    await t.test('entry deletion survives stale uploads', async () => {
      const next = sample(); next.updated_at = later; next.entries = [{ id: 'entry-1', created_at: old, updated_at: later, deleted_at: later }];
      await push(next); await push(sample());
      const lateEdit = sample(); lateEdit.entries[0].updated_at = '2027-01-01';
      await push(lateEdit);
      const row = (await pg.query('select deleted_at,thumbnail from entries')).rows[0];
      assert.ok(row.deleted_at); assert.equal(row.thumbnail, null);
    });
    await t.test('malformed image rolls back the whole transaction', async () => {
      const next = sample(); next.id = 'invalid'; next.entries[0].id = 'invalid-entry'; next.entries[0].thumbnail = 'javascript:evil';
      await assert.rejects(push(next), /Invalid or oversized/);
      assert.equal((await pg.query("select id from movies where id='invalid'")).rows.length, 0);
    });
    await t.test('entry cannot be moved into a different movie by ID reuse', async () => {
      const next = sample(); next.id = 'different';
      await assert.rejects(push(next), /belongs to another movie/);
      assert.equal((await pg.query("select id from movies where id='different'")).rows.length, 0);
    });
    await t.test('RLS isolates another account on read and write', async () => {
      await asUser(B);
      assert.equal((await pg.query('select * from movies')).rows.length, 0);
      await assert.rejects(push(sample()), /row-level security/);
      await asUser(A);
    });
    await t.test('movie deletion is not reversed by later stale-device edits', async () => {
      const next = sample(); next.deleted_at = later; next.updated_at = later; next.entries = [];
      await push(next);
      const stale = sample(); stale.updated_at = '2027-01-01'; stale.entries = [];
      await push(stale);
      assert.ok((await pg.query('select deleted_at from movies')).rows[0].deleted_at);
    });
  } finally { await pg.close(); }
});
