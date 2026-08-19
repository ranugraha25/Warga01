# Buku Warga · RT 01

Aplikasi web untuk pendataan warga, kartu keluarga (KK), status iuran, reminder, dan broadcast informasi RT 01. Dibangun dengan **Vite + React**, database **Supabase** (gratis).

## 1. Buat project Supabase (gratis)

1. Daftar/login di https://supabase.com
2. Klik **New Project** → pilih nama, password database, region (pilih yang terdekat, mis. Singapore) → tunggu ±2 menit sampai project selesai dibuat.
3. Di sidebar kiri, buka **SQL Editor** → **New query**.
4. Buka file [`supabase/schema.sql`](./supabase/schema.sql) di project ini, copy semua isinya, paste ke SQL Editor, lalu klik **Run**.
   - Ini akan membuat 5 tabel: `residents`, `families`, `iuran_types`, `payments`, `reminders`.
5. Buka **Project Settings** (ikon gear) → **API**. Catat dua nilai ini:
   - **Project URL**
   - **anon public** key

## 2. Setup project di komputer kamu

Butuh [Node.js](https://nodejs.org) (versi 18 ke atas) sudah terinstall.

```bash
# masuk ke folder project
cd rt01-app

# copy file environment lalu isi dengan kredensial Supabase kamu
cp .env.example .env
```

Buka `.env`, isi seperti ini (pakai punya kamu sendiri, bukan contoh ini):

```
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Lalu install dependencies dan jalankan:

```bash
npm install
npm run dev
```

Buka `http://localhost:5173` di browser — aplikasi sudah jalan dan tersambung ke database Supabase kamu.

> Tidak perlu Live Server VS Code untuk project ini — `npm run dev` sudah menjalankan dev server sendiri (Vite), lengkap dengan hot-reload.

## 3. Setup Login & Role (RT / Dev / Warga)

Aplikasi ini sekarang butuh login. Ada 3 role:

| Role | Boleh apa |
|---|---|
| **RT** | Semua fitur |
| **Dev** | Semua fitur |
| **Warga** | Cuma lihat data warga & status iuran (read-only) + bikin broadcast. Tidak bisa tambah/edit/hapus apa pun, tidak bisa kirim reminder perorangan. |

### 3.1 Jalankan migration SQL

1. Buka **SQL Editor** di Supabase (project yang sama, yang `schema.sql`-nya sudah jalan sebelumnya).
2. Buka file [`supabase/002_auth_roles.sql`](./supabase/002_auth_roles.sql), copy semua isinya, paste, **Run**.
   - Ini membuat tabel `profiles` (nama + role tiap user) dan mengganti aturan akses lama ("bebas semua") jadi berbasis role.

### 3.2 Matikan pendaftaran akun bebas

Supaya orang lain tidak bisa daftar sendiri lewat API:
1. Supabase Dashboard → **Authentication** → **Providers** (atau **Sign In / Providers**, tergantung versi UI) → **Email**.
2. Cari opsi semacam **"Allow new users to sign up"** dan **matikan**.

### 3.3 Deploy Edge Function "create-user"

Ini fungsi khusus yang dipakai fitur "Tambah User" (biar cuma RT/Dev yang bisa bikin akun baru). Butuh [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
# install CLI (Mac, pakai Homebrew)
brew install supabase/tap/supabase

# login ke akun Supabase kamu
supabase login

# hubungkan folder project ini ke project Supabase kamu
# project-ref bisa dilihat di Project Settings > General, atau di URL dashboard
cd rt01-app
supabase link --project-ref xxxxxxxxxxxx

# deploy function-nya
supabase functions deploy create-user
```

Tidak perlu setting API key manual — `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` otomatis tersedia di Edge Function.

### 3.4 Bikin akun pertama (bootstrap)

Karena fitur "Tambah User" cuma bisa dipakai user yang **sudah** RT/Dev, akun pertama harus dibuat manual sekali saja:

1. Supabase Dashboard → **Authentication** → **Users** → **Add user** → isi email & password, centang **Auto Confirm User**.
2. Copy **User UID** akun yang baru dibuat itu.
3. Ke **Table Editor** → tabel `profiles` → **Insert row**:
   - `id` = User UID yang di-copy tadi
   - `nama` = nama kamu
   - `role` = `dev` (atau `rt`)
4. Selesai. Login ke aplikasi pakai email & password itu — setelah ini, akun-akun lain (RT/Dev/Warga) tinggal dibuat lewat menu **Kelola User** di dalam aplikasi, tidak perlu lagi utak-atik dashboard Supabase.

## 4. Deploy supaya bisa diakses pengurus RT lain (opsional)

Paling gampang pakai [Vercel](https://vercel.com) atau [Netlify](https://netlify.com) — gratis:

1. Push folder ini ke GitHub.
2. Import repo di Vercel/Netlify.
3. Di pengaturan **Environment Variables**, tambahkan `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` (isi sama seperti di `.env`).
4. Deploy.

## ⚠️ Catatan keamanan (penting, karena ada data NIK)

Setelah migration `002_auth_roles.sql` dijalankan, akses ke data sudah dibatasi berbasis login + role (bukan lagi "bebas semua"). Yang perlu tetap diperhatikan:

- Password sementara yang dibuat lewat **Kelola User** dikirim manual (chat/WA) ke orangnya — sarankan mereka ganti password lewat menu **Forgot Password** Supabase Auth kalau mau, atau kamu bisa reset manual lewat dashboard.
- Kunci **anon public key** Supabase memang selalu terlihat di source code browser (ini normal & memang begitu desainnya) — keamanan sebenarnya ada di **Row Level Security** yang sudah diatur lewat migration tadi, bukan di menyembunyikan key ini.
- Jangan pernah taruh **service role key** di file `.env` frontend atau di kode React manapun — itu cuma boleh dipakai di Edge Function (server-side), yang sudah diatur otomatis oleh Supabase.

## Struktur folder

```
rt01-app/
├── index.html
├── package.json
├── vite.config.js
├── .env.example              ← copy jadi .env dan isi kredensial Supabase
├── supabase/
│   ├── schema.sql             ← jalankan pertama kali (skema awal)
│   ├── 002_auth_roles.sql     ← jalankan setelahnya (login & role)
│   └── functions/
│       └── create-user/       ← Edge Function untuk fitur "Tambah User"
└── src/
    ├── main.jsx
    ├── App.jsx                 ← seluruh UI & logic aplikasi
    ├── supabaseClient.js
    ├── useAuth.js               ← hook session & profil login
    ├── Login.jsx                ← halaman login
    └── ManageUsers.jsx          ← form tambah user (tab "Kelola User")
```

## Fitur

- **Login & Role**: RT & Dev punya akses penuh; Warga cuma bisa lihat data + bikin broadcast.
- **Data Warga**: tambah/edit/hapus warga (nama, NIK, ID otomatis, tanggal lahir, alamat, status, no. HP opsional), cari, export ke Excel. (Warga: lihat saja)
- **KK & Iuran**: kelompokkan warga jadi satu KK per rumah, tambah jenis iuran baru (termasuk yang sifatnya sementara), tandai lunas/belum per KK per bulan, export status iuran ke Excel. (Warga: lihat saja)
- **Reminder** (khusus RT/Dev): pilih warga tertentu, tulis pesan, tercatat di riwayat + tombol buka WhatsApp langsung (kalau no. HP tersimpan).
- **Broadcast** (semua role): kirim info ke seluruh warga sekaligus, tercatat di riwayat lengkap dengan nama & role pengirim.
- **Kelola User** (khusus RT/Dev): tambah akun baru (RT/Dev/Warga) langsung dari aplikasi.

Catatan: reminder & broadcast di sini mencatat pesan + membuka link WhatsApp manual per warga, bukan pengiriman otomatis. Untuk pengiriman otomatis/terjadwal, perlu integrasi WhatsApp Business API (mis. Fonnte, Twilio) — bisa ditambahkan belakangan.
