# Terminalku — Web File Manager + Terminal VPS

Akses file VPS, editor kode, dan terminal interaktif langsung dari browser.
Fastify + SQLite + xterm.js, dijalankan sebagai container Docker.

> Kode aplikasi ada di `terminalku/`. File test di `test/` (statis, **jangan dihapus**).

---

## Panduan Deploy di Device / Host Baru

Ikuti berurutan. Ganti semua nilai bertanda `<...>` sesuai mesin tujuan.

### 0. Prasyarat

| Kebutuhan | Cek | Catatan |
|---|---|---|
| Docker + Compose v2 | `docker compose version` | Wajib |
| Git | `git --version` | Untuk clone |
| User non-root di grup `docker` | `groups \| grep docker` | Tanpa `sudo` untuk compose |
| Node.js (opsional) | `node -v` | Hanya untuk menjalankan test di host; build image memakai Node 22 internal |
| Tailscale (opsional) | `tailscale ip -4` | Bila ingin akses privat antar-device |

> Akses VPS ini memakai **Tailscale**, bukan cloudflared. Panduan lengkap: `INSTALASI-TAILSCALE.md`.

### 1. Ambil kode

```bash
git clone https://github.com/bidperumahanskh-ops/terminal.git
cd terminal/terminalku
```

### 2. Buat file `.env`

`.env` **tidak ikut repo** (berisi rahasia). Buat dari contoh:

```bash
cp .env.example .env
```

Isi nilai wajib (jangan pakai default contoh):

| Variabel | Isi |
|---|---|
| `ADMIN_PASSWORD` | Password admin (dipakai saat seed DB pertama kali) |
| `FS_ROOT` | Root file yang boleh dijelajahi web, mis. `/host/home` |
| `DB_PATH` | Default `./data/terminalku.db` (di dalam container) |

> **`SESSION_SECRET` TIDAK DIPAKAI.** Token sesi dibuat dari `crypto.randomBytes(32)` acak dan disimpan di tabel sesi SQLite (opaque token) — tidak ada nilai yang ditandatangani, jadi mengubah `SESSION_SECRET` tidak berpengaruh apa pun. Aman untuk dibiarkan, tapi jangan diandalkan sebagai pengaman.
>
> **`TERM_USER` / `TERM_CWD` / `TERM_SHELL` TIDAK DIPAKAI** — masih dideklarasikan di `server/config.js` tapi tidak dibaca `routes-terminal.js` (user & direktori shell ter-hardcode). Ganti user terminal lewat langkah 4.

Nilai lain yang biasanya perlu disesuaikan:

| Variabel | Isi |
|---|---|
| `HOST` | Interface listen. `0.0.0.0` wajib agar terjangkau via Tailscale/LAN |
| `PORT` | Port **di dalam container**; compose meng-override ke `3000` karena map host `8364:3000` — jangan andalkan nilai di `.env` |
| `FS_BLOCK` | Path sensitif yang diblokir (koma). Contoh: `/root,.ssh,.env,id_rsa,node_modules,.git` |
| `SESSION_TTL_HOURS` | Umur sesi login (default `8`) |
| `LOGIN_MAX_FAIL` / `LOGIN_LOCK_MIN` | Rate-limit login: gagal → lock menit (default `5` / `15`) |
| `TERM_MAX_SESSIONS` | Batas sesi terminal bersamaan (default `5`) |
| `PUID` / `PGID` | UID/GID host untuk volume data (jangan pakai `UID`/`GID` — readonly) |
| `ADMIN_USERNAME` / `ADMIN_ROLE` | Kredensial & role admin awal (`admin` / `admin`) |

> Password admin **hanya dibaca saat seed DB pertama**. Ubah `.env` setelahnya tidak berlaku kecuali reset DB (lihat Jebakan).

### 3. Sesuaikan `docker-compose.yml`

Tiga hal yang **berbeda di setiap host** dan harus disunting:

**a. Path home host** — ganti `adminsipuruh` dengan user host baru:

```yaml
volumes:
  - /home/<USER>:/home/<USER>
  - /home/<USER>:/host/home
```

**b. Bind port** — default bind ke IP Tailscale tertentu. Ganti dengan IP Tailscale host baru (`tailscale ip -4`), atau `0.0.0.0` bila sengaja mengekspos:

```yaml
ports:
  - "<IP_TAILSCALE_HOST>:8364:3000"   # host 8364 -> container 3000
```

