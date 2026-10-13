// Test: tab editor multi-berkas (gaya VS Code), indikator belum-disimpan, tanpa autosave.
// Statis (baca sumber) + fungsional (jalankan tab helper di VM) + live HTTP (opsional).
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'terminalku');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const BASE = process.env.TERMINALKU_URL || 'http://100.97.161.68:8364';

// --- ekstraksi blok tab helper (murni, tanpa DOM) dari app.js ---
const TB_START = '// ---------- tab state helper (murni, tanpa DOM) ----------';
const TB_END = '// ---------- akhir tab state helper ----------';
function loadTabHelpers() {
  const src = read('public/app.js');
  const a = src.indexOf(TB_START);
  const b = src.indexOf(TB_END);
  assert.ok(a >= 0 && b > a, 'blok tab state helper tidak ditemukan di app.js');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(src.slice(a, b) + '\nthis.__h = { tabId, findTabIndex, isTabDirty, anyTabDirty, tabCloseTarget };', sandbox);
  return sandbox.__h;
}

// tab palsu: cukup punya doc.getValue() dan savedContent
const fakeTab = (id, content, saved) => ({ id, doc: { getValue: () => content }, savedContent: saved });

// ---------- statis: markup ----------
test('index.html: bar tab ada di dalam panel editor, sebelum panel-head', () => {
  const html = read('public/index.html');
  assert.match(html, /id="tabs"/);
  const start = html.indexOf('id="editor-panel"');
  const panel = html.slice(start, html.indexOf('</section>', start));
  assert.ok(panel.indexOf('id="tabs"') > -1, 'tabs harus di dalam #editor-panel');
  assert.ok(panel.indexOf('id="tabs"') < panel.indexOf('class="panel-head"'), 'tabs harus di atas panel-head');
});

// ---------- statis: gaya tab + indikator dirty ----------
test('style.css: gaya tab, tab aktif, dan indikator belum disimpan', () => {
  const css = read('public/style.css');
  assert.match(css, /\.tabs\s*\{/);
  assert.match(css, /\.tab\s*\{/);
  assert.match(css, /\.tab\.active\s*\{/);
  assert.match(css, /\.tab-close\s*\{/);
  assert.match(css, /\.tab \.i-dot\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.tab\.dirty \.i-dot\s*\{\s*display:\s*inline/);
  assert.match(css, /\.tab\.dirty \.i-x\s*\{\s*display:\s*none/);
  assert.match(css, /\.tab\.dirty:hover \.i-x\s*\{\s*display:\s*inline/);
});

// ---------- statis: multi-dokumen + tanpa autosave ----------
test('app.js: pakai CodeMirror.Doc + swapDoc untuk multi-berkas', () => {
  const js = read('public/app.js');
  assert.match(js, /CodeMirror\.Doc\(/);
  assert.match(js, /swapDoc\(/);
  assert.match(js, /savedContent/);
  assert.match(js, /function activateTab\(/);
  assert.match(js, /function closeTab\(/);
  assert.match(js, /function renderTabs\(/);
  assert.match(js, /function rebuildTabs\(/);
  assert.match(js, /dataset\.tabId/);
  assert.match(js, /state\.tabs/);
  assert.match(js, /beforeunload/);
  assert.match(js, /class="tab-name"/);
});

test('app.js: TIDAK ada autosave — /api/fs/write hanya di saveFile', () => {
  const js = read('public/app.js');
  const hits = js.match(/\/api\/fs\/write/g) || [];
  assert.equal(hits.length, 1, 'tulis ke server hanya boleh satu tempat (saveFile)');
  const save = js.slice(js.indexOf('async function saveFile'), js.indexOf("$('#btn-save')"));
  assert.match(save, /\/api\/fs\/write/);
  const open = js.slice(js.indexOf('async function openFile'), js.indexOf('function activateTab'));
  assert.ok(open.indexOf('/api/fs/write') < 0, 'openFile tidak boleh menulis ke server');
  assert.ok(open.indexOf('/api/fs/read') >= 0, 'openFile hanya membaca');
  assert.ok(js.indexOf('state.editorPath') < 0, 'state.editorPath sudah digantikan per-tab');
});

test('app.js: perubahan dokumen hanya menandai dirty, bukan menyimpan', () => {
  const js = read('public/app.js');
  const fn = js.slice(js.indexOf('function onDocChange'), js.indexOf('async function openFile'));
  assert.ok(fn.indexOf('/api/fs/') < 0, 'onDocChange tidak boleh memanggil API tulis');
  assert.match(fn, /change\.origin === 'setValue'/);
  assert.match(fn, /renderTabs\(\)/);
  // event 'change' CodeMirror deferred -> jangan saring renderTabs berdasarkan tab aktif
  assert.ok(fn.indexOf('state.activeTab) return') < 0, 'renderTabs tidak boleh dibatasi tab aktif');
});

// ---------- fungsional: helper ----------
test('helper: tabId & findTabIndex memetakan path ke tab', () => {
  const h = loadTabHelpers();
  const tabs = [fakeTab('/a/b.txt', 'x', 'x'), fakeTab('/a/c.md', 'y', 'y')];
  assert.equal(h.tabId(null), '');
  assert.equal(h.tabId('/a/b.txt'), '/a/b.txt');
  assert.equal(h.findTabIndex(tabs, '/a/c.md'), 1);
  assert.equal(h.findTabIndex(tabs, '/tidak/ada'), -1);
});

test('helper: isTabDirty benar saat isi berbeda dari versi tersimpan', () => {
  const h = loadTabHelpers();
  assert.equal(h.isTabDirty(fakeTab('a', 'sama', 'sama')), false);
  assert.equal(h.isTabDirty(fakeTab('a', 'berubah', 'sama')), true);
  assert.equal(h.isTabDirty(null), false);
  // undo kembali ke isi semula -> bersih lagi
  assert.equal(h.isTabDirty(fakeTab('a', 'sama', 'sama')), false);
  assert.equal(h.anyTabDirty([fakeTab('a', 'a', 'a'), fakeTab('b', 'b', 'x')]), true);
  assert.equal(h.anyTabDirty([]), false);
});

test('helper: tabCloseTarget memilih tab tetangga yang benar', () => {
  const h = loadTabHelpers();
  const tabs = [fakeTab('t0', '', ''), fakeTab('t1', '', ''), fakeTab('t2', '', '')];
  assert.equal(h.tabCloseTarget([tabs[0]], 0), null, 'tab terakhir -> tidak ada sisa');
  assert.equal(h.tabCloseTarget(tabs, 0), 't1', 'tutup tab pertama -> aktifkan kanan');
  assert.equal(h.tabCloseTarget(tabs, 1), 't0', 'tutup tab tengah -> aktifkan kiri');
  assert.equal(h.tabCloseTarget(tabs, 2), 't1', 'tutup tab terakhir -> aktifkan kiri');
});

// ---------- live: aset yang disajikan server ----------
test('live: halaman tersaji memuat bar tab dan logika multi-dokumen', async (t) => {
  let res;
  try { res = await fetch(BASE + '/'); } catch (e) { t.skip('server tidak terjangkau (' + BASE + '): ' + e.message); return; }
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /id="tabs"/);
  const js = await (await fetch(BASE + '/app.js')).text();
  assert.match(js, /CodeMirror\.Doc\(/);
  assert.match(js, /function renderTabs\(/);
  const css = await (await fetch(BASE + '/style.css')).text();
  assert.match(css, /\.tab\.dirty/);
});
