# PRD — Terminalku (Web File Manager + Terminal VPS)

**Nama produk:** Terminalku
**Versi:** 0.1 (draf)
**Tanggal:** 2026-10-06
**Lingkungan target:** berjalan di dalam **container Docker** di VPS ini (lihat `AGENTS.md` §Eksekusi di Docker)
**Akses publik:** `https://sistem.perumskh.my.id` via **cloudflared tunnel** (reverse proxy Cloudflare)

---

## 1. Ringkasan / Tujuan

Sistem web untuk **mengelola VPS ini dari browser** dengan tiga panel utama:

1. **Panel kiri — File Explorer**: melihat struktur direktori/isi file di VPS.
2. **Panel kanan — Editor**: melihat (dan nanti mengedit) isi file.
3. **Panel bawah — Terminal**: mengontrol VPS via terminal interaktif (WebSocket).

Antar panel dipisahkan **splitter yang bisa digeser**: lebar explorer (kiri↔kanan) dan tinggi terminal (atas↔bawah) diatur user; ukuran disimpan di browser (`localStorage`, bukan server) dan klik 2x pada splitter mengembalikan ukuran default. Batas: explorer ≥160px, terminal ≥80px, area editor ≥240px lebar & ≥160px tinggi.

Tujuan: pengganti ringan akses SSH/editor lokal, bisa diakses dari mana saja lewat browser, aman, dan mudah diskalakan.

---

## 2. Persona & Use Case

| Persona | Kebutuhan |
|---|---|
| Admin VPS (Handz) | Lihat isi file, edit cepat, jalankan perintah terminal dari browser |
| (Opsional) Tim | Kolaborasi lihat file tanpa akses SSH langsung |

Use case utama:
- Browsing direktori (list, masuk/keluar folder, breadcrumb).
- Lihat isi file (syntax highlight), ukuran, izin, waktu modifikasi.
- Jalankan perintah shell interaktif (cd, ls, grep, dsb.) via terminal.
- (Fase 2) Edit & simpan file, upload/download, buat/hapus/rename.

---

## 3. Fitur

### 3.1 File Explorer (panel kiri)
- List direktori & file dengan ikon, ukuran, izin (`rwx`), pemilik, mtime.
- Navigasi breadcrumb + klik folder.
- Sortir (nama/ukuran/waktu) & filter.
- (Fase 2) CRUD file/folder, upload, download, rename, hapus (dengan konfirmasi).

### 3.2 Editor (panel kanan)
- Tampilkan isi file dengan **syntax highlighting** (CodeMirror).
- Deteksi bahasa dari ekstensi; mode baca-saja default (aman).
- (Fase 2) Edit + simpan dengan backup otomatis & diff.

### 3.3 Terminal (panel bawah)
- **Apa itu "terminal" di sini?** Ini adalah **terminal shell interaktif di dalam browser** — sama seperti jendela SSH/terminal yang biasa kamu pakai, tapi tampil di halaman web. Kamu bisa mengetik perintah (`ls`, `cd`, `grep`, `docker ps`, dsb.) dan melihat hasilnya langsung, tanpa perlu buka aplikasi SSH terpisah.
- **Cara kerja singkat:** browser menampilkan layar terminal (xterm.js) → kirim ketikan ke server lewat **WebSocket** → server menjalankan perintah di shell (node-pty) → hasil dikirim balik ke browser secara realtime.
- Mendukung resize, warna, scrollback.
- Sesi per-user, bisa dibuka/tutup.
- **Keamanan:** shell dijalankan sebagai **user terbatas (non-root)** di dalam container, bukan root host — jadi walau ada perintah berbahaya, dampaknya terbatas di sandbox.

### 3.4 Keamanan (non-fungsional wajib)
- **Autentikasi wajib** sebelum akses apa pun (login).
- **Otorisasi**: hanya user dengan peran `admin` bisa terminal & tulis; `viewer` hanya baca.
- **Sandbox terminal**: jalankan di container terpisah / user terbatas, bukan root host.
- **Rate limiting** login & API.
- **Audit log**: catat aksi (login, buka file, perintah terminal).
- **HTTPS** di belakang reverse proxy (nginx/cloudflared).
- **CSRF + session** aman; token API untuk integrasi.
- **Jangan pernah** mengekspos `.env`, kredensial, atau path sensitif (`/root`, `.ssh`, `.env`) tanpa izin eksplisit.

