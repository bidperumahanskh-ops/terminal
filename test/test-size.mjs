// Test: ukuran folder (lazy) + indikator kapasitas disk di explorer.
// Statis (sumber) + fungsional (fs-size.js dengan pohon temp) + live HTTP (opsional).
import { readFileSync, promises as fsp } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'terminalku');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const BASE = process.env.TERMINALKU_URL || 'http://100.97.161.68:8364';

const { dirSize, diskUsage } = await import(pathToFileURL(path.join(root, 'server', 'fs-size.js')).href);

// ---------- statis: markup & gaya ----------
test('index.html: ada indikator kapasitas disk di panel explorer', () => {
  const html = read('public/index.html');
  assert.match(html, /id="disk-usage"/);
  // Harus berada di dalam .panel-head explorer (bukan panel lain)
  const explorer = html.slice(html.indexOf('id="explorer"'), html.indexOf('id="editor-panel"'));
  assert.ok(explorer.includes('id="disk-usage"'), 'disk-usage harus di panel explorer');
});

test('style.css: ada gaya ukuran folder & peringatan kapasitas', () => {
  const css = read('public/style.css');
  assert.match(css, /\.file-item \.dir-size\s*\{/);
  assert.match(css, /\.file-item \.dir-size\.partial\s*\{/);
  assert.match(css, /#disk-usage\s*\{/);
  assert.match(css, /#disk-usage\.warn\s*\{/);
});

// ---------- statis: logika frontend ----------
test('app.js: ukuran folder dihitung lazy, bukan di dalam /api/fs/list', () => {
  const js = read('public/app.js');
  for (const fn of ['fmtSizeFull', 'fmtDirSize', 'applyDirSize', 'queueDirSize', 'pumpSizeQueue', 'loadDiskUsage']) {
    assert.ok(js.includes(`function ${fn}`), `fungsi hilang: ${fn}`);
  }
  // Antrean berjalan paralel terbatas, bukan sekuensial tanpa batas
  assert.match(js, /SIZE_MAX_CONCURRENT\s*=\s*\d+/);
  // renderList memanggil queueDirSize untuk direktori
  const rl = js.slice(js.indexOf('function renderList'), js.indexOf('function applySelectionStyles'));
  assert.ok(rl.includes('queueDirSize('), 'renderList tidak memicu penghitungan ukuran folder');
});

test('app.js: kolom ukuran folder diberi placeholder dan class dir-size', () => {
  const js = read('public/app.js');
  const rl = js.slice(js.indexOf('function renderList'), js.indexOf('function applySelectionStyles'));
  assert.ok(/dir-size/.test(rl), 'class dir-size tidak dipakai di renderList');
  assert.ok(rl.includes("'…'"), 'placeholder "…" tidak ada untuk folder');
});

// ---------- statis: endpoint backend ----------
test('routes-fs.js: ada endpoint /api/fs/size dan /api/fs/usage', () => {
  const src = read('server/routes-fs.js');
  assert.match(src, /app\.get\('\/api\/fs\/size'/);
  assert.match(src, /app\.get\('\/api\/fs\/usage'/);
  assert.match(src, /import \{ dirSize, diskUsage \} from '\.\/fs-size\.js'/);
  // Ukuran folder TIDAK dihitung di dalam listing (mahal)
  const list = src.slice(src.indexOf("app.get('/api/fs/list'"), src.indexOf("app.get('/api/fs/size'"));
  assert.ok(!list.includes('dirSize('), 'listing tidak boleh memanggil dirSize');
});

// ---------- fungsional: dirSize ----------
async function makeTree(base) {
  await fsp.mkdir(path.join(base, 'a', 'b'), { recursive: true });
  await fsp.mkdir(path.join(base, 'c'), { recursive: true });
  await fsp.writeFile(path.join(base, 'f1.txt'), 'x'.repeat(100));
  await fsp.writeFile(path.join(base, 'a', 'f2.txt'), 'y'.repeat(250));
  await fsp.writeFile(path.join(base, 'a', 'b', 'f3.txt'), 'z'.repeat(400));
  await fsp.writeFile(path.join(base, 'c', 'f4.txt'), 'w'.repeat(50));
}

test('dirSize: menjumlahkan seluruh berkas rekursif', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'tksize-'));
  try {
    await makeTree(tmp);
    const r = await dirSize(tmp);
    assert.equal(r.size, 100 + 250 + 400 + 50, 'total ukuran salah');
    assert.equal(r.files, 4, 'jumlah berkas salah');
    assert.equal(r.dirs, 3, 'jumlah folder salah (a, a/b, c)');
    assert.equal(r.truncated, false);
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

test('dirSize: folder kosong = 0 tanpa error', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'tksize-'));
  try {
    const r = await dirSize(tmp);
    assert.equal(r.size, 0);
    assert.equal(r.files, 0);
    assert.equal(r.truncated, false);
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

test('dirSize: menghormati maxDepth dan menandai truncated', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'tksize-'));
  try {
    await makeTree(tmp);
    const r = await dirSize(tmp, { maxDepth: 1 });
    assert.equal(r.truncated, true, 'harus ditandai terpotong');
    assert.equal(r.reason, 'batas kedalaman');
    assert.ok(r.size < 100 + 250 + 400 + 50, 'ukuran harus lebih kecil dari total');
    assert.ok(r.size >= 100 + 250, 'berkas pada kedalaman 1 tetap terhitung');
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

test('dirSize: menghormati maxEntries dan menandai truncated', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'tksize-'));
  try {
    for (let i = 0; i < 20; i++) await fsp.writeFile(path.join(tmp, `f${i}.txt`), 'x'.repeat(10));
    const r = await dirSize(tmp, { maxEntries: 5 });
    assert.equal(r.truncated, true);
    assert.equal(r.reason, 'batas entri');
    assert.ok(r.files <= 5, `berkas dipindai harus <= 5, dapat ${r.files}`);
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

test('dirSize: direktori tak terbaca tidak menggagalkan pemindaian', async () => {
  const r = await dirSize('/proc/self/tidak-ada-direktori-ini');
  assert.equal(r.size, 0);
  assert.equal(r.files, 0);
});

// ---------- fungsional: diskUsage ----------
test('diskUsage: angka konsisten (used + free = total, persen wajar)', async () => {
  const u = await diskUsage(root);
  assert.ok(u.total > 0, 'total harus > 0');
  assert.ok(u.free >= 0, 'free tidak boleh negatif');
  assert.ok(u.used > 0, 'used harus > 0');
  assert.ok(u.percent >= 0 && u.percent <= 100, `persen di luar 0-100: ${u.percent}`);
  // used memakai bfree (konvensi df) → used + freeAll = total
  assert.equal(u.used + u.freeAll, u.total, 'used + freeAll harus sama dengan total');
  // bavail <= bfree → free (untuk user) tidak melebihi freeAll
  assert.ok(u.free <= u.freeAll, 'free (bavail) tidak boleh melebihi freeAll (bfree)');
  assert.ok(u.used <= u.total, 'used melebihi total');
});

test('diskUsage: cocok dengan df (selisih < 1%)', async () => {
  const u = await diskUsage(root);
  // df -B1 <path> → total, used
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync('df', ['-B1', '--output=size,used', root], { encoding: 'utf8' })
    .trim().split('\n').pop().trim().split(/\s+/).map(Number);
  const [dfTotal, dfUsed] = out;
  if (!Number.isFinite(dfTotal) || !Number.isFinite(dfUsed)) return;
  const rel = (a, b) => Math.abs(a - b) / b;
  assert.ok(rel(u.total, dfTotal) < 0.01, `total beda dari df: ${u.total} vs ${dfTotal}`);
  assert.ok(rel(u.used, dfUsed) < 0.01, `used beda dari df: ${u.used} vs ${dfUsed}`);
});

// ---------- live HTTP (opsional) ----------
test('live: /api/fs/size & /api/fs/usage (dilewati bila server mati)', async (t) => {
  const probe = async (p) => {
    try {
      const res = await fetch(BASE + p, { signal: AbortSignal.timeout(3000) });
      return res;
    } catch { return null; }
  };
  const up = await probe('/');
  if (!up) return t.skip('server tidak berjalan');
  const r = await probe('/api/fs/usage');
  assert.ok(r, 'endpoint /api/fs/usage tidak merespons');
  // Tanpa login harus 401 (bukan 404/500)
  assert.ok([200, 401].includes(r.status), `status tak terduga: ${r.status}`);
});
