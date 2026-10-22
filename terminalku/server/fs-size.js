// Ukuran folder & kapasitas disk — murni, tanpa dependensi eksternal.
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Batas aman agar pemindaian tidak menggantung pada pohon direktori raksasa.
const MAX_ENTRIES = 200_000;   // total entri yang dipindai
const MAX_MS = 10_000;         // batas waktu (ms)
const MAX_DEPTH = 40;          // kedalaman maksimum

// Jumlahkan ukuran seluruh berkas di bawah `root` (rekursif).
// Mengembalikan { size, files, dirs, truncated, reason? }.
export async function dirSize(root, opts = {}) {
  const maxEntries = opts.maxEntries ?? MAX_ENTRIES;
  const maxMs = opts.maxMs ?? MAX_MS;
  const maxDepth = opts.maxDepth ?? MAX_DEPTH;
  const started = Date.now();

  let size = 0, files = 0, dirs = 0, seen = 0, truncated = false, reason;
  const stack = [{ dir: root, depth: 0 }];

  while (stack.length) {
    if (seen >= maxEntries) { truncated = true; reason = 'batas entri'; break; }
    if (Date.now() - started > maxMs) { truncated = true; reason = 'batas waktu'; break; }

    const { dir, depth } = stack.pop();
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { continue; } // direktori tak terbaca (izin) — lewati

    for (const ent of entries) {
      if (seen++ >= maxEntries) { truncated = true; reason = 'batas entri'; break; }
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (depth + 1 > maxDepth) { truncated = true; reason = 'batas kedalaman'; continue; }
        dirs++;
        stack.push({ dir: full, depth: depth + 1 });
      } else if (ent.isFile()) {
        try {
          const st = await fs.lstat(full);
          if (st.isFile()) { size += st.size; files++; }
        } catch { /* berkas hilang saat dipindai */ }
      }
    }
  }

  return { size, files, dirs, truncated, ...(reason ? { reason } : {}) };
}

// Kapasitas disk tempat `p` berada (dipakai untuk indikator pemakaian).
// Memakai `bfree` untuk `used` (agar cocok dengan `df`) dan `bavail` untuk `free`
// (ruang yang benar-benar bisa dipakai user non-root — blok reserved root beda).
export async function diskUsage(p) {
  const st = await fs.statfs(p);
  const total = st.blocks * st.bsize;
  const free = st.bavail * st.bsize;      // tersedia untuk user non-root
  const freeAll = st.bfree * st.bsize;    // bebas termasuk blok reserved root
  const used = total - freeAll;           // konvensi df
  return {
    total, free, used, freeAll,
    percent: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
  };
}
