# AGENTS.md — Workspace `~/terminal`

Workspace pribadi di `/home/adminsipuruh/terminal`. Folder ini untuk file kerja temp/catatan/script sekali-jalan milik Handz.

## Batas Kerja (WAJIB)

1. **Tulis/ubah/hapus file HANYA di dalam `~/terminal/`.** Membaca di luar folder (repo `~/new_sipuruh`, docs, sistem) untuk konteks diperbolehkan; menulis/mengubah/menghapus di luar **dilarang** tanpa izin eksplisit user.
2. Folder ini **sudah repo git** (sejak 2026-10-13), remote `origin` = `https://github.com/bidperumahanskh-ops/terminal` (branch `main`). Commit/push **hanya atas perintah eksplisit user**; jangan sentuh repo lain.
   - **JANGAN pernah commit/push kredensial**: `terminalku/.env`, `terminalku/data2/*.db*` (hash admin + audit log). Dijaga `.gitignore` root + `terminalku/.gitignore`. Audit staged sebelum commit: `git diff --cached | grep -nE '\$2[aby]\$|PRIVATE KEY|ghp_|github_pat_|AKIA'`.
   - **Berkas `.bak-*` dilacak**: `docker-compose.yml.bak-20261008-130906` (versi compose lama tanpa `privileged`) sengaja di-commit sebagai jejak riwayat, lewat negasi `!` di `terminalku/.gitignore`. Berkas `.bak` **lain** tetap diabaikan.
   - Identitas git repo ini: `adminsipuruh <adminsipuruh@sipuruh.sukoharjokab.go.id>` (samakan dengan repo lain).
   - Fakta artefak: `terminalku/node_modules/` **tidak ada di host** (dependensi dibangun di dalam image Docker, tidak pernah masuk repo); `terminalku/data/` kosong (DB runtime memakai `data2/`). Jangan laporkan keduanya sebagai "sengaja tidak di-push".
   - Test aturan ini: `node --test test/gitignore.test.mjs` (idempoten).
3. **Jangan** baca/tampilkan `.env` atau kredensial apa pun; jangan jalankan perintah yang mengubah sistem/produksi tanpa persetujuan.
4. Perintah read-only (ls, df, jalankan script di folder ini) aman tanpa izin.

## Verifikasi Deploy vs Host (WAJIB sebelum bilang "sudah ter-deploy")

Jangan asumsikan `docker compose up -d --build` memuat semua perubahan. Buktikan:

```bash
cd ~/terminal/terminalku
# 1. berkas yang di-COPY ke image, host vs container (harus sama)
find server public -type f -exec md5sum {} \; | sort -k2 | md5sum
docker exec terminalku sh -c 'cd /app && find server public -type f -exec md5sum {} \; | sort -k2 | md5sum'
# 2. config compose
docker compose config --hash='*'
docker inspect terminalku --format '{{index .Config.Labels "com.docker.compose.config-hash"}}'
# 3. berkas yang benar-benar di-serve
curl -s http://100.97.161.68:8364/app.js | md5sum   # banding md5sum public/app.js
# 4. kepemilikan berkas (jangan ada sisa root-owned dari `docker run` tanpa --user)
find ~/terminal/terminalku -not -user "$(id -u)" -not -path '*/.git/*'
```

Temuan 2026-10-13: tidak ada drift, tetapi ditemukan **env mati**:

| Env | Status |
|---|---|
| `TERM_SHELL`, `TERM_USER`, `TERM_CWD` | Dideklarasikan di `server/config.js` tapi **tak pernah dibaca** `routes-terminal.js` (user & dir home ter-hardcode). Mengubahnya di `.env` tidak berefek. |
| `SESSION_SECRET` | **Mati-desain**: token sesi = `crypto.randomBytes(32)` acak disimpan di tabel sesi SQLite (opaque token), tidak ada yang ditandatangani. Aman, tapi jangan dianggap pengaman. |

Dijaga test `test/config-usage.test.mjs` (`KNOWN_DEAD` + alasan). Bila salah satu kunci itu mulai dipakai, test gagal dan README wajib diperbarui.

**Temuan lain (2026-10-13):**

