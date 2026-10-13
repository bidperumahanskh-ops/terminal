// Test: menu klik kanan explorer (pengganti tombol inline) + endpoint /api/fs/paste.
// Statis (sumber) + fungsional (uniqueTarget di VM dengan folder temp) + live HTTP (opsional).
import { readFileSync, promises as fsp } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'terminalku');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const BASE = process.env.TERMINALKU_URL || 'http://100.97.161.68:8364';

// Ekstraksi fungsi dari routes-fs.js (brace matching) untuk diuji tanpa server
function extractFn(src, name) {
  const start = src.indexOf('async function ' + name + '(');
  assert.ok(start >= 0, 'fungsi ' + name + ' tidak ada di routes-fs.js');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('brace tidak seimbang pada ' + name);
}

async function loadUniqueTarget() {
  const src = read('server/routes-fs.js');
  const code = [extractFn(src, 'exists'), extractFn(src, 'uniqueTarget')].join('\n') + '\nthis.__u = uniqueTarget;';
  const sandbox = { fs: fsp, path };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.__u;
}

// ---------- statis: markup & gaya menu ----------
test('index.html: ada kontainer menu klik kanan', () => {
  const html = read('public/index.html');
  assert.match(html, /id="ctx-menu"/);
  assert.match(html, /role="menu"/);
});

