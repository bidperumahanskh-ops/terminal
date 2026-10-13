// Verifikasi aturan .gitignore: rahasia tak pernah bisa ter-commit.
// Re-runnable, tanpa dependensi jaringan. Jalankan: node --test test/gitignore.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const git = (...args) => {
  try {
    return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
};

test('repositori git valid dengan remote origin', () => {
  assert.match(git('rev-parse', '--is-inside-work-tree'), /true/);
  assert.match(git('remote', 'get-url', 'origin'),
    /github\.com\/bidperumahanskh-ops\/terminal/);
});

test('berkas rahasia WAJIB ter-ignore', () => {
  for (const rel of [
    'terminalku/.env',
    'terminalku/data2/terminalku.db',
    'terminalku/data2/terminalku.db-wal',
    'terminalku/node_modules/fastify/package.json',
  ]) {
    assert.ok(git('check-ignore', rel).trim().length > 0,
      `TIDAK ter-ignore (BAHAYA): ${rel}`);
  }
});

test('.env.example WAJIB tetap bisa di-commit', () => {
  assert.equal(git('check-ignore', 'terminalku/.env.example').trim(), '',
    '.env.example seharusnya tidak ter-ignore');
});

test('jejak versi compose lama (.bak) sengaja dilacak', () => {
  const bak = 'terminalku/docker-compose.yml.bak-20261008-130906';
  // Negasi (!) membuat berkas ini lolos; check-ignore mengembalikan baris negasi.
  const out = git('check-ignore', '-v', bak);
  assert.match(out, /^!|:!/, `negasi tidak berlaku untuk ${bak}`);
});

test('tidak ada berkas sensitif yang ter-track di git', () => {
  const tracked = git('ls-files').split('\n').filter(Boolean);
  const bad = tracked.filter((f) =>
    /(^|\/)\.env(\.|$)/.test(f) && !/\.env\.example$/.test(f)
    || /\.db(-shm|-wal)?$/.test(f)
    || /node_modules\//.test(f));
  assert.deepEqual(bad, [], `berkas sensitif ter-track: ${bad.join(', ')}`);
});

test('isi berkas .bak tidak memuat kredensial', () => {
  const bak = 'terminalku/docker-compose.yml.bak-20261008-130906';
  const content = git('show', `HEAD:${bak}`);
  if (content.trim() === '') return; // belum di-commit pada run pertama
  assert.doesNotMatch(content, /\$2[aby]\$\d\d\$|PRIVATE KEY|ghp_|github_pat_/);
});