**c. User/UID volume data** — bila perlu, set `PUID`/`PGID` di `.env` agar `./data2` dimiliki user host. **Catatan: `UID`/`GID` adalah variabel readonly bash — wajib pakai `PUID`/`PGID`.**

> Container sengaja `pid: host` + `privileged: true` dengan mount `/:/host` dan `/var/run/docker.sock` agar terminal bisa mengendalikan host (sudo, tailscale, docker, systemctl). Ini memberi akses penuh ke host — pahami risikonya sebelum menyalakan.

### 4. Sesuaikan user shell di `server/routes-terminal.js`

Terminal spawn shell host via `nsenter` ke namespace PID 1, lalu `su` ke user host.
Empat nilai ini **hardcode** dan wajib diganti bila user host bukan `adminsipuruh`:

```js
const homeDir = '/home/<USER>';                 // baris ~15
const userPath = [ `${homeDir}/.local/bin`, ... ]; // sesuaikan PATH bila perlu
const shellArgs = [ '-t','1','-m','-u','-i','-n','-p','--','/bin/su','-','<USER>' ];
env: { ...process.env, HOME: homeDir, USER: '<USER>' }
```

### 5. Build & jalankan

```bash
cd ~/terminal/terminalku
docker compose up -d --build
```

Cek status:

```bash
docker compose ps
docker compose logs -f --tail=50
```

### 6. Verifikasi

```bash
curl -sI http://<IP_TAILSCALE_HOST>:8364/ | head -1     # harap HTTP 200
```

Lalu di browser: buka `http://<IP_TAILSCALE_HOST>:8364`, login dengan `ADMIN_PASSWORD`, pastikan:
- Panel file tampil (isi `FS_ROOT`),
- Editor bisa buka + simpan file,
- Terminal (role admin) membuka shell host.

Jalankan test integrasi (butuh server berjalan):

```bash
node --test test/                                   # dari ~/terminal (server :8364)
TERMINALKU_URL=http://<host>:<port> node --test test/   # server lain
```

### 7. Jebakan umum

| Gejala | Sebab / Solusi |
|---|---|
| Login 403 walau password benar | `POST` JSON wajib header `Content-Type: application/json`; tanpa itu Fastify tak parse body |
| Ubah `ADMIN_PASSWORD` tak berefek | Password hanya dibaca saat seed DB. Reset: `rm data2/terminalku.db*` lalu `docker compose up -d --force-recreate` (`restart` tidak reload env) |
| Terminal tak punya `sudo`/`docker` | Cek `pid: host`, `privileged: true`, mount `/:/host`, `docker.sock`, dan binary `nsenter` (paket `util-linux`) |
| Rate-limit login mengunci saat uji | 5 gagal → lock 15 menit per IP; reset DB bila perlu |
| Perubahan `public/` tak muncul | Wajib **rebuild**: `docker compose up -d --build` (bukan `restart`) |
| Timeout saat build node-gyp | Sudah ditangani `NODE_OPTIONS=--no-network-family-autoselection` di Dockerfile (hindari IPv6) |
| Folder volume jadi milik root | Buat folder data milik user host; jalankan container uji sekali-pakai dengan `--user "$(id -u):$(id -g)"` |
| Port bentrok | Ubah sisi host pada `8364` di `ports:` |

### 8. Keamanan (wajib sebelum dipakai publik)

- Ganti `ADMIN_PASSWORD` dari nilai contoh.
- Catatan: `SESSION_SECRET` **tidak dipakai** (token sesi acak di DB) — tidak perlu diisi.
- Bind port hanya ke IP Tailscale, bukan `0.0.0.0`.
- `.env`, `data/`, `data2/`, dan `node_modules/` **tidak boleh** ikut ter-commit (sudah ada di `.gitignore`).
- Audit semua aksi admin tersimpan di DB (login, buka/tutup terminal).

---

## Ringkasan arsitektur

```
terminalku/
├── server/          Backend Fastify (index, config, db, auth, fs-safe, routes-*)
├── public/          Frontend vanilla JS (app.js, index.html, style.css, vendor/)
├── test/            Test integrasi
├── Dockerfile       Node 22 bookworm-slim (glibc)
├── docker-compose.yml
└── .env.example
```

Host port **8364** → container **3000**. Data persisten di `./data2` (bind mount).

Dokumen lain: `PRD.md` (produk), `INSTALASI-TAILSCALE.md` (akses jarak jauh), `AGENTS.md` (aturan kerja repo).