test('style.css: gaya menu, item nonaktif, pemisah, dan penanda cut', () => {
  const css = read('public/style.css');
  assert.match(css, /\.ctx-menu\s*\{/);
  assert.match(css, /\.ctx-item\s*\{/);
  assert.match(css, /\.ctx-item\.disabled/);
  assert.match(css, /\.ctx-sep\s*\{/);
  assert.match(css, /\.file-item\.cut\s*\{[^}]*opacity/);
  assert.ok(css.indexOf('.file-item .actions') < 0, 'gaya tombol inline harus dihapus');
});

// ---------- statis: daftar pilihan menu ----------
test('app.js: menu berkas berisi Cut, Copy, Paste, Download, Copy Path, Copy Relative Path, Rename, Delete Permanently', () => {
  const js = read('public/app.js');
  const menu = js.slice(js.indexOf('function openCtxMenu'), js.indexOf('function closeCtxMenu'));
  for (const label of ['Cut', 'Copy', 'Paste', 'Download…', 'Copy Path', 'Copy Relative Path', 'Rename…', 'Delete Permanently']) {
    assert.ok(menu.includes(`'${label}'`), `label menu hilang: ${label}`);
  }
});

test('app.js: menu folder menambah New File… dan New Folder…', () => {
  const js = read('public/app.js');
  const menu = js.slice(js.indexOf('function openCtxMenu'), js.indexOf('function closeCtxMenu'));
  const dirBlock = menu.slice(menu.indexOf('if (isDir)'), menu.indexOf('add(\'Cut\''));
  assert.match(dirBlock, /'New File…'/);
  assert.match(dirBlock, /'New Folder…'/);
  assert.match(dirBlock, /createItem\(itemPath\(it\), 'file'\)/);
  assert.match(dirBlock, /createItem\(itemPath\(it\), 'dir'\)/);
});

test('app.js: Cut/Copy/Paste hanya untuk admin, Paste butuh clipboard', () => {
  const js = read('public/app.js');
  const menu = js.slice(js.indexOf('function openCtxMenu'), js.indexOf('function closeCtxMenu'));
  assert.match(menu, /add\('Cut', 'Ctrl\+X', \(\) => setClipboard\(it, 'move'\), !isAdmin\(\)\)/);
  assert.match(menu, /add\('Copy', 'Ctrl\+C', \(\) => setClipboard\(it, 'copy'\)\)/);
  assert.match(menu, /add\('Paste', 'Ctrl\+V', \(\) => pasteInto\(it\), !isAdmin\(\) \|\| !clip\)/);
  assert.match(js, /function setClipboard/);
  assert.match(js, /function pasteInto/);
  assert.match(js, /\/api\/fs\/paste/);
});

test('app.js: menu ditutup oleh klik luar, Escape, resize, dan scroll', () => {
  const js = read('public/app.js');
  assert.match(js, /function closeCtxMenu/);
  assert.match(js, /closest\('#ctx-menu'\)/);
  assert.match(js, /e\.key === 'Escape'/);
  assert.match(js, /addEventListener\('resize', closeCtxMenu\)/);
  assert.match(js, /'#file-list'\)\.addEventListener\('scroll', closeCtxMenu/);
});

test('app.js: e.target non-Element tidak memicu TypeError', () => {
  const js = read('public/app.js');
  assert.match(js, /const asElement = \(t\) => \(t instanceof Element \? t : null\)/);
  // tidak boleh ada pemanggilan .closest langsung pada e.target
  assert.ok(js.indexOf('e.target.closest') < 0, 'e.target bisa bukan Element → gunakan asElement()');
});

test('app.js: pintasan explorer dilewati saat fokus di editor/terminal/input', () => {
  const js = read('public/app.js');
  const kd = js.slice(js.indexOf("// Pintasan keyboard explorer"), js.indexOf('function downloadItem'));
  assert.match(kd, /closest\('\.CodeMirror'\)/);
  assert.match(kd, /closest\('#terminal'\)/);
  assert.match(kd, /TEXTAREA/);
  assert.match(kd, /e\.key === 'F2'/);
  assert.match(kd, /e\.key === 'Delete'/);
});

test('app.js: rename/delete mengikuti tab yang terbuka', () => {
  const js = read('public/app.js');
  assert.match(js, /function renameOpenTab/);
  assert.match(js, /function removeTabSilently/);
  assert.match(js, /renameOpenTab\(p, data\.path\)/);
  assert.match(js, /renameOpenTab\(clip\.path, data\.path\)/);
});

// ---------- statis: backend ----------
test('routes-fs.js: endpoint paste memvalidasi mode, path, dan tujuan', () => {
  const src = read('server/routes-fs.js');
  assert.match(src, /app\.post\('\/api\/fs\/paste'/);
  assert.match(src, /mode !== 'copy' && mode !== 'move'/);
  assert.match(src, /canWrite\(req\.user\)/);
  assert.match(src, /destStat\.isDirectory\(\)/);
  assert.match(src, /ke dalam dirinya sendiri/);
  assert.match(src, /sudah berada di folder ini/);
  assert.match(src, /uniqueTarget\(/);
  assert.match(src, /EXDEV/);
  assert.match(src, /audit\(req\.user\.id, `fs\.\$\{mode\}`/);
});

// ---------- fungsional: penamaan unik anti-timpa ----------
test('uniqueTarget: nama bebas dipakai apa adanya', async (t) => {
  const uniqueTarget = await loadUniqueTarget();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tk-uniq-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  assert.equal(await uniqueTarget(dir, 'a.txt'), path.join(dir, 'a.txt'));
});

test('uniqueTarget: berkas yang sudah ada → "a copy.txt" lalu "a copy 2.txt"', async (t) => {
  const uniqueTarget = await loadUniqueTarget();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tk-uniq-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  await fsp.writeFile(path.join(dir, 'a.txt'), 'x');
  assert.equal(await uniqueTarget(dir, 'a.txt'), path.join(dir, 'a copy.txt'));
  await fsp.writeFile(path.join(dir, 'a copy.txt'), 'x');
  assert.equal(await uniqueTarget(dir, 'a.txt'), path.join(dir, 'a copy 2.txt'));
});

test('uniqueTarget: folder tanpa ekstensi → "src copy"', async (t) => {
  const uniqueTarget = await loadUniqueTarget();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tk-uniq-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  await fsp.mkdir(path.join(dir, 'src'));
  assert.equal(await uniqueTarget(dir, 'src'), path.join(dir, 'src copy'));
});

test('uniqueTarget: nama ber-titik banyak hanya memisah ekstensi terakhir', async (t) => {
  const uniqueTarget = await loadUniqueTarget();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tk-uniq-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  await fsp.writeFile(path.join(dir, 'arsip.tar.gz'), 'x');
  assert.equal(await uniqueTarget(dir, 'arsip.tar.gz'), path.join(dir, 'arsip.tar copy.gz'));
});

// ---------- live: aset yang disajikan server ----------
test('live: halaman tersaji memuat menu klik kanan dan gaya penanda cut', async (t) => {
  let res;
  try { res = await fetch(BASE + '/'); } catch (e) { t.skip('server tidak terjangkau (' + BASE + '): ' + e.message); return; }
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /id="ctx-menu"/);
  const js = await (await fetch(BASE + '/app.js')).text();
  assert.match(js, /function openCtxMenu/);
  assert.ok(js.indexOf('act-download') < 0, 'aset tersaji masih memuat tombol inline lama');
  const css = await (await fetch(BASE + '/style.css')).text();
  assert.match(css, /\.ctx-item/);
});
