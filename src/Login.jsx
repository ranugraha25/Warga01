import React, { useState } from "react";
import { supabase } from "./supabaseClient";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message === "Invalid login credentials" ? "Email atau password salah." : error.message);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F4EFE2", fontFamily: "'Inter', sans-serif", padding: "0 16px" }}>
      <form onSubmit={submit} className="card" style={{ width: "100%", maxWidth: 360 }}>
        <h2 style={{ fontFamily: "'Lora', serif", margin: "0 0 4px", color: "#1B2A4A" }}>Buku Warga · RT 01</h2>
        <p style={{ fontSize: 12.5, opacity: 0.7, marginTop: 0, marginBottom: 20 }}>
          Masuk dengan akun yang sudah didaftarkan pengurus RT.
        </p>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 }}>Email</label>
          <input className="rt-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 }}>Password</label>
          <input className="rt-input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <div style={{ color: "#A6321F", fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
        <button className="rt-btn" type="submit" disabled={loading} style={{ width: "100%" }}>
          {loading ? "Masuk…" : "Masuk"}
        </button>
        <p style={{ fontSize: 11.5, opacity: 0.6, marginTop: 16, marginBottom: 0 }}>
          Belum punya akun? Hubungi pengurus RT untuk didaftarkan.
        </p>
      </form>
    </div>
  );
}
