// E2E: endpoint /api/fs/paste (Cut/Copy → Paste) dengan server sementara.
// Server dijalankan dengan FS_ROOT + DB_PATH di folder temp, password admin di-set
// lewat env sendiri (tidak pernah membaca .env).
//
// Butuh dependensi server (fastify) → di host biasanya di-skip. Jalankan di container:
//   docker run --rm --user "$(id -u):$(id -g)" -v ~/terminal/test:/t:ro -w /app \
//     terminalku-terminalku:latest node /t/test-paste-live.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const APP = process.env.TERMINALKU_APP || process.cwd();
const PORT = Number(process.env.TEST_PORT || 8399);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'uji-paste-lokal-123';

function depsAvailable() {
  try { createRequire(path.join(APP, 'package.json')).resolve('fastify'); return true; } catch { return false; }
}

async function waitReady(deadlineMs = 20000) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${BASE}/api/me`);
      if (r.ok) return true;
    } catch { /* belum siap */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

test('E2E /api/fs/paste: copy & move aman, nama unik, penolakan benar', async (t) => {
  if (!depsAvailable()) { t.skip('dependensi server (fastify) tidak tersedia — jalankan di container'); return; }

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'tk-paste-'));
  const logs = [];
  const child = spawn(process.execPath, [path.join(APP, 'server/index.js')], {
    cwd: APP,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      FS_ROOT: root,
      DB_PATH: path.join(root, 'db.sqlite'),
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: PASSWORD,
      ADMIN_ROLE: 'admin',
      SESSION_SECRET: 'uji-rahasia-lokal',
      LOGIN_MAX_FAIL: '50',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));

  const cleanup = async () => {
    if (!child.killed) child.kill('SIGKILL');
    await fsp.rm(root, { recursive: true, force: true });
  };
  t.after(cleanup);

  assert.ok(await waitReady(), 'server tidak siap. log:\n' + logs.join(''));

  // login (password di-set sendiri lewat env di atas)
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(loginRes.status, 200, 'login gagal: ' + (await loginRes.text()));
  const cookie = String(loginRes.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie, 'cookie sesi tidak diterima');

  const api = async (route, body) => {
    const res = await fetch(BASE + route, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };

  // ---- fixture ----
  const dir1 = path.join(root, 'dir1');
  const dir2 = path.join(root, 'dir2');
  await fsp.mkdir(dir1);
  await fsp.mkdir(dir2);
  await fsp.writeFile(path.join(dir1, 'a.txt'), 'AAA');
  await fsp.mkdir(path.join(dir1, 'sub'));
  await fsp.writeFile(path.join(dir1, 'sub', 'nested.txt'), 'NESTED');
  const stat = async (p) => { try { await fsp.stat(p); return true; } catch { return false; } };

  // 1) copy berkas ke folder yang sama → nama unik "a copy.txt"
  let r = await api('/api/fs/paste', { src: path.join(dir1, 'a.txt'), destDir: dir1, mode: 'copy' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.name, 'a copy.txt');
  assert.equal(await fsp.readFile(path.join(dir1, 'a copy.txt'), 'utf8'), 'AAA', 'isi hasil salin harus sama');
  assert.equal(await fsp.readFile(path.join(dir1, 'a.txt'), 'utf8'), 'AAA', 'sumber tetap ada setelah copy');

  // 2) copy lagi → "a copy 2.txt"
  r = await api('/api/fs/paste', { src: path.join(dir1, 'a.txt'), destDir: dir1, mode: 'copy' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.name, 'a copy 2.txt');

  // 3) copy folder (rekursif) ke dir2
  r = await api('/api/fs/paste', { src: path.join(dir1, 'sub'), destDir: dir2, mode: 'copy' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await fsp.readFile(path.join(dir2, 'sub', 'nested.txt'), 'utf8'), 'NESTED', 'isi folder ikut tersalin');

  // 4) move berkas ke dir2 → sumber hilang, tujuan ada
  r = await api('/api/fs/paste', { src: path.join(dir1, 'a.txt'), destDir: dir2, mode: 'move' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await stat(path.join(dir1, 'a.txt')), false, 'sumber harus hilang setelah move');
  assert.equal(await fsp.readFile(path.join(dir2, 'a.txt'), 'utf8'), 'AAA');

  // 5) move ke folder yang sama → ditolak
  r = await api('/api/fs/paste', { src: path.join(dir2, 'a.txt'), destDir: dir2, mode: 'move' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /sudah berada/);

  // 6) copy folder ke dalam dirinya sendiri → ditolak
  r = await api('/api/fs/paste', { src: path.join(dir1, 'sub'), destDir: path.join(dir1, 'sub'), mode: 'copy' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /dirinya sendiri/);

  // 7) tujuan di luar FS_ROOT → ditolak
  r = await api('/api/fs/paste', { src: path.join(dir1, 'sub'), destDir: '/etc', mode: 'copy' });
  assert.equal(r.status, 403);

  // 8) sumber di path terblokir (node_modules) → ditolak
  await fsp.mkdir(path.join(root, 'node_modules'));
  r = await api('/api/fs/paste', { src: path.join(root, 'node_modules'), destDir: dir2, mode: 'copy' });
  assert.equal(r.status, 403);

  // 9) mode tidak dikenal → 400
  r = await api('/api/fs/paste', { src: path.join(dir1, 'sub'), destDir: dir2, mode: 'hapus' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /mode/);

  // 10) traversal lewat ".." tidak bisa keluar FS_ROOT
  r = await api('/api/fs/paste', { src: path.join(root, '..', 'etc'), destDir: dir2, mode: 'copy' });
  assert.equal(r.status, 403);

  // 11) tanpa login → 401/403
  const anon = await fetch(`${BASE}/api/fs/paste`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ src: path.join(dir1, 'sub'), destDir: dir2, mode: 'copy' }),
  });
  assert.ok(anon.status === 401 || anon.status === 403, 'tanpa login harus ditolak, dapat ' + anon.status);
});
