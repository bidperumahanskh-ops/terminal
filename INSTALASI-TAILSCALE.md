# Panduan Instalasi Tailscale untuk Terminalku

> Dokumen prosedur — bisa dieksekusi dari komputer lain (via SSH / VS Code Remote).
> Target: VPS Ubuntu 20.04, user `adminsipuruh`, proyek di `~/terminal/terminalku/`.
> Tanggal: 2026-10-06

## Status saat ini

| Item | Status |
|---|---|
| Terminalku (Fase 1+2) | ✅ berjalan lokal `http://localhost:8364` |
| Tailscale | ❌ **belum terpasang** |
| Cloudflare | dibatalkan (keputusan: pakai Tailscale) |

---

## Langkah 1 — Instal Tailscale di VPS

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

> Butuh `sudo` — masukkan password saat diminta.

Verifikasi:

```bash
tailscale version
```

## Langkah 2 — Login Tailscale (sekalinya)

```bash
sudo tailscale up
```

Output akan menampilkan **URL login** (mis. `https://login.tailscale.com/a/xxxx`).
Buka URL itu di browser mana saja → login dengan akun (Google/GitHub/email).

Setelah login, ambil IP Tailscale VPS:

```bash
tailscale ip -4
# contoh output: 100.64.x.x  ← CATAT IP INI
```

> Opsional — beri nama mesin agar mudah:
> ```bash
> sudo tailscale up --hostname=sipuruh-vps
> ```
> Nanti bisa diakses via `http://sipuruh-vps:8364` dari device dalam tailnet.

## Langkah 3 — Bind Terminalku ke semua interface (agar terjangkau via Tailscale)

Terminalku sudah listen di `0.0.0.0` (cek `.env` → `HOST=0.0.0.0`), jadi **tidak perlu ubah kode**. Verifikasi:

```bash
grep '^HOST' ~/terminal/terminalku/.env
# harus: HOST=0.0.0.0
```

Jika belum, ubah lalu restart container (lihat Langkah 4).

## Langkah 4 — Restart Terminalku (bila ada perubahan .env)

```bash
cd ~/terminal/terminalku
docker compose up -d
```

## Langkah 5 — Install Tailscale di device yang akan dipakai

Install client Tailscale di laptop/HP yang akan mengakses:

| Device | Cara |
|---|---|
| Windows/Mac | Unduh dari https://tailscale.com/download, install, login akun yang sama |
| Linux | `curl -fsSL https://tailscale.com/install.sh | sh` lalu `sudo tailscale up` |
| Android/iOS | Aplikasi Tailscale di Play Store/App Store, login akun yang sama |

## Langkah 6 — Akses Terminalku via Tailscale

Dari device yang sudah join tailnet:

```
http://<IP_TAILSCALE_VPS>:8364
# atau (jika pakai --hostname):
http://sipuruh-vps:8364
```

Login dengan password dari `~/terminal/terminalku/.env` (variabel `ADMIN_PASSWORD`).

---

## Hardening (disarankan, opsional)

### Hanya terima koneksi dari tailnet

Buat firewall rule agar port 8364 hanya diakses dari interface Tailscale:

```bash
# Cek interface tailscale (biasanya tailscale0)
ip addr | grep -A2 tailscale0

# Contoh ufw: blok 8364 dari luar, izinkan dari subnet tailnet (100.64.0.0/10)
sudo ufw deny 8364/tcp
sudo ufw allow from 100.64.0.0/10 to any port 8364 proto tcp
```

### Matikan key expiry (agar VPS tidak terputus)

Di https://login.tailscale.com/admin/machines → cari mesin VPS → ⋯ → **Disable key expiry**.

---

## Checklist akhir

- [ ] `tailscale version` jalan di VPS
- [ ] `tailscale status` = connected, IP `100.64.x.x` tercatat
- [ ] `HOST=0.0.0.0` di `.env`, container restart
- [ ] Client Tailscale terpasang di device pribadi
- [ ] Akses `http://<ip-tailscale>:8364` → halaman login Terminalku muncul
- [ ] (Opsional) UFW membatasi 8364 hanya dari tailnet
- [ ] (Opsional) Key expiry dimatikan di admin console

## Catatan penting

- **Jangan buka port 8364 di router/publik** — akses hanya lewat tailnet.
- `.env` berisi password — jangan commit/dibagikan.
- Bila IP Tailscale berubah (jarang), update bookmark/URL akses.
- Setelah selesai setup, update `~/terminal/AGENTS.md` §Proyek Terminalku (ubah "berjalan lokal" → "akses via Tailscale").