---

## 4. Stack Teknologi (ringan · modern · scalable)

Prinsip: **ringan** (beban rendah), **modern**, **scalable** (mudah ditambah instance), **SQLite** untuk data ringan.

| Lapisan | Pilihan | Alasan |
|---|---|---|
| Runtime | **Node.js 22+** (tersedia di host) | event-driven, cocok WebSocket terminal, ekosistem besar |
| Web framework | **Fastify** | ringan, cepat, plugin-based, scalable |
| Terminal | **xterm.js** (frontend) + **node-pty** (backend) | terminal interaktif standar |
| Editor | **CodeMirror 6** | ringan, syntax highlight, modern |
| Frontend | **Vanilla JS / Alpine.js** + Tailwind CSS | tanpa framework berat, cepat |
| Database | **SQLite** (via `better-sqlite3`) | ringan, tanpa server, cukup untuk sesi/log/audit |
| Realtime | **WebSocket** (ws / @fastify/websocket) | terminal + notifikasi |
| Auth | **Session cookie** + bcrypt (via `bcryptjs`/`argon2`) | sederhana & aman |
| Reverse proxy | **cloudflared tunnel** → `sistem.perumskh.my.id` | TLS otomatis + akses eksternal tanpa buka port |

> **Catatan SQLite**: cocok untuk data ringan (user, sesi, audit log). Bila nanti butuh multi-instance tulis, migrasi ke Postgres — desain akses DB lewat satu modul agar mudah diganti.

---

## 5. Arsitektur

```
Browser (xterm.js + CodeMirror + Alpine)
        │  HTTPS (TLS Cloudflare)
        ▼
cloudflared tunnel ──► sistem.perumskh.my.id
        │
        ▼
Fastify server (Node)  ──► SQLite (better-sqlite3)
   │        │
   │        └──► node-pty ──► shell (sandbox user)
   └──► REST API (file list, read) + WebSocket (terminal)
```

- **Satu proses Node** menangani REST + WebSocket (hemat resource).
- **Terminal** dijalankan sebagai **user non-root** (sandbox) di dalam container.
- **File system** diakses via mount volume ke container (bukan langsung host root).

---

## 6. Model Data (SQLite)

| Tabel | Kolom utama | Keterangan |
|---|---|---|
| `users` | id, username, password_hash, role, created_at | role: `admin`/`viewer` |
| `sessions` | id, user_id, token, expires_at | sesi login |
| `audit_logs` | id, user_id, action, target, ip, created_at | jejak aksi |
| `settings` | key, value | konfigurasi ringan |

---

## 7. API (ringkas)

| Method | Path | Fungsi | Auth |
|---|---|---|---|
| POST | `/api/auth/login` | login | - |
| POST | `/api/auth/logout` | logout | ✓ |
| GET | `/api/fs/list?path=` | list direktori | ✓ |
| GET | `/api/fs/read?path=` | isi file | ✓ |
| WS | `/api/terminal` | sesi terminal | ✓ |
| GET | `/api/me` | info user | ✓ |

---

## 8. Keamanan (detail)

1. **Login**: bcrypt/argon2 hash, rate-limit (mis. 5 gagal/15 mnt), lockout sementara.
2. **Session**: cookie `HttpOnly` + `Secure` + `SameSite=Strict`, expiry pendek, rotasi token.
3. **Otorisasi**: middleware per-route; `viewer` tak bisa terminal/tulis.
4. **Path traversal**: validasi & normalisasi path; blokir `..`, symlink keluar root, path sensitif.
5. **Terminal sandbox**: jalankan shell sebagai user terbatas (bukan root), batasi resource (CPU/mem/timeout), log semua perintah.
6. **Audit**: semua aksi sensitif tercatat di `audit_logs`.
7. **Transport**: wajib HTTPS via **cloudflared tunnel** (TLS Cloudflare otomatis); tolak HTTP.
8. **Dependency**: audit rutin (`npm audit`), image Docker minimal & di-scan.

