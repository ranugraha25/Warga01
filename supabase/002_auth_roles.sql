-- ============================================================
-- Migration: Login & Role (RT, Dev, Warga)
-- Jalankan ini di SQL Editor Supabase (project yang schema.sql lamanya
-- sudah pernah dijalankan). Aman dijalankan ulang kalau perlu.
-- ============================================================

-- 1. Tabel profil user: menyimpan nama & role, terhubung ke akun login
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nama text not null,
  role text not null check (role in ('rt','dev','warga')),
  created_at timestamptz default now()
);

alter table profiles enable row level security;

-- 2. Fungsi bantu: ambil role user yang sedang login (dipakai di semua policy)
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid()
$$;

-- 3. Tambah kolom "siapa yang mengirim" di tabel reminders (untuk broadcast)
alter table reminders add column if not exists created_by_id uuid references auth.users(id);
alter table reminders add column if not exists created_by_name text;
alter table reminders add column if not exists created_by_role text;

-- 4. Buang policy lama yang "bebas akses" (dari schema.sql awal)
drop policy if exists "allow all - families" on families;
drop policy if exists "allow all - residents" on residents;
drop policy if exists "allow all - iuran_types" on iuran_types;
drop policy if exists "allow all - payments" on payments;
drop policy if exists "allow all - reminders" on reminders;

-- 5. Policy baru berbasis role
-- Semua yang sudah login boleh MELIHAT data warga/KK/iuran.
-- Hanya role 'rt' dan 'dev' yang boleh tambah/ubah/hapus.
create policy "select - residents" on residents for select using (auth.uid() is not null);
create policy "insert - residents" on residents for insert with check (current_user_role() in ('rt','dev'));
create policy "update - residents" on residents for update using (current_user_role() in ('rt','dev'));
create policy "delete - residents" on residents for delete using (current_user_role() in ('rt','dev'));

create policy "select - families" on families for select using (auth.uid() is not null);
create policy "insert - families" on families for insert with check (current_user_role() in ('rt','dev'));
create policy "update - families" on families for update using (current_user_role() in ('rt','dev'));
create policy "delete - families" on families for delete using (current_user_role() in ('rt','dev'));

create policy "select - iuran_types" on iuran_types for select using (auth.uid() is not null);
create policy "insert - iuran_types" on iuran_types for insert with check (current_user_role() in ('rt','dev'));
create policy "update - iuran_types" on iuran_types for update using (current_user_role() in ('rt','dev'));
create policy "delete - iuran_types" on iuran_types for delete using (current_user_role() in ('rt','dev'));

create policy "select - payments" on payments for select using (auth.uid() is not null);
create policy "insert - payments" on payments for insert with check (current_user_role() in ('rt','dev'));
create policy "update - payments" on payments for update using (current_user_role() in ('rt','dev'));

-- reminders: SEMUA role yang login boleh bikin broadcast.
-- Reminder perorangan tetap cuma boleh rt/dev.
create policy "select - reminders" on reminders for select using (auth.uid() is not null);
create policy "insert - reminders" on reminders for insert with check (
  auth.uid() is not null and (
    type = 'broadcast'
    or (type = 'reminder' and current_user_role() in ('rt','dev'))
  )
);

-- profiles: user boleh lihat profil sendiri; rt/dev boleh lihat semua user.
-- Insert user baru SENGAJA tidak dibuka lewat policy biasa — hanya lewat
-- Edge Function "create-user" (pakai service role key), supaya cuma rt/dev
-- yang bisa membuat akun baru.
create policy "select - profiles" on profiles for select using (
  id = auth.uid() or current_user_role() in ('rt','dev')
);
create policy "update - profiles" on profiles for update using (
  current_user_role() in ('rt','dev')
);
create policy "delete - profiles" on profiles for delete using (
  current_user_role() in ('rt','dev')
);