- `./data/` (root repo) **milik `root:root`**, kosong, dan **tidak dipakai** — compose memetakan `./data2` → `/app/data`. Sisa dari dulu; butuh `sudo` untuk hapus. Jangan bingungkan dengan `data2/` yang aktif.
- Container berjalan sebagai **uid 0 (root)**, tapi `PUID=1001`/`PGID=1001` di `.env` membuat berkas `data2/*.db*` tetap milik `1001:1001`. Tidak ada sisa berkas root-owned di repo.
- Perubahan `public/` **wajib rebuild** (`docker compose up -d --build`), bukan `restart`.

## Gaya Kerja (Hemat Token)

- Jawaban singkat, teknis, Bahasa Indonesia; angka/nilai langsung tanpa prosa berlebih.
- Batch tool call independen dalam satu blok; jangan ulangi panggilan identik.
- `search_files` dulu, baru `read_file` rentang kecil (±40–150 baris); jangan baca file utuh.
- Jangan dump isi file/log panjang ke chat; ringkas hasil terminal.

## Stack (terbaru · teringan · teraman)

- Utamakan **stdlib** + shell: host punya Python 3.12.3, PHP 8.3.6, Node **18.19.1** (`node -v`; jangan asumsikan >=22 di host — image container memakai Node 22). **Jangan** tambah dependensi berat bila beberapa baris cukup.
- Semua file temp/uji/catatan disimpan di folder ini (folder ini memang untuk itu).
- Jangan hapus file di `~/terminal/` tanpa izin user.

## Eksekusi di Docker (WAJIB)

- Script/uji di folder ini **nanti dijalankan di dalam container Docker**, bukan langsung di host.
- Saat menulis script, pastikan **portabel lintas container**: jangan hardcode path host (`/home/adminsipuruh/...`), gunakan path relatif atau env var; jangan asumsikan user/group host.
- Bila script butuh akses file host, siapkan **volume mount** (`-v`) — jangan menulis ke dalam container tanpa mount.
- Jangan asumsikan tool terpasang di container; cek ketersediaan (`command -v`) atau dokumentasikan dependensi yang perlu di-`apt`/`pip`/`npm` saat build image.
- Uji di container sekali-pakai dengan `--rm` + `--user "$(id -u):$(id -g)"` bila menulis ke volume, agar tidak meninggalkan berkas root-owned.

## Testing (WAJIB)

