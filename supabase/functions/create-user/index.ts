// supabase/functions/create-user/index.ts
// Edge Function ini yang punya "hak akses admin" untuk membuat akun baru.
// Alurnya:
// 1. Cek token pemanggil (harus login) dan role-nya (harus rt atau dev).
// 2. Kalau valid, baru buat akun auth baru + baris di tabel profiles.
// Env SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY otomatis
// tersedia di runtime Edge Function, tidak perlu di-set manual.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized: token tidak ditemukan" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    // client dengan token si pemanggil -> untuk verifikasi identitas & role
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized: sesi tidak valid" }, 401);

    const { data: callerProfile, error: profileErr } = await callerClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileErr || !callerProfile || !["rt", "dev"].includes(callerProfile.role)) {
      return json({ error: "Forbidden: hanya RT/Dev yang bisa menambah user" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const { nama, email, password, role } = body;
    if (!nama || !email || !password || !role) return json({ error: "Data tidak lengkap" }, 400);
    if (!["rt", "dev", "warga"].includes(role)) return json({ error: "Role tidak valid" }, 400);
    if (String(password).length < 6) return json({ error: "Password minimal 6 karakter" }, 400);

    // client dengan service role -> boleh bikin akun & bypass RLS
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr) return json({ error: createErr.message }, 400);

    const { error: insertErr } = await adminClient
      .from("profiles")
      .insert({ id: created.user.id, nama, role });

    if (insertErr) {
      // rollback akun auth kalau gagal simpan profil, biar tidak jadi akun "nyangkut"
      await adminClient.auth.admin.deleteUser(created.user.id);
      return json({ error: insertErr.message }, 400);
    }

    return json({ success: true, id: created.user.id });
  } catch (e) {
    return json({ error: e.message || "Terjadi kesalahan" }, 500);
  }
});
