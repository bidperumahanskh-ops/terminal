// Test: dropdown format tampilan berkas (Text Editor / Markdown Preview / Markdown Editor)
// Statis (baca sumber) + fungsional (jalankan renderMarkdown di VM) + live HTTP (opsional).
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'terminalku');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const BASE = process.env.TERMINALKU_URL || 'http://100.97.161.68:8364';

// --- ekstraksi blok renderer dari app.js agar bisa diuji tanpa browser ---
const MD_START = '// ---------- Markdown renderer (mini, tanpa dependensi) ----------';
const MD_END = '// ---------- akhir markdown renderer ----------';
function loadRenderer() {
  const src = read('public/app.js');
  const a = src.indexOf(MD_START);
  const b = src.indexOf(MD_END);
  assert.ok(a >= 0 && b > a, 'blok markdown renderer tidak ditemukan di app.js');
  const block = src.slice(a, b);
  assert.ok(block.indexOf('renderList(') < 0, 'nama renderList bentrok dengan renderer explorer');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(block + '\nthis.__md = renderMarkdown;', sandbox);
  return sandbox.__md;
}

// ---------- statis: markup ----------
test('index.html: dropdown view-mode dengan 3 opsi di kanan atas panel file', () => {
  const html = read('public/index.html');
  assert.match(html, /id="view-mode"/);
  assert.match(html, /value="text"/);
  assert.match(html, /value="md-preview"/);
  assert.match(html, /value="md-editor"/);
  assert.match(html, /id="md-preview"/);
  const start = html.indexOf('id="editor-panel"');
  const panel = html.slice(start, html.indexOf('</section>', start));
  assert.ok(panel.indexOf('id="view-mode"') > panel.indexOf('id="editor-actions"'), 'dropdown harus di kanan editor-actions');
});

// ---------- statis: gaya ----------
test('style.css: gaya dropdown + mode preview menyembunyikan editor', () => {
  const css = read('public/style.css');
  assert.match(css, /#view-mode\s*\{/);
  assert.match(css, /#view-mode option:disabled/);
  assert.match(css, /\.md-preview\s*\{/);
  assert.match(css, /preview-on \.CodeMirror\s*\{\s*display:\s*none/);
  assert.match(css, /\.md-preview pre\.md-code/);
  assert.match(css, /table\.md-table/);
});

// ---------- statis: wiring logika ----------
test('app.js: dropdown terhubung ke setViewMode/applyViewMode', () => {
  const js = read('public/app.js');
  assert.match(js, /function setupViewSelect/);
  assert.match(js, /function setViewMode/);
  assert.match(js, /function applyViewMode/);
  assert.match(js, /function renderPreview/);
  assert.match(js, /#view-mode'\)\.addEventListener\('change'/);
  assert.match(js, /MD_EXT/);
  assert.match(js, /viewMode === 'md-preview'/);
  assert.match(js, /viewMode === 'md-editor' \? 'markdown'/);
});

// ---------- fungsional: renderer markdown ----------
test('renderMarkdown: heading, bold, italic, inline code', () => {
  const md = loadRenderer();
  assert.equal(md('# Halo **dunia**'), '<h1>Halo <strong>dunia</strong></h1>');
  assert.equal(md('## Sub _miring_'), '<h2>Sub <em>miring</em></h2>');
  assert.equal(md('teks `kode` selesai'), '<p>teks <code>kode</code> selesai</p>');
});

test('renderMarkdown: XSS di-escape dan URL tidak aman ditolak', () => {
  const md = loadRenderer();
  const out = md('<script>alert(1)</script>');
  assert.ok(out.indexOf('&lt;script&gt;') >= 0, 'tag HTML harus di-escape');
  assert.ok(out.indexOf('<script>') < 0, 'tag mentah tidak boleh lolos');
  const link = md('[x](javascript:alert(1))');
  assert.ok(link.indexOf('href') < 0, 'javascript: tidak boleh jadi href');
  const safe = md('[ok](https://example.com)');
  assert.ok(safe.indexOf('href="https://example.com"') >= 0, 'link https harus dirender');
  const img = md('![alt](data:text/html;base64,PHN2Zz4=)');
  assert.ok(img.indexOf('<img') < 0, 'data: URI harus ditolak');
});

test('renderMarkdown: daftar bersarang bullet dan bernomor', () => {
  const md = loadRenderer();
  const out = md('- a\n  - b\n- c');
  assert.equal(out, '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>');
  assert.equal(md('1. satu\n2. dua'), '<ol><li>satu</li><li>dua</li></ol>');
});

test('renderMarkdown: tabel, blok kode, kutipan, hr', () => {
  const md = loadRenderer();
  const table = md('| a | b |\n|---|---|\n| 1 | 2 |');
  assert.ok(table.indexOf('<table class="md-table">') === 0, 'harus jadi tabel');
  assert.ok(table.indexOf('<th>a</th>') >= 0 && table.indexOf('<td>2</td>') >= 0, 'sel tabel terisi');
  const fence = md('```js\nconst a = 1 < 2;\n```');
  assert.ok(fence.indexOf('<pre class="md-code"><code class="language-js">') === 0, 'blok kode + bahasa');
  assert.ok(fence.indexOf('const a = 1 &lt; 2;') >= 0, 'isi blok kode di-escape');
  assert.equal(md('> kutipan'), '<blockquote><p>kutipan</p></blockquote>');
  assert.equal(md('---'), '<hr>');
});

test('renderMarkdown: idempoten dan tidak melempar pada input aneh', () => {
  const md = loadRenderer();
  const src = '# Judul\n\n- a\n\n| x |\n|---|\n| 1 |\n\n```\ncode\n```\n\n> q\n';
  assert.equal(md(src), md(src));
  for (const s of ['', '   ', '\n\n', '```\n', '|', '-', '**', '[a](', '~~~\n']) {
    assert.equal(typeof md(s), 'string');
  }
});

// ---------- live: aset yang benar-benar disajikan server ----------
test('live: halaman tersaji memuat dropdown + aset versi baru', async (t) => {
  let res;
  try { res = await fetch(BASE + '/'); } catch (e) { t.skip('server tidak terjangkau (' + BASE + '): ' + e.message); return; }
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /id="view-mode"/);
  assert.match(html, /value="md-preview"/);
  const js = await (await fetch(BASE + '/app.js')).text();
  assert.match(js, /function renderMarkdown/);
  const css = await (await fetch(BASE + '/style.css')).text();
  assert.match(css, /\.md-preview/);
});
