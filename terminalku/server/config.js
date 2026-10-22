// Konfigurasi terpusat — semua nilai dari env dengan default aman.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Muat .env sederhana (tanpa dependensi) bila ada
try {
  const envFile = readFileSync(path.join(ROOT, '.env'), 'utf8');
  for (const line of envFile.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* .env opsional */ }

const env = (k, d) => process.env[k] ?? d;
const envInt = (k, d) => { const v = parseInt(env(k, ''), 10); return Number.isFinite(v) ? v : d; };

export const config = {
  root: ROOT,
  port: envInt('PORT', 3000),
  host: env('HOST', '0.0.0.0'),
  sessionSecret: env('SESSION_SECRET', 'dev-secret-ganti'),
  sessionTtlHours: envInt('SESSION_TTL_HOURS', 8),
  loginMaxFail: envInt('LOGIN_MAX_FAIL', 5),
  loginLockMin: envInt('LOGIN_LOCK_MIN', 15),
  fsRoot: env('FS_ROOT', ''), // '' = seluruh filesystem
  // TIDAK ADA blokir path (keputusan admin: file manager boleh membuka semua berkas di bawah
  // FS_ROOT). Tidak memakai env sama sekali — jangan tambah kunci di .env untuk ini.
  // `isBlocked()` di fs-safe.js tetap ada sebagai kait, tetapi selalu false selama daftar kosong.
  fsBlock: [],
  termShell: env('TERM_SHELL', '/bin/bash'),
  termUser: env('TERM_USER', 'node'),
  termCwd: env('TERM_CWD', '/home/node'),
  termMaxSessions: envInt('TERM_MAX_SESSIONS', 5),
  dbPath: path.resolve(ROOT, env('DB_PATH', './data/terminalku.db')),
  adminUsername: env('ADMIN_USERNAME', 'admin'),
  adminPassword: env('ADMIN_PASSWORD', 'admin'),
  adminRole: env('ADMIN_ROLE', 'admin'),
};