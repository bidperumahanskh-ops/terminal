// Test integrasi Terminalku — reusable, idempoten, jalan di host/container.
// Jalankan: node --test test/
// Butuh server berjalan (default http://localhost:8364, override TERMINALKU_URL).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.TERMINALKU_URL || 'http://localhost:8364';
const USER = process.env.TERMINALKU_USER || 'admin';
const PASS = process.env.TERMINALKU_PASS || 'terminalku123';

let cookie = '';

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, headers: res.headers };
}

// Semua test berurutan (berbagi cookie sesi) — concurrency false
describe('Terminalku API', { concurrency: false }, () => {
  it('server hidup', async () => {
    const res = await fetch(BASE + '/');
    assert.equal(res.status, 200);
  });

  it('login sukses → cookie sesi', async () => {
    const res = await req('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASS }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    const setCookie = res.headers.get('set-cookie') || '';
    cookie = setCookie.split(';')[0];
    assert.ok(cookie.startsWith('terminalku_session='), 'cookie sesi ada');
  });

  it('tanpa login → 401', async () => {
    const res = await fetch(BASE + '/api/fs/list?path=/');
    assert.equal(res.status, 401);
  });

  it('list direktori root', async () => {
    const res = await req('/api/fs/list?path=/host/home');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.items));
  });

  it('path traversal diblokir', async () => {
    const res = await req('/api/fs/list?path=../../etc');
    assert.equal(res.status, 403);
  });

  it('path sensitif diblokir', async () => {
    const res = await req('/api/fs/list?path=/host/home/.ssh');
    assert.equal(res.status, 403);
  });

  it('baca file teks', async () => {
    const res = await req('/api/fs/read?path=/host/home/terminal/AGENTS.md');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.content.includes('AGENTS.md'));
  });

  it('baca direktori → 400', async () => {
    const res = await req('/api/fs/read?path=/host/home/terminal');
    assert.equal(res.status, 400);
  });

  it('me → user terautentikasi', async () => {
    const res = await req('/api/me');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.user.username, USER);
  });

  it('logout → sesi berakhir', async () => {
    const res = await req('/api/auth/logout', { method: 'POST' });
    assert.equal(res.status, 200);
    const after = await fetch(BASE + '/api/me');
    assert.equal(after.status, 200);
    const body = await after.json();
    assert.equal(body.ok, false);
  });

  // ---------- Fase 2: tulis, CRUD, upload, download ----------
  const TEST_DIR = '/host/home/terminal/terminalku/test-tmp';

  it('login ulang (sesi baru)', async () => {
    const res = await req('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASS }),
    });
    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie') || '';
    cookie = setCookie.split(';')[0];
    assert.ok(cookie.startsWith('terminalku_session='));
  });

  it('setup: hapus folder test lama (idempotency)', async () => {
    const res = await req('/api/fs/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: TEST_DIR }),
    });
    // 200 (hapus sukses) atau 400 (folder belum ada) — dua-dua OK
    assert.ok(res.status === 200 || res.status === 400, `status ${res.status}`);
  });

  it('buat folder test', async () => {
    const me = await req('/api/me');
    const res = await req('/api/fs/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/host/home/terminal/terminalku', name: 'test-tmp', type: 'dir' }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  it('buat file baru', async () => {
    const res = await req('/api/fs/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: TEST_DIR, name: 'hello.txt', type: 'file' }),
    });
    assert.equal(res.status, 200);
  });

  it('tulis file (baru)', async () => {
    const res = await req('/api/fs/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: `${TEST_DIR}/hello.txt`, content: 'halo dunia\n' }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    // File dibuat kosong di test sebelumnya → backup dibuat (file sudah ada)
    assert.ok(res.body.backup, 'backup ada karena file sudah ada');
  });

  it('tulis ulang → backup dibuat', async () => {
    const res = await req('/api/fs/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: `${TEST_DIR}/hello.txt`, content: 'halo dunia v2\n' }),
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.backup, 'backup ada');
    assert.ok(res.body.backup.includes('.bak-'), 'nama backup .bak-');
  });

  it('baca hasil tulis', async () => {
    const res = await req(`/api/fs/read?path=${TEST_DIR}/hello.txt`);
    assert.equal(res.status, 200);
    assert.equal(res.body.content, 'halo dunia v2\n');
  });

  it('upload file', async () => {
    const res = await req('/api/fs/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: TEST_DIR, name: 'uploaded.txt', content: 'isi upload' }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  it('download file', async () => {
    const res = await fetch(`${BASE}/api/fs/download?path=${TEST_DIR}/uploaded.txt`, {
      headers: { cookie },
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text, 'isi upload');
  });

  it('rename file', async () => {
    const res = await req('/api/fs/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: `${TEST_DIR}/uploaded.txt`, newName: 'renamed.txt' }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  it('hapus file', async () => {
    const res = await req('/api/fs/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: `${TEST_DIR}/renamed.txt` }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  it('hapus folder test (recursive)', async () => {
    const res = await req('/api/fs/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: TEST_DIR }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  it('nama tidak valid ditolak (traversal)', async () => {
    const res = await req('/api/fs/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/host/home/terminal/terminalku', name: '../x', type: 'file' }),
    });
    assert.equal(res.status, 400);
  });
});
