// E2E hidup: login → /api/fs/size & /api/fs/usage (bentuk respons + nilai wajar).
// Portabel di container. Kredensial dari env (tidak pernah membaca .env).
//
//   TERMINALKU_URL=http://127.0.0.1:8399 TERMINALKU_PASS=<sandi-uji> \
//     node --test test/test-size-live.mjs
//
// Bila server tak terjangkau atau login gagal, test di-SKIP (bukan gagal) —
// supaya suite tetap hijau tanpa kredensial.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.TERMINALKU_URL || 'http://100.97.161.68:8364';
const PASS = process.env.TERMINALKU_PASS || process.env.ADMIN_PASSWORD || '';
const TARGET = process.env.TERMINALKU_TARGET || '';

let cookie = '';
let reachable = false;

const req = async (p, opts = {}) => fetch(BASE + p, {
  ...opts,
  headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
});

test('server terjangkau + login', async (t) => {
  try {
    const res = await fetch(BASE + '/', { signal: AbortSignal.timeout(3000) });
    reachable = res.status === 200;
  } catch { reachable = false; }
  if (!reachable) return t.skip(`server tidak berjalan di ${BASE}`);
  if (!PASS) return t.skip('TERMINALKU_PASS tidak di-set — lewati test ber-kredensial');

  const res = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: PASS }) });
  if (res.status !== 200) return t.skip('login gagal (kredensial uji tidak cocok) — lewati');
  const setCookie = res.headers.get('set-cookie') || '';
  cookie = setCookie.split(';')[0];
  assert.ok(cookie.startsWith('terminalku_session='), 'cookie sesi tidak ada');
});

test('/api/fs/usage: bentuk & nilai wajar', async (t) => {
  if (!cookie) return t.skip('butuh login');
  const res = await req('/api/fs/usage');
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.ok, true);
  for (const k of ['total', 'used', 'free', 'freeAll', 'percent', 'path']) {
    assert.ok(k in d, `field hilang: ${k}`);
  }
  assert.ok(d.total > 0);
  assert.ok(d.used > 0 && d.used <= d.total);
  assert.ok(d.percent >= 0 && d.percent <= 100);
  assert.equal(d.used + d.freeAll, d.total, 'used + freeAll harus = total');
  assert.ok(d.free <= d.freeAll, 'free (bavail) <= freeAll (bfree)');
});

test('/api/fs/size: menghitung folder nyata', async (t) => {
  if (!cookie) return t.skip('butuh login');
  const dir = TARGET || (await (await req('/api/fs/root')).json()).root;
  const res = await req(`/api/fs/size?path=${encodeURIComponent(dir)}`);
  assert.equal(res.status, 200, `path=${dir}`);
  const d = await res.json();
  assert.equal(d.ok, true);
  assert.ok(typeof d.size === 'number' && d.size >= 0, 'size bukan angka');
  assert.ok(typeof d.files === 'number', 'files bukan angka');
  assert.ok(typeof d.dirs === 'number', 'dirs bukan angka');
  assert.ok(typeof d.truncated === 'boolean', 'truncated bukan boolean');
  if (d.truncated) assert.ok(typeof d.reason === 'string' && d.reason.length > 0, 'alasan pemotongan kosong');
});

test('/api/fs/size: tolak berkas (bukan direktori)', async (t) => {
  if (!cookie) return t.skip('butuh login');
  const root = (await (await req('/api/fs/root')).json()).root;
  const list = await (await req(`/api/fs/list?path=${encodeURIComponent(root)}`)).json();
  const file = (list.items || []).find((i) => i.type === 'file');
  if (!file) return t.skip('tidak ada berkas di root');
  const res = await req(`/api/fs/size?path=${encodeURIComponent(root + '/' + file.name)}`);
  assert.equal(res.status, 400);
});

test('/api/fs/size: tolak path di luar FS_ROOT', async (t) => {
  if (!cookie) return t.skip('butuh login');
  const res = await req('/api/fs/size?path=' + encodeURIComponent('/etc'));
  assert.equal(res.status, 403, 'path di luar FS_ROOT harus 403');
});
