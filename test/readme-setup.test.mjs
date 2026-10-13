// Verifikasi README.md root repo konsisten dengan kondisi nyata proyek.
// Re-runnable, tanpa dependensi. Jalankan: node --test test/readme-setup.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const APP = path.join(REPO, 'terminalku');

const read = (p) => readFileSync(p, 'utf8');
const README = read(path.join(REPO, 'README.md'));

test('README.md ada di root repo dan tidak kosong', () => {
  assert.ok(existsSync(path.join(REPO, 'README.md')));
  assert.ok(README.length > 2000, 'README terlalu pendek untuk panduan deploy');
});

test('README memuat semua bagian panduan wajib', () => {
  for (const heading of [
    'Panduan Deploy di Device / Host Baru',
    'Prasyarat',
    'Buat file `.env`',
    'Sesuaikan `docker-compose.yml`',
    'Sesuaikan user shell di `server/routes-terminal.js`',
    'Build & jalankan',
    'Verifikasi',
    'Jebakan umum',
    'Keamanan',
  ]) {
    assert.ok(README.includes(heading), `bagian hilang: ${heading}`);
  }
});

test('berkas yang dirujuk README benar-benar ada', () => {
  for (const rel of [
    'terminalku/.env.example',
    'terminalku/docker-compose.yml',
    'terminalku/server/routes-terminal.js',
    'terminalku/server/config.js',
    'PRD.md',
    'INSTALASI-TAILSCALE.md',
    'AGENTS.md',
  ]) {
    assert.ok(existsSync(path.join(REPO, rel)), `berkas tidak ada: ${rel}`);
  }
});

test('setiap variabel env di README ada di .env.example', () => {
  const example = read(path.join(APP, '.env.example'));
  const keys = new Set(
    example.split('\n')
      .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=/))
      .filter(Boolean)
      .map((m) => m[1]),
  );
  for (const key of [
    'SESSION_SECRET', 'ADMIN_PASSWORD', 'FS_ROOT', 'DB_PATH',
    'TERM_USER', 'TERM_CWD', 'PORT', 'HOST', 'FS_BLOCK',
  ]) {
    assert.ok(keys.has(key), `env tidak ada di .env.example: ${key}`);
    assert.ok(README.includes(key), `env tidak disebut README: ${key}`);
  }
});

test('klaim hardcode di README cocok dengan routes-terminal.js', () => {
  const src = read(path.join(APP, 'server', 'routes-terminal.js'));
  assert.ok(/const homeDir = '\/home\//.test(src), 'homeDir tidak ter-hardcode');
  assert.ok(/'\/bin\/su'/.test(src), "spawn 'su' tidak ada");
  assert.ok(/USER: '[a-z]+'/.test(src), 'env USER tidak ter-set');
  assert.ok(src.includes('nsenter'), 'nsenter tidak dipakai');
});

test('README tidak membocorkan nilai kredensial nyata', () => {
  // Nilai rahasia harus tetap placeholder, bukan string acak/hex panjang.
  const secretLines = README.split('\n')
    .filter((l) => /(SESSION_SECRET|ADMIN_PASSWORD)\s*=/.test(l));
  for (const line of secretLines) {
    assert.ok(/<|contoh|placeholder|openssl rand|ganti/i.test(line),
      `baris berpotensi membocorkan rahasia: ${line.trim()}`);
    assert.ok(!/[0-9a-f]{32,}/i.test(line), `hex panjang di README: ${line.trim()}`);
  }
  // Tidak ada hash bcrypt yang ter-embed.
  assert.ok(!/\$2[aby]\$\d\d\$/.test(README), 'README memuat hash bcrypt');
});

test('README mengingatkan risiko privileged/akses host penuh', () => {
  assert.ok(README.includes('privileged'), 'risiko privileged tidak disebut');
  assert.ok(/docker\.sock/.test(README), 'mount docker.sock tidak disebut');
});
