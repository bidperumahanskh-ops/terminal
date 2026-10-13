// Keamanan filesystem: normalisasi path, cegah traversal, blokir path sensitif.
import path from 'node:path';
import { config } from './config.js';

// Normalisasi + pastikan path berada dalam FS_ROOT (bila ditetapkan).
// Mengembalikan path absolut aman, atau null bila dilarang.
export function safeResolve(input) {
  if (typeof input !== 'string' || input.length === 0) return null;
  const abs = path.resolve(input);
  if (config.fsRoot) {
    const root = path.resolve(config.fsRoot);
    if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  }
  return abs;
}

// Cek apakah path (atau salah satu segmennya) masuk daftar blokir.
export function isBlocked(abs) {
  const parts = abs.split(path.sep).filter(Boolean);
  for (const part of parts) {
    if (config.fsBlock.includes(part)) return true;
  }
  return false;
}

// Validasi lengkap: aman + tidak diblokir. Return { ok, abs?, reason? }
export function checkPath(input) {
  const abs = safeResolve(input);
  if (!abs) return { ok: false, reason: 'path di luar area yang diizinkan' };
  if (isBlocked(abs)) return { ok: false, reason: 'path diblokir (sensitif)' };
  return { ok: true, abs };
}