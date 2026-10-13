# Terminalku

Web File Manager + Terminal VPS — lihat isi file VPS, editor, dan terminal interaktif dari browser.

## Fitur (Fase 1 + 2)

- 🔐 **Login password saja** dengan rate-limit per IP (5 gagal → lock 15 menit) + audit log
- 📁 **File Explorer** (panel kiri): list direktori, ukuran, izin, mtime, navigasi breadcrumb
- 📝 **Editor** (panel kanan): lihat + **edit + simpan** file dengan syntax highlighting (CodeMirror), **backup otomatis** `.bak-<timestamp>` sebelum ditimpa
- ⬆️ **Upload + download** file
- 📂 **CRUD file/folder**: buat, rename, hapus (dengan konfirmasi)
- 💻 **Terminal** (panel bawah): shell interaktif via WebSocket (xterm.js + node-pty), hanya role `admin` — scrollbar + scrollback 5000 baris, tombol `⇕` toggle tinggi panel (220px ↔ 60vh)
- 🛡️ **Keamanan**: anti path traversal, blokir path sensitif (`.env`, `.ssh`, dll), session cookie HttpOnly, sandbox user non-root, role admin vs viewer

## Stack

| Lapisan | Teknologi |
|---|---|
| Runtime | Node.js 22 (Alpine) |
| Framework | Fastify 5 |
| Terminal | xterm.js + node-pty |
| Editor | CodeMirror 5 |
| DB | SQLite (better-sqlite3) |
| Realtime | WebSocket |

## Struktur

```
terminalku/
├── server/          # Backend Fastify
│   ├── index.js     # Entry point + middleware auth
│   ├── config.js    # Konfigurasi dari env
│   ├── db.js        # SQLite + skema + seed admin
│   ├── auth.js      # Sesi + audit log
│   ├── fs-safe.js   # Validasi path (anti traversal)
│   ├── routes-auth.js
│   ├── routes-fs.js
│   └── routes-terminal.js
├── public/          # Frontend (vanilla JS)
│   ├── index.html   # Layout 3 panel
│   ├── app.js
│   ├── style.css
│   └── vendor/      # xterm.js + CodeMirror (CDN, di-commit)
├── test/            # Test integrasi (reusable, idempoten)
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## Menjalankan

```bash
cp .env.example .env   # isi SESSION_SECRET, ADMIN_PASSWORD, FS_ROOT
docker compose up -d --build
# akses: http://localhost:8364
```

### Konfigurasi penting (.env)

| Variabel | Fungsi |
|---|---|
| `PORT` | Port host (default 3000; compose override ke 3000 internal) |
| `FS_ROOT` | Root filesystem yang boleh diakses (mis. `/host/home`) |
| `FS_BLOCK` | Path sensitif yang diblokir (koma) |
| `SESSION_SECRET` | Secret sesi (wajib ganti) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | User admin awal (dibuat saat DB kosong) |
| `TERM_SHELL` / `TERM_USER` / `TERM_CWD` | Sandbox terminal |
| `PUID` / `PGID` | UID/GID host untuk volume data |

## Test

```bash
node --test test/          # butuh server berjalan di :8364
TERMINALKU_URL=http://host:port node --test test/   # server lain
```

Test reusable & idempoten — **jangan hapus** file di `test/` (lihat `AGENTS.md`).

## Keamanan

- Login: bcrypt + rate-limit + lockout
- Session: cookie HttpOnly/SameSite=Strict, expiry 8 jam
- Otorisasi: role `admin` (terminal + semua) vs `viewer` (baca saja)
- Path: normalisasi + blokir traversal + daftar sensitif
- Terminal: user non-root, max 5 sesi, audit semua perintah
- Container: `no-new-privileges`, `cap_drop: ALL`, volume baca-saja (`:ro`)

## Roadmap

- **Fase 3**: ganti password + secret, publik via cloudflared (`sistem.perumskh.my.id`), multi-instance, notifikasi realtime, tema