- **Setiap selesai perintah/pekerjaan, wajib dilakukan test pada sistem** sebelum dianggap selesai — verifikasi hasil benar-benar berfungsi, bukan hanya "tidak error".
- Tempatkan semua file test di folder **`~/terminal/test/`** (buat bila belum ada).
- File test di `~/terminal/test/` **dipakai berulang** — **JANGAN hapus** file di folder `test/` tanpa izin eksplisit user (berbeda dari file temp lain yang boleh dibersihkan).
- Test harus bisa dijalankan ulang (idempoten/re-runnable) dan portabel di dalam container Docker (lihat §Eksekusi di Docker).
- Laporkan hasil test singkat: perintah yang dijalankan + status (pass/fail).
- **Jebakan shell**: jangan kirim kode inline lewat `node -e "..."` dari terminal — `!`, `` ` ``, dan `$` di-expand shell (history expansion bisa menyisipkan perintah lama dan membuat terminal menggantung di prompt `>`). Tulis ke file (heredoc `<<'EOF'`) lalu jalankan `node file.js`.

## Pemeliharaan

- Update `AGENTS.md` ini + skill `terminalku-ops` (`~/.botadmin/skill/terminalku-ops/SKILL.md`) pada sesi yang sama bila aturan/stack/prosedur berubah.

## Proyek: Terminalku (`~/terminal/terminalku/`)

- Web File Manager + Terminal VPS (Fastify + SQLite + xterm.js). PRD: `~/terminal/PRD.md`.
- **Keputusan akses: Tailscale** (bukan cloudflared) — panduan ada di `~/terminal/INSTALASI-TAILSCALE.md`. Status: **terpasang & aktif** (`/usr/bin/tailscale`, IP `100.97.161.68`, iface `tailscale0`).
- **Port host 8364** (container listen `3000`); compose bind hanya ke IP Tailscale: `100.97.161.68:8364:3000` (tidak terekspos publik). Jalankan: `cd ~/terminal/terminalku && docker compose up -d --build`.
- **Login password saja** (tanpa username). Password default: `terminalku123` (di `.env`, wajib ganti sebelum publik).
- **Mount aktif (privileged, akses host penuh)**: `pid: host` + `privileged: true`; `/:/host:rw` + `/var/run/docker.sock:/var/run/docker.sock`; `/home/adminsipuruh` rw (dua kali: `/home/adminsipuruh` dan `/host/home`); `/etc:/host/etc:ro`; `/var/log:/host/var/log:ro`; `./data2:/app/data` → `FS_ROOT=/host/home`, `TERM_CWD=/host/home`.
- Shell terminal spawn via `nsenter -t 1 -m -u -i -n -p -- /bin/su - adminsipuruh` → masuk namespace host (sudo/tailscale/docker/systemctl langsung tersedia).
- `docker-compose.yml.bak-20261008-130906` = versi lama tanpa `pid: host`/`privileged`/`/:/host` — jangan dipakai.
- **Jebakan yang sudah ditemukan** (jangan diulang):
  - `UID`/`GID` adalah variabel readonly bash → pakai `PUID`/`PGID` di `.env`.
  - `.env` tanpa newline akhir → `printf >>` menempel ke baris terakhir.
  - Container listen di port dari `.env` (`PORT`) → compose harus override `PORT: "3000"` karena map `8364:3000`; jangan andalkan nilai `PORT` di `.env`.
  - node-gyp di Alpine butuh `NODE_OPTIONS=--no-network-family-autoselection` (timeout IPv6).
  - Folder volume yang dibuat container root-owned → buat folder baru milik user (mis. `data2`).
  - Rate-limit login (5 gagal/15 mnt per IP) bisa mengunci test → reset DB (`rm data2/terminalku.db*`) bila perlu.
  - **POST body JSON wajib header `Content-Type: application/json`** — tanpa itu Fastify tak parse body → `req.body` undefined → 403.
  - **Jebakan DOM**: `e.target` tidak selalu `Element` (mis. `keydown`/`click` yang menyasar `document`) → `e.target.closest(...)` melempar `TypeError`. Pakai guard `asElement()` di `public/app.js`.
  - **E2E yang butuh dependensi server** (mis. `test-paste-live.mjs`): host tidak punya `node_modules`, jadi jalankan di container sekali-pakai — `docker run --rm --user "$(id -u):$(id -g)" -v ~/terminal/test:/t:ro -w /app terminalku-terminalku:latest node /t/test-paste-live.mjs`. Password admin & `FS_ROOT`/`DB_PATH` di-set lewat env test (tidak membaca `.env`).
  - **Test `node --test` menjalankan describe paralel** → jangan pisah state cookie antar describe; gabung jadi satu describe.
  - `prompt()`/`confirm()` tidak didukung browser embedded → pakai modal custom (`#modal`).
  - Password admin hanya dibaca saat **seed DB pertama** → ubah `.env` tak berlaku kecuali reset DB (`rm data2/terminalku.db*`) **dan** recreate container (`docker compose up -d --force-recreate`; `restart` tidak reload env).
