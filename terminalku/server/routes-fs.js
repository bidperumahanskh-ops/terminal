// Rute filesystem: list, baca, tulis (backup+diff), upload, download, CRUD.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { checkPath } from './fs-safe.js';
import { audit } from './auth.js';
import { config } from './config.js';
import { dirSize, diskUsage } from './fs-size.js';

const MAX_READ = 2 * 1024 * 1024; // 2 MB batas baca file
const MAX_UPLOAD = 50 * 1024 * 1024; // 50 MB batas upload

// Role yang boleh tulis (admin). Viewer hanya baca.
const canWrite = (user) => user.role === 'admin';

// Backup file sebelum ditimpa: DIHAPUS (keputusan admin) — Simpan menimpa langsung,
// tidak meninggalkan `<file>.bak-<timestamp>` di folder kerja.

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

// Nama tujuan unik agar tidak menimpa berkas/folder yang sudah ada.
// File: "a.txt" → "a copy.txt" → "a copy 2.txt" … (pola VS Code)
// Folder: "src" → "src copy" → "src copy 2" …
async function uniqueTarget(dir, base) {
  const direct = path.join(dir, base);
  if (!(await exists(direct))) return direct;
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  for (let i = 1; i < 1000; i++) {
    const candidate = path.join(dir, `${stem} copy${i > 1 ? ` ${i}` : ''}${ext}`);
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error('tidak bisa menemukan nama tujuan yang bebas');
}

export function fsRoutes(app) {
  // Info root yang diizinkan (untuk frontend mulai dari sini)
  app.get('/api/fs/root', async (req) => {
    return { ok: true, root: config.fsRoot || '/' };
  });

  app.get('/api/fs/list', async (req, reply) => {
    const p = req.query.path ?? '/';
    const { ok, abs, reason } = checkPath(p);
    if (!ok) return reply.code(403).send({ error: reason });

    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch (e) {
      return reply.code(400).send({ error: `tidak bisa membaca direktori: ${e.code ?? e.message}` });
    }

    const items = await Promise.all(entries.map(async (ent) => {
      const full = path.join(abs, ent.name);
      let stat = null;
      try { stat = await fs.stat(full); } catch { /* symlink rusak dsb */ }
      return {
        name: ent.name,
        type: ent.isDirectory() ? 'dir' : 'file',
        size: stat?.size ?? 0,
        mode: stat ? (stat.mode & 0o777).toString(8) : '',
        mtime: stat?.mtimeMs ?? 0,
      };
    }));

    items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    audit(req.user.id, 'fs.list', abs, req.ip);
    return { ok: true, path: abs, items };
  });

  // Ukuran rekursif satu folder (dipanggil lazy oleh UI, bukan saat listing).
  app.get('/api/fs/size', async (req, reply) => {
    const p = req.query.path ?? '';
    const { ok, abs, reason } = checkPath(p);
    if (!ok) return reply.code(403).send({ error: reason });

    let stat;
    try { stat = await fs.stat(abs); }
    catch (e) { return reply.code(400).send({ error: `tidak ditemukan: ${e.code ?? e.message}` }); }
    if (!stat.isDirectory()) return reply.code(400).send({ error: 'bukan direktori' });

    try {
      const r = await dirSize(abs);
      audit(req.user.id, 'fs.size', abs, req.ip);
      return { ok: true, path: abs, ...r };
    } catch (e) {
      return reply.code(500).send({ error: `gagal menghitung ukuran: ${e.message}` });
    }
  });

  // Kapasitas disk tempat FS_ROOT berada (untuk indikator pemakaian).
  app.get('/api/fs/usage', async (req, reply) => {
    const base = config.fsRoot || '/host';
    try {
      const u = await diskUsage(base);
      return { ok: true, path: base, ...u };
    } catch (e) {
      return reply.code(500).send({ error: `gagal membaca kapasitas: ${e.message}` });
    }
  });

  app.get('/api/fs/read', async (req, reply) => {
    const p = req.query.path ?? '';
    const { ok, abs, reason } = checkPath(p);
    if (!ok) return reply.code(403).send({ error: reason });

    let stat;
    try { stat = await fs.stat(abs); } catch (e) { return reply.code(400).send({ error: `file tidak ditemukan: ${e.code ?? e.message}` }); }
    if (stat.isDirectory()) return reply.code(400).send({ error: 'ini direktori, bukan file' });
    if (stat.size > MAX_READ) return reply.code(413).send({ error: `file terlalu besar (>${MAX_READ / 1024 / 1024} MB)` });

    let content;
    try { content = await fs.readFile(abs, 'utf8'); } catch (e) { return reply.code(400).send({ error: `tidak bisa membaca file: ${e.code ?? e.message}` }); }

    audit(req.user.id, 'fs.read', abs, req.ip);
    return { ok: true, path: abs, name: path.basename(abs), size: stat.size, content };
  });

  // ---- Tulis (admin) ----
  app.post('/api/fs/write', async (req, reply) => {
    if (!canWrite(req.user)) return reply.code(403).send({ error: 'butuh role admin' });
    const { path: p, content } = req.body ?? {};
    const { ok, abs, reason } = checkPath(p);
    if (!ok) return reply.code(403).send({ error: reason });
    if (typeof content !== 'string') return reply.code(400).send({ error: 'content wajib string' });

    let stat = null;
    try { stat = await fs.stat(abs); } catch { /* file baru */ }
    if (stat?.isDirectory()) return reply.code(400).send({ error: 'ini direktori' });

    // Tidak ada backup berkas (keputusan admin): simpan langsung menimpa.
    try {
      await fs.writeFile(abs, content, 'utf8');
    } catch (e) {
      return reply.code(400).send({ error: `tidak bisa menulis: ${e.code ?? e.message}` });
    }
    audit(req.user.id, 'fs.write', abs, req.ip);
    return { ok: true, path: abs };
  });

  // ---- Upload (admin) ----
  app.post('/api/fs/upload', async (req, reply) => {
    if (!canWrite(req.user)) return reply.code(403).send({ error: 'butuh role admin' });
    const { path: p, name, content } = req.body ?? {};
    const { ok, abs, reason } = checkPath(p);
    if (!ok) return reply.code(403).send({ error: reason });
    if (typeof name !== 'string' || !name || name.includes('/') || name.includes('..')) {
      return reply.code(400).send({ error: 'nama file tidak valid' });
    }
    if (typeof content !== 'string') return reply.code(400).send({ error: 'content wajib string' });
    if (Buffer.byteLength(content, 'utf8') > MAX_UPLOAD) return reply.code(413).send({ error: 'file terlalu besar' });

    const target = path.join(abs, name);
    const chk = checkPath(target);
    if (!chk.ok) return reply.code(403).send({ error: chk.reason });

    try {
      await fs.writeFile(target, content, 'utf8');
    } catch (e) {
      return reply.code(400).send({ error: `tidak bisa upload: ${e.code ?? e.message}` });
    }
    audit(req.user.id, 'fs.upload', target, req.ip);
    return { ok: true, path: target };
  });

  // ---- Download (semua role) ----
  app.get('/api/fs/download', async (req, reply) => {
    const p = req.query.path ?? '';
    const { ok, abs, reason } = checkPath(p);
    if (!ok) return reply.code(403).send({ error: reason });

    let stat;
    try { stat = await fs.stat(abs); } catch (e) { return reply.code(400).send({ error: `file tidak ditemukan: ${e.code ?? e.message}` }); }
    if (stat.isDirectory()) return reply.code(400).send({ error: 'ini direktori' });

    audit(req.user.id, 'fs.download', abs, req.ip);
    return reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(path.basename(abs))}"`)
      .send(await fs.readFile(abs));
  });

  // ---- Buat file/folder (admin) ----
  app.post('/api/fs/create', async (req, reply) => {
    if (!canWrite(req.user)) return reply.code(403).send({ error: 'butuh role admin' });
    const { path: p, name, type } = req.body ?? {};
    const { ok, abs, reason } = checkPath(p);
    if (!ok) return reply.code(403).send({ error: reason });
    if (typeof name !== 'string' || !name || name.includes('/') || name.includes('..')) {
      return reply.code(400).send({ error: 'nama tidak valid' });
    }
    const target = path.join(abs, name);
    const chk = checkPath(target);
    if (!chk.ok) return reply.code(403).send({ error: chk.reason });

    try {
      if (type === 'dir') await fs.mkdir(target);
      else await fs.writeFile(target, '', 'utf8');
    } catch (e) {
      return reply.code(400).send({ error: `tidak bisa membuat: ${e.code ?? e.message}` });
    }
    audit(req.user.id, `fs.create.${type === 'dir' ? 'dir' : 'file'}`, target, req.ip);
    return { ok: true, path: target };
  });

  // ---- Rename (admin) ----
  app.post('/api/fs/rename', async (req, reply) => {
    if (!canWrite(req.user)) return reply.code(403).send({ error: 'butuh role admin' });
    const { path: p, newName } = req.body ?? {};
    const { ok, abs, reason } = checkPath(p);
    if (!ok) return reply.code(403).send({ error: reason });
    if (typeof newName !== 'string' || !newName || newName.includes('/') || newName.includes('..')) {
      return reply.code(400).send({ error: 'nama baru tidak valid' });
    }
    const target = path.join(path.dirname(abs), newName);
    const chk = checkPath(target);
    if (!chk.ok) return reply.code(403).send({ error: chk.reason });

    try {
      await fs.rename(abs, target);
    } catch (e) {
      return reply.code(400).send({ error: `tidak bisa rename: ${e.code ?? e.message}` });
    }
    audit(req.user.id, 'fs.rename', `${abs} → ${target}`, req.ip);
    return { ok: true, path: target };
  });

  // ---- Paste: salin/pindah ke folder tujuan (admin) ----
  // Dipakai oleh menu klik kanan (Cut/Copy lalu Paste). Tidak pernah menimpa:
  // bila nama sudah ada, tujuan diberi akhiran " copy".
  app.post('/api/fs/paste', async (req, reply) => {
    if (!canWrite(req.user)) return reply.code(403).send({ error: 'butuh role admin' });
    const { src, destDir, mode } = req.body ?? {};
    if (mode !== 'copy' && mode !== 'move') return reply.code(400).send({ error: "mode harus 'copy' atau 'move'" });

    const s = checkPath(src);
    if (!s.ok) return reply.code(403).send({ error: s.reason });
    const d = checkPath(destDir);
    if (!d.ok) return reply.code(403).send({ error: d.reason });

    let stat;
    try { stat = await fs.stat(s.abs); } catch (e) { return reply.code(400).send({ error: `sumber tidak ditemukan: ${e.code ?? e.message}` }); }
    let destStat;
    try { destStat = await fs.stat(d.abs); } catch (e) { return reply.code(400).send({ error: `folder tujuan tidak ditemukan: ${e.code ?? e.message}` }); }
    if (!destStat.isDirectory()) return reply.code(400).send({ error: 'tujuan bukan direktori' });

    // Cegah folder disalin/dipindah ke dalam dirinya sendiri
    if (stat.isDirectory() && (d.abs === s.abs || d.abs.startsWith(s.abs + path.sep))) {
      return reply.code(400).send({ error: 'tidak bisa memindahkan folder ke dalam dirinya sendiri' });
    }
    // Pindah ke folder yang sama = tidak ada yang berubah
    if (mode === 'move' && d.abs === path.dirname(s.abs)) {
      return reply.code(400).send({ error: 'berkas sudah berada di folder ini' });
    }

    let target;
    try { target = await uniqueTarget(d.abs, path.basename(s.abs)); }
    catch (e) { return reply.code(400).send({ error: e.message }); }
    const chk = checkPath(target);
    if (!chk.ok) return reply.code(403).send({ error: chk.reason });

    try {
      if (mode === 'copy') {
        await fs.cp(s.abs, target, { recursive: true });
      } else {
        try {
          await fs.rename(s.abs, target);
        } catch (e) {
          if (e.code !== 'EXDEV') throw e; // beda perangkat → salin lalu hapus sumber
          await fs.cp(s.abs, target, { recursive: true });
          await fs.rm(s.abs, { recursive: true, force: true });
        }
      }
    } catch (e) {
      return reply.code(400).send({ error: `gagal ${mode === 'copy' ? 'menyalin' : 'memindahkan'}: ${e.code ?? e.message}` });
    }

    audit(req.user.id, `fs.${mode}`, `${s.abs} → ${target}`, req.ip);
    return { ok: true, path: target, name: path.basename(target) };
  });

  // ---- Hapus (admin) ----
  app.post('/api/fs/delete', async (req, reply) => {
    if (!canWrite(req.user)) return reply.code(403).send({ error: 'butuh role admin' });
    const { path: p } = req.body ?? {};
    const { ok, abs, reason } = checkPath(p);
    if (!ok) return reply.code(403).send({ error: reason });

    let stat;
    try { stat = await fs.stat(abs); } catch (e) { return reply.code(400).send({ error: `tidak ditemukan: ${e.code ?? e.message}` }); }

    try {
      if (stat.isDirectory()) await fs.rm(abs, { recursive: true, force: true });
      else await fs.unlink(abs);
    } catch (e) {
      return reply.code(400).send({ error: `tidak bisa hapus: ${e.code ?? e.message}` });
    }
    audit(req.user.id, 'fs.delete', abs, req.ip);
    return { ok: true, path: abs };
  });
}
