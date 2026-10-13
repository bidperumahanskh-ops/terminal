// Test: download di explorer — kini HANYA lewat menu klik kanan (tanpa tombol inline).
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'terminalku');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('app.js: item explorer tanpa tombol aksi inline', () => {
  const js = read('public/app.js');
  assert.ok(js.indexOf('act-download') < 0, 'tombol download inline harus dihapus');
  assert.ok(js.indexOf('act-rename') < 0, 'tombol rename inline harus dihapus');
  assert.ok(js.indexOf('act-delete') < 0, 'tombol hapus inline harus dihapus');
  assert.ok(js.indexOf('class="actions"') < 0, 'kontainer tombol aksi harus dihapus');
});

test('app.js: Download… tersedia di menu klik kanan untuk berkas', () => {
  const js = read('public/app.js');
  assert.match(js, /add\('Download…', '', \(\) => downloadItem\(it\)\)/);
  assert.match(js, /downloadItem\(/);
  assert.match(js, /contextmenu/);
});

test('app.js: downloadItem memanggil endpoint /api/fs/download', () => {
  const js = read('public/app.js');
  assert.match(js, /\/api\/fs\/download\?path=/);
  assert.match(js, /a\.download\s*=\s*it\.name/);
});
