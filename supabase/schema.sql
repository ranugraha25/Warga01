-- ============================================================
-- Skema database "Buku Warga RT 01"
-- Jalankan seluruh file ini di Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

-- 1. Kartu Keluarga (KK) / rumah
create table if not exists families (
  id bigserial primary key,
  nama text not null,
  alamat text,
  created_at timestamptz default now()
);

-- 2. Warga
create table if not exists residents (
  id bigserial primary key,
  nama text not null,
  nik text not null,
  tgl_lahir date,
  alamat text,
  status text,               -- 'Kepala Keluarga' | 'Istri' | 'Anak' | 'Lainnya'
  hp text,                   -- nomor HP, opsional (untuk fitur reminder via WhatsApp)
  kk_id bigint references families(id) on delete set null,
  created_at timestamptz default now()
);

-- 3. Jenis iuran (bisa ditambah admin kapan saja, termasuk yang sifatnya sementara)
create table if not exists iuran_types (
  id bigserial primary key,
  nama text not null,
  nominal numeric,
  temporary boolean default false,
  created_at timestamptz default now()
);

-- 4. Status pembayaran iuran per KK per periode (per bulan)
create table if not exists payments (
  id bigserial primary key,
  kk_id bigint references families(id) on delete cascade,
  iuran_id bigint references iuran_types(id) on delete cascade,
  periode text not null,     -- format 'YYYY-MM'
  lunas boolean default false,
  tanggal date,
  unique (kk_id, iuran_id, periode)
);

-- 5. Log reminder & broadcast yang pernah dikirim
create table if not exists reminders (
  id bigserial primary key,
  type text not null,        -- 'reminder' | 'broadcast'
  target text,                -- nama warga atau ringkasan target
  target_id bigint,
  message text not null,
  waktu timestamptz default now()
);

-- ============================================================
-- Row Level Security
-- ============================================================
-- PENTING: kunci "anon public key" di aplikasi frontend SELALU bisa dilihat
-- siapa pun yang membuka source/network tab website kamu. Policy di bawah ini
-- mengizinkan siapa saja yang punya anon key untuk baca & tulis data
-- (termasuk NIK warga). Ini cocok untuk pemakaian internal/terbatas
-- (link tidak disebar publik). Kalau aplikasi ini akan diakses banyak orang
-- atau di-deploy publik, tambahkan Supabase Auth (login pengurus RT) dan ganti
-- policy "using (true)" di bawah menjadi "using (auth.uid() is not null)".

alter table families enable row level security;
alter table residents enable row level security;
alter table iuran_types enable row level security;
alter table payments enable row level security;
alter table reminders enable row level security;

create policy "allow all - families" on families for all using (true) with check (true);
create policy "allow all - residents" on residents for all using (true) with check (true);
create policy "allow all - iuran_types" on iuran_types for all using (true) with check (true);
create policy "allow all - payments" on payments for all using (true) with check (true);
create policy "allow all - reminders" on reminders for all using (true) with check (true);