---

## 9. Non-Fungsional

- **Performa**: list direktori < 200ms; terminal latency rendah.
- **Scalability**: stateless (session di DB) → bisa multi-instance di belakang LB; WebSocket sticky session.
- **Portabilitas**: berjalan di Docker, path via env var, tanpa hardcode host.
- **Ringan**: idle RAM target < 150MB; tanpa DB server eksternal.

---

## 10. Roadmap

| Fase | Isi |
|---|---|
| **Fase 1 (MVP)** | Login, file explorer (list+read), editor read-only, terminal interaktif, audit log |
| **Fase 2** | Edit+simpan (backup+diff), upload/download, CRUD file/folder, multi-user viewer |
| **Fase 3** | Multi-instance, integrasi cloudflared penuh, notifikasi realtime, tema |

---

## 11. Kriteria Penerimaan (Fase 1)

- [ ] Login berhasil & gagal (rate-limit) teruji.
- [ ] File explorer menampilkan isi direktori dengan benar.
- [ ] Editor menampilkan isi file dengan syntax highlight.
- [ ] Terminal interaktif berfungsi (perintah, resize, output).
- [ ] User `viewer` **tidak** bisa akses terminal/tulis.
- [ ] Path traversal & path sensitif diblokir.
- [ ] Semua aksi tercatat di audit log.
- [ ] Berjalan di Docker, portabel, tanpa hardcode path host.
- [ ] Test otomatis di `~/terminal/test/` hijau (lihat `AGENTS.md` §Testing).

---

## 12. Keputusan Terbuka

- ~~Nama produk~~ → **Terminalku** ✓
- ~~Reverse proxy~~ → **cloudflared tunnel** → `sistem.perumskh.my.id` ✓
- ~~Sandbox terminal~~ → **user terbatas (non-root) di dalam container** ✓
- ~~Editor~~ → **baca-saja dulu di Fase 1** ✓

---

## 13. Status Implementasi (2026-10-06)

**Fase 1 (MVP) + Fase 2 SELESAI** — berjalan lokal di `http://localhost:8364` (belum publik).

| Item | Status |
|---|---|
| Login **password saja** + rate-limit per IP + lockout | ✅ teruji |
| File explorer (list, ukuran, izin, mtime) | ✅ teruji |
| Editor + syntax highlight (CodeMirror) | ✅ teruji |
| **Edit + simpan file (backup otomatis `.bak-<ts>`)** | ✅ teruji |
| **Upload + download file** | ✅ teruji |
| **CRUD file/folder (buat, rename, hapus)** | ✅ teruji |
| Terminal interaktif (xterm.js + node-pty, WebSocket) | ✅ teruji |
| Role admin vs viewer (viewer baca-saja) | ✅ (backend) |
| Anti path traversal + blokir path sensitif | ✅ teruji |
| Audit log (login, fs, terminal) | ✅ teruji |
| Docker (multi-stage, Alpine, user non-root) | ✅ |
| Test otomatis `~/terminal/test/` | ✅ 23/23 pass, idempoten |
| RAM idle | ✅ ~26 MiB |

**Catatan implementasi:**
- Lokasi: `~/terminal/terminalku/` (bukan repo git).
- Akses file via volume mount: `/home/adminsipuruh:/host/home` (**rw** untuk edit Fase 2), `/etc:/host/etc:ro`, `/var/log:/host/var/log:ro`.
- `FS_ROOT=/host/home` → hanya home user yang bisa dijelajah.
- Terminal berjalan sebagai user container (UID 1001 = adminsipuruh), bukan root.
- Login: **password saja** (tanpa username) — user admin pertama.
- Kredensial default: password `terminalku123` (wajib ganti sebelum publik).

**Langkah berikutnya (Fase 3):**
1. Ganti password admin + `SESSION_SECRET` di `.env`.
2. Publik via cloudflared → `sistem.perumskh.my.id`.
