// Deteksi env yang dideklarasikan di config.js tapi tidak pernah dibaca kode.
// Re-runnable, tanpa dependensi. Jalankan: node --test test/config-usage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, '..', 'terminalku', 'server');

const read = (p) => readFileSync(p, 'utf8');
const sources = readdirSync(SERVER)
  .filter((f) => f.endsWith('.js'))
  .map((f) => ({ file: f, code: read(path.join(SERVER, f)) }));

// Kunci yang dideklarasikan di blok `export const config = { ... }`
const configSrc = read(path.join(SERVER, 'config.js'));
const block = configSrc.slice(configSrc.indexOf('export const config = {'));
const declaredKeys = [...block.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*):/gm)]
  .map((m) => m[1]);

// Kunci yang diketahui mati — didokumentasikan, bukan bug tersembunyi.
// 'tak-dipakai'      : dideklarasikan tapi tidak pernah dibaca kode.
// 'mati-desain'      : sengaja tidak dipakai; aman, tapi jangan diandalkan user.
const KNOWN_DEAD = new Map([
  ['termShell', 'tak-dipakai'],
  ['termUser', 'tak-dipakai'],
  ['termCwd', 'tak-dipakai'],
  // Token sesi = crypto.randomBytes(32) acak yang disimpan di DB (opaque token),
  // jadi tidak ada yang perlu ditandatangani dengan SESSION_SECRET.
  ['sessionSecret', 'mati-desain'],
]);

test('config.js mendeklarasikan kunci konfigurasi', () => {
  assert.ok(declaredKeys.length >= 10,
    `hanya ${declaredKeys.length} kunci terdeteksi di config.js`);
});

test('setiap kunci config dipakai di kode server/ (atau terdaftar sebagai mati)', () => {
  const unused = [];
  for (const key of declaredKeys) {
    const used = sources.some(({ file, code }) =>
      file !== 'config.js' && new RegExp(`config\\.${key}\\b`).test(code));
    if (!used && !KNOWN_DEAD.has(key)) unused.push(key);
  }
  assert.deepEqual(unused, [],
    `kunci config dideklarasikan tapi tak dipakai: ${unused.join(', ')}. `
    + 'Pakai di kode, hapus dari config.js, atau daftarkan di KNOWN_DEAD.');
});

test('env mati tetap terdaftar (agar tidak diam-diam dianggap berfungsi)', () => {
  for (const [key, reason] of KNOWN_DEAD) {
    const used = sources.some(({ file, code }) =>
      file !== 'config.js' && new RegExp(`config\\.${key}\\b`).test(code));
    assert.equal(used, false,
      `config.${key} kini DIPAKAI — hapus dari KNOWN_DEAD dan perbarui README`);
    assert.ok(declaredKeys.includes(key), `config.${key} tidak ada di config.js`);
    assert.ok(['tak-dipakai', 'mati-desain'].includes(reason),
      `alasan tidak dikenal untuk ${key}: ${reason}`);
  }
});

test('README menandai SESSION_SECRET sebagai tidak dipakai', () => {
  const readme = read(path.resolve(HERE, '..', 'README.md'));
  assert.match(readme, /SESSION_SECRET/,
    'README tidak menyebut SESSION_SECRET sama sekali');
  assert.match(readme, /SESSION_SECRET.{0,300}TIDAK (DIPAKAI|DIPERLUKAN)/s,
    'README tidak menjelaskan bahwa SESSION_SECRET tidak dipakai');
});

test('README memperingatkan env terminal yang tidak dipakai', () => {
  const readme = read(path.resolve(HERE, '..', 'README.md'));
  assert.match(readme, /TERM_USER.{0,120}TIDAK DIPAKAI/s,
    'README tidak memperingatkan bahwa TERM_USER/TERM_CWD/TERM_SHELL tidak dipakai');
});

test('README tidak lagi menyuruh mengubah TERM_USER/TERM_CWD sebagai langkah aktif', () => {
  const readme = read(path.resolve(HERE, '..', 'README.md'));
  const rows = readme.split('\n').filter((l) =>
    /^\|\s*`TERM_(USER|CWD|SHELL)`\s*\|/.test(l));
  assert.deepEqual(rows, [],
    `README masih punya baris tabel env yang menyesatkan: ${rows.join(' | ')}`);
});

test('README tidak menaruh SESSION_SECRET sebagai baris env wajib diisi', () => {
  const readme = read(path.resolve(HERE, '..', 'README.md'));
  const rows = readme.split('\n').filter((l) =>
    /^\|\s*`SESSION_SECRET`\s*\|/.test(l) && !/TIDAK DIPAKAI/.test(l));
  assert.deepEqual(rows, [],
    `README masih menyuruh mengisi SESSION_SECRET: ${rows.join(' | ')}`);
});
