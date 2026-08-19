import React, { useState } from "react";

const ROLES = [
  { value: "warga", label: "Warga" },
  { value: "rt", label: "RT" },
  { value: "dev", label: "Dev" },
];

export default function ManageUsers({ session }) {
  const [form, setForm] = useState({ nama: "", email: "", password: "", role: "warga" });
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal membuat user");
      setMsg({ type: "ok", text: `User "${form.nama}" (${form.role}) berhasil dibuat. Bagikan email & password ini ke orangnya.` });
      setForm({ nama: "", email: "", password: "", role: "warga" });
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 420 }}>
      <h3 style={{ fontFamily: "'Lora', serif", marginTop: 0 }}>Tambah User</h3>
      <p style={{ fontSize: 12.5, opacity: 0.7, marginTop: -8 }}>
        Akun langsung aktif setelah dibuat. Kirim email & password ini secara manual ke orang yang bersangkutan.
      </p>
      <form onSubmit={submit}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 }}>Nama</label>
          <input className="rt-input" required value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 }}>Email</label>
          <input className="rt-input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 }}>Password sementara</label>
          <input className="rt-input" type="text" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 }}>Role</label>
          <select className="rt-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
        {msg && (
          <div style={{ fontSize: 12.5, marginBottom: 12, color: msg.type === "error" ? "#A6321F" : "#3F6B4A" }}>
            {msg.text}
          </div>
        )}
        <button className="rt-btn" disabled={loading} type="submit">
          {loading ? "Membuat…" : "Buat User"}
        </button>
      </form>
    </div>
  );
}