- Test: `node --test test/` (23 test, butuh server jalan). File test di `test/` **jangan dihapus**.
- Test workspace di `~/terminal/test/` (di luar `terminalku/`), format `.mjs` (ESM; folder ini tanpa `"type": "module"`). Statis + re-runnable, **jangan dihapus**.
- Terminal UI: scrollback 10000, tombol `⇕` (`btn-term-size`) toggle tinggi panel `.tall` = 60vh. Perubahan `public/` **harus rebuild image** (`docker compose up -d --build`), bukan restart.
- **Dropdown format tampilan** (`#view-mode`, kanan atas panel file, elemen terakhir `.panel-head`): `text` (Text Editor) / `md-preview` (Markdown Preview) / `md-editor` (Markdown Editor). Opsi markdown di-`disabled` untuk berkas non-`.md/.markdown/.mdx`; `state.viewMode` direset ke `text` saat berkas non-markdown dibuka.
- Renderer markdown mini ada di `public/app.js` dalam blok berpenanda `// ---------- Markdown renderer (mini, tanpa dependensi) ----------` … `// ---------- akhir markdown renderer ----------`; blok ini diekstrak & diuji `~/terminal/test/test-view-mode.mjs` (jangan ubah penanda). Tanpa dependensi eksternal (tanpa `marked`); teks di-escape dulu, URL non-`http(s)/mailto//#/relatif` ditolak (anti-XSS).
- **Jebakan**: `public/app.js` ditulis dalam satu IIFE — dua `function` bernama sama akan saling menimpa (hoisting, deklarasi terakhir menang). Jangan pakai nama yang sudah ada (mis. `renderList` milik explorer); renderer markdown memakai `renderMdList`.
- **Tab editor multi-berkas** (`#tabs`, elemen pertama `#editor-panel`, di atas `.panel-head`): tiap tab = satu `CodeMirror.Doc` di `state.tabs`, `id` = path, `state.activeTab` = id tab aktif; pindah tab via `editor.swapDoc(tab.doc)`. Buka berkas yang sudah punya tab → fokus ke tab itu (isi belum tersimpan tidak hilang).
- **Indikator belum disimpan**: `tab.savedContent` (isi terakhir tersimpan di server) dibandingkan dengan `tab.doc.getValue()` oleh `isTabDirty()`; tab dirty dapat class `.dirty` → nama italic + tombol tutup berubah jadi `●` (`.i-dot`), dan kembali `✕` (`.i-x`) saat hover. Undo sampai isi semula otomatis menghapus tanda.
- **TIDAK ada autosave** (keputusan user): perubahan di editor hanya menandai dirty; menulis ke server **hanya** lewat `saveFile()` (tombol Simpan / Ctrl+S) untuk tab aktif. `/api/fs/write` hanya boleh dipanggil di satu tempat — dijaga `test/test-tabs.mjs`.
- Menutup tab yang dirty perlu konfirmasi modal; `beforeunload` memperingatkan bila masih ada tab dirty. `clearEditor()` dipakai saat tab terakhir ditutup.
- **Jebakan tab**: event `change` CodeMirror bersifat **deferred** (menyala pada tick berikutnya) dan `swapDoc()` **tidak** menembakkan `change`; `doc.setValue()` ber-origin `'setValue'` → harus diabaikan agar membuka berkas tidak dianggap dirty. Jangan saring `renderTabs()` dengan tab aktif, karena tab yang ditinggalkan sebelum event menyala tidak akan ter-tandai. `renderTabs()` hanya menyinkronkan class bila susunan tab sama; `rebuildTabs()` membangun ulang DOM.
- Opsi dropdown format tampilan disimpan **per tab** (`tab.viewMode`), bukan global.
- **Verifikasi E2E tanpa kredensial**: di browser, ganti `window.fetch` + `window.WebSocket` dengan stub (admin palsu, `/api/fs/list|read|write` palsu) lalu submit `#login-form` dengan password dummy → alur tab/dirty/simpan bisa diuji penuh tanpa membaca `.env` dan tanpa menulis ke server. Uji statis+VM ada di `test/test-view-mode.mjs` & `test/test-tabs.mjs`.
- **Explorer tanpa tombol inline**: item berkas/folder di `#file-list` tidak punya tombol aksi; semua modifikasi lewat **menu klik kanan** (`#ctx-menu`, `openCtxMenu(x, y, it)`). Berkas: Cut · Copy · Paste · Download… · Copy Path · Copy Relative Path · Rename… · Delete Permanently. Folder menambah New File… · New Folder… di paling atas (tanpa Download — backend menolak unduh direktori). Klik kanan area kosong = menu folder yang sedang dibuka (New File…/New Folder…/Paste/Copy Path).
- **Clipboard berkas** (`state.clipboard = { path, mode: 'copy'|'move' }`) hanya di memori browser, bukan clipboard OS. Item yang di-Cut diredupkan (`.file-item.cut`), Paste otomatis `disabled` bila clipboard kosong; setelah Paste mode `move` clipboard dikosongkan. Pintasan Ctrl+C/X/V, F2, Del hanya aktif bila fokus **tidak** di editor/terminal/input.
- **Backend paste** `POST /api/fs/paste { src, destDir, mode }` (admin): **tidak pernah menimpa** — `uniqueTarget()` memberi akhiran ` copy`, ` copy 2` (pola VS Code). Menolak: folder ke dalam dirinya sendiri, move ke folder yang sama, path di luar `FS_ROOT`, path terblokir, `mode` tak dikenal. Move lintas perangkat jatuh ke salin+lalu-hapus (EXDEV).
- **Rename/Hapus menyesuaikan tab**: `renameOpenTab()` memindahkan tab terbuka ke path baru (kalau tidak, Simpan akan membuat ulang berkas lama); `removeTabSilently()` menutup tab berkas/folder yang dihapus.
- **Bug yang pernah ada**: `openFile()` cabang pertama (saat CodeMirror baru dibuat) tidak memanggil `setValue()` → berkas pertama yang dibuka tampil kosong. Sekarang `setValue(data.content)` dipanggil di luar cabang.