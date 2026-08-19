import React, { useState, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import { supabase } from "./supabaseClient";
import { useAuth } from "./useAuth";
import Login from "./Login";
import ManageUsers from "./ManageUsers";

// ---------- helpers ----------
const fmtW = (id) => `W-${String(id).padStart(3, "0")}`;
const fmtKK = (id) => `KK-${String(id).padStart(3, "0")}`;
const fmtIUR = (id) => `IUR-${String(id).padStart(3, "0")}`;
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso) => {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};
const waLink = (phone, text) => {
  if (!phone) return null;
  const clean = phone.replace(/[^0-9]/g, "").replace(/^0/, "62");
  return `https://wa.me/${clean}?text=${encodeURIComponent(text)}`;
};
const ROLE_LABEL = { rt: "RT", dev: "Dev", warga: "Warga" };

const STATUS_OPTS = ["Kepala Keluarga", "Istri", "Anak", "Lainnya"];

// ---- row <-> app-state mappers ----
const mapResident = (r) => ({
  id: r.id, nama: r.nama, nik: r.nik, tglLahir: r.tgl_lahir, alamat: r.alamat,
  status: r.status, hp: r.hp, kkId: r.kk_id,
});
const mapFamily = (f) => ({ id: f.id, nama: f.nama, alamat: f.alamat });
const mapIuran = (i) => ({ id: i.id, nama: i.nama, nominal: i.nominal, temporary: i.temporary });
const mapPayment = (p) => ({ id: p.id, kkId: p.kk_id, iuranId: p.iuran_id, periode: p.periode, lunas: p.lunas, tanggal: p.tanggal });
const mapReminder = (r) => ({
  id: r.id, type: r.type, target: r.target, targetId: r.target_id, message: r.message, waktu: r.waktu,
  createdByName: r.created_by_name, createdByRole: r.created_by_role,
});

// ============================ ROOT: gerbang login ============================
export default function App() {
  const { session, profile, loading, logout, reloadProfile } = useAuth();

  return (
    <div style={S.page}>
      <GlobalStyle />
      {loading ? (
        <CenterMsg text="Memuat…" />
      ) : !session ? (
        <Login />
      ) : !profile ? (
        <CenterMsg
          text="Akun kamu belum terdaftar sebagai user aplikasi ini. Hubungi RT/Dev untuk didaftarkan."
          action={<button className="rt-btn ghost" onClick={logout}>Keluar</button>}
        />
      ) : (
        <AuthenticatedApp session={session} profile={profile} logout={logout} />
      )}
    </div>
  );
}

function CenterMsg({ text, action }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", padding: 20, textAlign: "center" }}>
      <div className="card" style={{ maxWidth: 420 }}>
        <p style={{ fontSize: 13.5 }}>{text}</p>
        {action}
      </div>
    </div>
  );
}

// ============================ APP UTAMA (sudah login) ============================
function AuthenticatedApp({ session, profile, logout }) {
  const canEdit = profile.role === "rt" || profile.role === "dev";

  const [db, setDb] = useState({ residents: [], families: [], iuranTypes: [], payments: [], reminders: [] });
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  const fetchAll = async () => {
    const [res, fam, iur, pay, rem] = await Promise.all([
      supabase.from("residents").select("*").order("id"),
      supabase.from("families").select("*").order("id"),
      supabase.from("iuran_types").select("*").order("id"),
      supabase.from("payments").select("*"),
      supabase.from("reminders").select("*").order("waktu", { ascending: false }).limit(200),
    ]);
    const firstError = [res, fam, iur, pay, rem].find((r) => r.error)?.error;
    if (firstError) throw firstError;
    setDb({
      residents: res.data.map(mapResident),
      families: fam.data.map(mapFamily),
      iuranTypes: iur.data.map(mapIuran),
      payments: pay.data.map(mapPayment),
      reminders: rem.data.map(mapReminder),
    });
  };

  useEffect(() => {
    fetchAll()
      .catch((e) => setLoadError(e.message || String(e)))
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // kalau tab yang lagi aktif ternyata tidak boleh diakses role ini, balik ke dashboard
  useEffect(() => {
    if (tab === "reminder" && !canEdit) setTab("dashboard");
    if (tab === "users" && !canEdit) setTab("dashboard");
  }, [tab, canEdit]);

  // ---------- derived ----------
  const familyMap = useMemo(() => {
    const m = {};
    db.families.forEach((f) => (m[f.id] = f));
    return m;
  }, [db.families]);

  const residentsByFamily = useMemo(() => {
    const m = {};
    db.residents.forEach((r) => {
      if (!m[r.kkId]) m[r.kkId] = [];
      m[r.kkId].push(r);
    });
    return m;
  }, [db.residents]);

  const paymentStatus = (kkId, iuranId, periode) =>
    db.payments.find((p) => p.kkId === kkId && p.iuranId === iuranId && p.periode === periode);

  // ---------- CRUD: resident ----------
  const upsertResident = async (data, editingId) => {
    const payload = {
      nama: data.nama, nik: data.nik, tgl_lahir: data.tglLahir || null,
      alamat: data.alamat, status: data.status, hp: data.hp || null,
      kk_id: data.kkId ? Number(data.kkId) : null,
    };
    try {
      let row;
      if (editingId) {
        const { data: d, error } = await supabase.from("residents").update(payload).eq("id", editingId).select().single();
        if (error) throw error;
        row = d;
        setDb((prev) => ({ ...prev, residents: prev.residents.map((r) => (r.id === editingId ? mapResident(row) : r)) }));
      } else {
        const { data: d, error } = await supabase.from("residents").insert(payload).select().single();
        if (error) throw error;
        row = d;
        setDb((prev) => ({ ...prev, residents: [...prev.residents, mapResident(row)] }));
      }
      showToast(editingId ? "Data warga diperbarui" : "Warga baru ditambahkan");
    } catch (e) {
      showToast(`Gagal menyimpan: ${e.message}`, "error");
    }
  };

  const deleteResident = async (id) => {
    const { error } = await supabase.from("residents").delete().eq("id", id);
    if (error) return showToast(`Gagal menghapus: ${error.message}`, "error");
    setDb((prev) => ({ ...prev, residents: prev.residents.filter((r) => r.id !== id) }));
    showToast("Warga dihapus");
  };

  // ---------- CRUD: family ----------
  const upsertFamily = async (data, editingId) => {
    const payload = { nama: data.nama, alamat: data.alamat };
    try {
      let row;
      if (editingId) {
        const { data: d, error } = await supabase.from("families").update(payload).eq("id", editingId).select().single();
        if (error) throw error;
        row = d;
        setDb((prev) => ({ ...prev, families: prev.families.map((f) => (f.id === editingId ? mapFamily(row) : f)) }));
      } else {
        const { data: d, error } = await supabase.from("families").insert(payload).select().single();
        if (error) throw error;
        row = d;
        setDb((prev) => ({ ...prev, families: [...prev.families, mapFamily(row)] }));
      }
      showToast(editingId ? "Data KK diperbarui" : "KK baru dibuat");
    } catch (e) {
      showToast(`Gagal menyimpan: ${e.message}`, "error");
    }
  };

  const deleteFamily = async (id) => {
    const { error } = await supabase.from("families").delete().eq("id", id);
    if (error) return showToast(`Gagal menghapus: ${error.message}`, "error");
    setDb((prev) => ({
      ...prev,
      families: prev.families.filter((f) => f.id !== id),
      residents: prev.residents.map((r) => (r.kkId === id ? { ...r, kkId: null } : r)),
      payments: prev.payments.filter((p) => p.kkId !== id),
    }));
    showToast("KK dihapus");
  };

  // ---------- CRUD: iuran type ----------
  const upsertIuran = async (data, editingId) => {
    const payload = { nama: data.nama, nominal: data.nominal ? Number(data.nominal) : null, temporary: !!data.temporary };
    try {
      let row;
      if (editingId) {
        const { data: d, error } = await supabase.from("iuran_types").update(payload).eq("id", editingId).select().single();
        if (error) throw error;
        row = d;
        setDb((prev) => ({ ...prev, iuranTypes: prev.iuranTypes.map((i) => (i.id === editingId ? mapIuran(row) : i)) }));
      } else {
        const { data: d, error } = await supabase.from("iuran_types").insert(payload).select().single();
        if (error) throw error;
        row = d;
        setDb((prev) => ({ ...prev, iuranTypes: [...prev.iuranTypes, mapIuran(row)] }));
      }
      showToast(editingId ? "Jenis iuran diperbarui" : "Jenis iuran baru ditambahkan");
    } catch (e) {
      showToast(`Gagal menyimpan: ${e.message}`, "error");
    }
  };

  const deleteIuran = async (id) => {
    const { error } = await supabase.from("iuran_types").delete().eq("id", id);
    if (error) return showToast(`Gagal menghapus: ${error.message}`, "error");
    setDb((prev) => ({
      ...prev,
      iuranTypes: prev.iuranTypes.filter((i) => i.id !== id),
      payments: prev.payments.filter((p) => p.iuranId !== id),
    }));
    showToast("Jenis iuran dihapus");
  };

  const togglePayment = async (kkId, iuranId, periode) => {
    const existing = paymentStatus(kkId, iuranId, periode);
    const newLunas = !existing?.lunas;
    const payload = { kk_id: kkId, iuran_id: iuranId, periode, lunas: newLunas, tanggal: newLunas ? todayISO() : null };
    const { data, error } = await supabase.from("payments").upsert(payload, { onConflict: "kk_id,iuran_id,periode" }).select().single();
    if (error) return showToast(`Gagal update status: ${error.message}`, "error");
    setDb((prev) => {
      const others = prev.payments.filter((p) => !(p.kkId === kkId && p.iuranId === iuranId && p.periode === periode));
      return { ...prev, payments: [...others, mapPayment(data)] };
    });
  };

  // ---------- reminders / broadcast ----------
  const logReminder = async (entry) => {
    const payload = {
      type: entry.type, target: entry.target, target_id: entry.targetId || null, message: entry.message,
      created_by_id: session.user.id, created_by_name: profile.nama, created_by_role: profile.role,
    };
    const { data, error } = await supabase.from("reminders").insert(payload).select().single();
    if (error) return showToast(`Gagal mencatat: ${error.message}`, "error");
    setDb((prev) => ({ ...prev, reminders: [mapReminder(data), ...prev.reminders] }));
  };

  // ---------- excel export (rt/dev saja, lihat gating di WargaTab/KKTab) ----------
  const exportResidents = () => {
    const rows = db.residents.map((r) => ({
      "ID Warga": fmtW(r.id), Nama: r.nama, NIK: r.nik, "Tanggal Lahir": r.tglLahir,
      "No. Rumah": r.alamat, Status: r.status, "No. HP": r.hp || "",
      "ID KK": r.kkId ? fmtKK(r.kkId) : "", "Nama KK": r.kkId ? familyMap[r.kkId]?.nama || "" : "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data Warga");
    XLSX.writeFile(wb, `data-warga-rt01-${todayISO()}.xlsx`);
    showToast("Excel data warga diunduh");
  };

  const exportIuran = (periode) => {
    const rows = db.families.map((f) => {
      const row = { "ID KK": fmtKK(f.id), "Nama KK": f.nama, "No. Rumah": f.alamat };
      db.iuranTypes.forEach((it) => {
        const p = paymentStatus(f.id, it.id, periode);
        row[it.nama] = p?.lunas ? "LUNAS" : "BELUM";
      });
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Status Iuran");
    XLSX.writeFile(wb, `status-iuran-rt01-${periode}.xlsx`);
    showToast("Excel status iuran diunduh");
  };

  if (!loaded) return <CenterMsg text="Memuat data…" />;

  if (loadError) {
    return (
      <CenterMsg
        text={
          <>
            <strong>Gagal terhubung ke database</strong>
            <br />
            {loadError}
          </>
        }
      />
    );
  }

  return (
    <div>
      <Header tab={tab} setTab={setTab} profile={profile} logout={logout} canEdit={canEdit} />
      <main className="main-wrap">
        {toast && <Toast toast={toast} />}
        {tab === "dashboard" && <Dashboard db={db} />}
        {tab === "warga" && (
          <WargaTab db={db} familyMap={familyMap} upsertResident={upsertResident} deleteResident={deleteResident} exportResidents={exportResidents} canEdit={canEdit} />
        )}
        {tab === "kk" && (
          <KKTab
            db={db} residentsByFamily={residentsByFamily} upsertFamily={upsertFamily} deleteFamily={deleteFamily}
            upsertIuran={upsertIuran} deleteIuran={deleteIuran} paymentStatus={paymentStatus} togglePayment={togglePayment}
            exportIuran={exportIuran} canEdit={canEdit}
          />
        )}
        {tab === "reminder" && canEdit && <ReminderTab db={db} logReminder={logReminder} showToast={showToast} />}
        {tab === "broadcast" && <BroadcastTab db={db} logReminder={logReminder} showToast={showToast} />}
        {tab === "users" && canEdit && <ManageUsers session={session} />}
      </main>
    </div>
  );
}

// ============================ STYLE TOKENS ============================
const S = {
  ink: "#1B2A4A", paper: "#F4EFE2", paperDark: "#EAE2CC", stamp: "#A6321F",
  stampLight: "#C4573F", gold: "#9C7A32", paid: "#3F6B4A", line: "#CFC4A3",
  page: { minHeight: "100vh", background: "#F4EFE2", color: "#1B2A4A", fontFamily: "'Inter', sans-serif" },
};

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Lora:wght@500;600;700&family=IBM+Plex+Mono:wght@500;600&family=Inter:wght@400;500;600&display=swap');
      * { box-sizing: border-box; }
      body { margin: 0; }
      .rt-btn {
        font-family: 'Inter', sans-serif; font-weight: 600; font-size: 13px;
        padding: 9px 16px; border-radius: 3px; border: 1.5px solid ${S.ink};
        background: ${S.ink}; color: ${S.paper}; cursor: pointer;
        transition: transform .08s ease, box-shadow .08s ease;
      }
      .rt-btn:hover { transform: translateY(-1px); box-shadow: 2px 3px 0 rgba(27,42,74,0.25); }
      .rt-btn:active { transform: translateY(0); box-shadow: none; }
      .rt-btn.ghost { background: transparent; color: ${S.ink}; }
      .rt-btn.stamp { border-color: ${S.stamp}; background: ${S.stamp}; }
      .rt-btn.stamp:hover { box-shadow: 2px 3px 0 rgba(166,50,31,0.3); }
      .rt-btn:disabled { opacity: .4; cursor: not-allowed; transform:none; box-shadow:none; }
      .rt-input, .rt-select, .rt-textarea {
        font-family: 'Inter', sans-serif; font-size: 13.5px; padding: 8px 10px;
        border: 1.5px solid ${S.line}; border-radius: 3px; background: #FFFDF7; color: ${S.ink};
        width: 100%;
      }
      .rt-input:focus, .rt-select:focus, .rt-textarea:focus { outline: 2px solid ${S.gold}; border-color: ${S.gold}; }
      table.rt-table { width: 100%; border-collapse: collapse; font-size: 13px; }
      table.rt-table th {
        text-align: left; font-family: 'IBM Plex Mono', monospace; font-weight: 600;
        font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: ${S.ink};
        border-bottom: 2px solid ${S.ink}; padding: 8px 10px; background: ${S.paperDark};
      }
      table.rt-table td { padding: 9px 10px; border-bottom: 1px solid ${S.line}; vertical-align: middle; }
      table.rt-table tr:hover td { background: rgba(156,122,50,0.06); }
      .id-tag { font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; background: ${S.ink}; color: ${S.paper}; padding: 2px 7px; border-radius: 2px; letter-spacing: .03em; }
      .card { background: #FFFDF7; border: 1.5px solid ${S.line}; border-radius: 4px; padding: 18px; }
      .stamp-badge {
        display: inline-flex; align-items:center; gap:6px; font-family:'IBM Plex Mono', monospace;
        font-weight:700; font-size:11px; letter-spacing:.06em; padding: 4px 10px; border-radius: 20px;
        border: 2px solid currentColor; transform: rotate(-2deg);
      }
      .role-badge {
        font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: .05em;
        padding: 3px 8px; border-radius: 20px; border: 1.5px solid currentColor; text-transform: uppercase;
      }
      .main-wrap { max-width: 1080px; margin: 0 auto; padding: 24px 20px 80px; }
      .header-inner { max-width: 1080px; margin: 0 auto; padding: 20px 20px 0; }
      .app-title { font-family: 'Lora', serif; font-weight: 700; font-size: 26px; margin: 0; }
      .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .split-2 { display: grid; grid-template-columns: 1.1fr 1fr; gap: 18px; }

      /* ---------- Tampilan mobile ---------- */
      @media (max-width: 720px) {
        .split-2 { grid-template-columns: 1fr; }
        .grid-2 { grid-template-columns: 1fr; }
      }
      @media (max-width: 560px) {
        .main-wrap { padding: 16px 12px 56px; }
        .header-inner { padding: 14px 14px 0; }
        .app-title { font-size: 19px; }
        .app-subtitle { display: none; }
        .card { padding: 14px; }
        table.rt-table th, table.rt-table td { padding: 7px 8px; font-size: 12px; }
        .rt-btn { padding: 8px 12px; font-size: 12.5px; }
        .stat-card-value { font-size: 26px !important; }
      }
    `}</style>
  );
}

// ============================ HEADER ============================
function Header({ tab, setTab, profile, logout, canEdit }) {
  const items = [
    { id: "dashboard", label: "Ringkasan" },
    { id: "warga", label: "Data Warga" },
    { id: "kk", label: "KK & Iuran" },
    ...(canEdit ? [{ id: "reminder", label: "Reminder" }] : []),
    { id: "broadcast", label: "Broadcast" },
    ...(canEdit ? [{ id: "users", label: "Kelola User" }] : []),
  ];
  return (
    <header style={{ background: S.ink, color: S.paper, borderBottom: `4px double ${S.stamp}` }}>
      <div className="header-inner">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", minWidth: 0 }}>
            <h1 className="app-title">Buku Warga · RT 01</h1>
            <span className="app-subtitle" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, opacity: 0.7 }}>
              sistem administrasi kependudukan &amp; iuran
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5 }}>{profile.nama}</span>
            <span className="role-badge">{ROLE_LABEL[profile.role] || profile.role}</span>
            <button className="rt-btn ghost" style={{ padding: "6px 12px", fontSize: 12, borderColor: S.paper, color: S.paper }} onClick={logout}>
              Keluar
            </button>
          </div>
        </div>
        <nav style={{ display: "flex", gap: 4, marginTop: 16, flexWrap: "wrap", overflowX: "auto" }}>
          {items.map((it) => (
            <button key={it.id} onClick={() => setTab(it.id)} style={{
              fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 13, padding: "10px 16px", whiteSpace: "nowrap",
              background: tab === it.id ? S.paper : "transparent", color: tab === it.id ? S.ink : S.paper,
              border: "none", borderRadius: "4px 4px 0 0", cursor: "pointer", opacity: tab === it.id ? 1 : 0.75,
            }}>{it.label}</button>
          ))}
        </nav>
      </div>
    </header>
  );
}

function Toast({ toast }) {
  return (
    <div style={{
      position: "fixed", top: 18, right: 18, zIndex: 50,
      background: toast.type === "error" ? S.stamp : S.paid, color: "#fff",
      padding: "10px 16px", borderRadius: 4, fontSize: 13, fontWeight: 600,
      boxShadow: "2px 4px 10px rgba(0,0,0,0.2)", maxWidth: 340,
    }}>{toast.msg}</div>
  );
}

// ============================ DASHBOARD ============================
function Dashboard({ db }) {
  const totalWarga = db.residents.length;
  const totalKK = db.families.length;
  const periode = new Date().toISOString().slice(0, 7);
  let belumBayar = 0;
  db.families.forEach((f) => {
    db.iuranTypes.forEach((it) => {
      const p = db.payments.find((pp) => pp.kkId === f.id && pp.iuranId === it.id && pp.periode === periode);
      if (!p || !p.lunas) belumBayar += 1;
    });
  });

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginBottom: 24 }}>
        <StatCard label="Total Warga" value={totalWarga} />
        <StatCard label="Total KK / Rumah" value={totalKK} />
        <StatCard label="Jenis Iuran Aktif" value={db.iuranTypes.length} />
        <StatCard label={`Tunggakan (${periode})`} value={belumBayar} accent={S.stamp} />
      </div>
      <div className="card">
        <h3 style={{ fontFamily: "'Lora', serif", marginTop: 0 }}>Riwayat komunikasi terbaru</h3>
        {db.reminders.length === 0 ? (
          <Empty text="Belum ada reminder atau broadcast yang dikirim." />
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {db.reminders.slice(0, 6).map((r) => (
              <li key={r.id} style={{ padding: "8px 0", borderBottom: `1px solid ${S.line}`, fontSize: 13.5 }}>
                <span className="id-tag" style={{ marginRight: 8, background: r.type === "broadcast" ? S.gold : S.ink }}>
                  {r.type === "broadcast" ? "BROADCAST" : "REMINDER"}
                </span>
                {r.target} — <span style={{ opacity: 0.8 }}>{r.message.slice(0, 60)}{r.message.length > 60 ? "…" : ""}</span>
                {r.createdByName && <span style={{ opacity: 0.5 }}> · oleh {r.createdByName}</span>}
                <span style={{ float: "right", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, opacity: 0.6 }}>
                  {new Date(r.waktu).toLocaleString("id-ID")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div className="card" style={{ textAlign: "center" }}>
      <div className="stat-card-value" style={{ fontFamily: "'Lora', serif", fontSize: 34, fontWeight: 700, color: accent || S.ink }}>{value}</div>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", opacity: 0.7, marginTop: 4 }}>
        {label}
      </div>
    </div>
  );
}

function Empty({ text }) {
  return <div style={{ padding: "20px 0", opacity: 0.6, fontSize: 13.5, fontStyle: "italic" }}>{text}</div>;
}

// ============================ WARGA TAB ============================
function WargaTab({ db, familyMap, upsertResident, deleteResident, exportResidents, canEdit }) {
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(null);

  const filtered = db.residents.filter((r) =>
    [r.nama, r.nik, fmtW(r.id), r.alamat].join(" ").toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 10, flexWrap: "wrap" }}>
        <input className="rt-input" placeholder="Cari nama / NIK / ID / alamat…" style={{ maxWidth: 320 }} value={query} onChange={(e) => setQuery(e.target.value)} />
        {canEdit && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="rt-btn ghost" onClick={exportResidents}>⬇ Export Excel</button>
            <button className="rt-btn" onClick={() => setForm({})}>+ Tambah Warga</button>
          </div>
        )}
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <table className="rt-table">
          <thead>
            <tr><th>ID</th><th>Nama</th><th>NIK</th><th>Tgl Lahir</th><th>No. Rumah</th><th>Status</th><th>KK</th>{canEdit && <th></th>}</tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td><span className="id-tag">{fmtW(r.id)}</span></td>
                <td style={{ fontWeight: 600 }}>{r.nama}</td>
                <td style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{r.nik}</td>
                <td>{fmtDate(r.tglLahir)}</td>
                <td>No. {r.alamat}</td>
                <td>{r.status}</td>
                <td>{r.kkId ? familyMap[r.kkId]?.nama : <span style={{ opacity: 0.4 }}>belum digabung</span>}</td>
                {canEdit && (
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="rt-btn ghost" style={{ padding: "5px 9px", fontSize: 12 }} onClick={() => setForm(r)}>Edit</button>{" "}
                    <button className="rt-btn ghost" style={{ padding: "5px 9px", fontSize: 12, borderColor: S.stamp, color: S.stamp }}
                      onClick={() => window.confirm(`Hapus data ${r.nama}?`) && deleteResident(r.id)}>Hapus</button>
                  </td>
                )}
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={canEdit ? 8 : 7}><Empty text="Belum ada data warga." /></td></tr>}
          </tbody>
        </table>
      </div>

      {form !== null && (
        <ResidentForm initial={form} families={db.families} onClose={() => setForm(null)}
          onSave={(data) => { upsertResident(data, form.id); setForm(null); }} />
      )}
    </div>
  );
}

function ResidentForm({ initial, families, onClose, onSave }) {
  const [f, setF] = useState({
    nama: initial.nama || "", nik: initial.nik || "", tglLahir: initial.tglLahir || "",
    alamat: initial.alamat || "", status: initial.status || STATUS_OPTS[0],
    hp: initial.hp || "", kkId: initial.kkId || "",
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  return (
    <Modal title={initial.id ? `Edit Warga — ${fmtW(initial.id)}` : "Tambah Warga Baru"} onClose={onClose}>
      <div className="grid-2">
        <Field label="Nama Lengkap"><input className="rt-input" value={f.nama} onChange={set("nama")} /></Field>
        <Field label="NIK"><input className="rt-input" value={f.nik} onChange={set("nik")} maxLength={16} /></Field>
        <Field label="Tanggal Lahir"><input type="date" className="rt-input" value={f.tglLahir || ""} onChange={set("tglLahir")} /></Field>
        <Field label="No. Rumah / Alamat"><input className="rt-input" value={f.alamat} onChange={set("alamat")} /></Field>
        <Field label="Status">
          <select className="rt-select" value={f.status} onChange={set("status")}>
            {STATUS_OPTS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="No. HP (opsional, untuk WA)"><input className="rt-input" value={f.hp} onChange={set("hp")} placeholder="08xxxxxxxxxx" /></Field>
        <Field label="Gabung ke KK" full>
          <select className="rt-select" value={f.kkId} onChange={set("kkId")}>
            <option value="">— belum digabung —</option>
            {families.map((fam) => <option key={fam.id} value={fam.id}>{fmtKK(fam.id)} · {fam.nama} (No. {fam.alamat})</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
        <button className="rt-btn ghost" onClick={onClose}>Batal</button>
        <button className="rt-btn" disabled={!f.nama || !f.nik} onClick={() => onSave(f)}>Simpan</button>
      </div>
    </Modal>
  );
}

// ============================ KK & IURAN TAB ============================
function KKTab({ db, residentsByFamily, upsertFamily, deleteFamily, upsertIuran, deleteIuran, paymentStatus, togglePayment, exportIuran, canEdit }) {
  const [famForm, setFamForm] = useState(null);
  const [iurForm, setIurForm] = useState(null);
  const [periode, setPeriode] = useState(new Date().toISOString().slice(0, 7));
  const [openKK, setOpenKK] = useState(null);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>Periode iuran:</label>
          <input type="month" className="rt-input" style={{ width: 160 }} value={periode} onChange={(e) => setPeriode(e.target.value)} />
        </div>
        {canEdit && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="rt-btn ghost" onClick={() => exportIuran(periode)}>⬇ Export Status Iuran</button>
            <button className="rt-btn ghost" onClick={() => setIurForm({})}>+ Jenis Iuran</button>
            <button className="rt-btn" onClick={() => setFamForm({})}>+ Buat KK</button>
          </div>
        )}
      </div>

      {db.iuranTypes.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h4 style={{ margin: "0 0 10px", fontFamily: "'Lora', serif" }}>Jenis Iuran</h4>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {db.iuranTypes.map((it) => (
              <div key={it.id} className="stamp-badge" style={{ color: it.temporary ? S.gold : S.ink }}>
                {it.nama}{it.nominal ? ` · Rp${Number(it.nominal).toLocaleString("id-ID")}` : ""}{it.temporary ? " · sementara" : ""}
                {canEdit && (
                  <>
                    <button onClick={() => setIurForm(it)} style={{ border: "none", background: "none", cursor: "pointer", color: "inherit" }}>✎</button>
                    <button onClick={() => window.confirm(`Hapus jenis iuran "${it.nama}"?`) && deleteIuran(it.id)} style={{ border: "none", background: "none", cursor: "pointer", color: S.stamp }}>✕</button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ overflowX: "auto" }}>
        <table className="rt-table">
          <thead>
            <tr>
              <th>ID KK</th><th>Nama KK</th><th>No. Rumah</th><th>Anggota</th>
              {db.iuranTypes.map((it) => <th key={it.id}>{it.nama}</th>)}
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {db.families.map((f) => (
              <tr key={f.id}>
                <td><span className="id-tag">{fmtKK(f.id)}</span></td>
                <td style={{ fontWeight: 600 }}>{f.nama}</td>
                <td>No. {f.alamat}</td>
                <td>
                  <button className="rt-btn ghost" style={{ padding: "4px 8px", fontSize: 12 }} onClick={() => setOpenKK(f.id)}>
                    {(residentsByFamily[f.id] || []).length} orang
                  </button>
                </td>
                {db.iuranTypes.map((it) => {
                  const p = paymentStatus(f.id, it.id, periode);
                  const lunas = p?.lunas;
                  return (
                    <td key={it.id}>
                      {canEdit ? (
                        <button onClick={() => togglePayment(f.id, it.id, periode)} className="stamp-badge"
                          style={{ color: lunas ? S.paid : S.stamp, cursor: "pointer", background: "none" }}
                          title={lunas ? `Lunas · ${fmtDate(p.tanggal)}` : "Klik untuk tandai lunas"}>
                          {lunas ? "LUNAS" : "BELUM"}
                        </button>
                      ) : (
                        <span className="stamp-badge" style={{ color: lunas ? S.paid : S.stamp }}>{lunas ? "LUNAS" : "BELUM"}</span>
                      )}
                    </td>
                  );
                })}
                {canEdit && (
                  <td>
                    <button className="rt-btn ghost" style={{ padding: "5px 9px", fontSize: 12 }} onClick={() => setFamForm(f)}>Edit</button>{" "}
                    <button className="rt-btn ghost" style={{ padding: "5px 9px", fontSize: 12, borderColor: S.stamp, color: S.stamp }}
                      onClick={() => window.confirm(`Hapus KK ${f.nama}? Anggota tidak akan terhapus.`) && deleteFamily(f.id)}>Hapus</button>
                  </td>
                )}
              </tr>
            ))}
            {db.families.length === 0 && <tr><td colSpan={4 + db.iuranTypes.length + (canEdit ? 1 : 0)}><Empty text="Belum ada KK." /></td></tr>}
          </tbody>
        </table>
      </div>

      {famForm !== null && (
        <FamilyForm initial={famForm} onClose={() => setFamForm(null)} onSave={(data) => { upsertFamily(data, famForm.id); setFamForm(null); }} />
      )}
      {iurForm !== null && (
        <IuranForm initial={iurForm} onClose={() => setIurForm(null)} onSave={(data) => { upsertIuran(data, iurForm.id); setIurForm(null); }} />
      )}
      {openKK && (
        <Modal title={`Anggota ${familyLabel(db.families, openKK)}`} onClose={() => setOpenKK(null)}>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {(residentsByFamily[openKK] || []).map((r) => (
              <li key={r.id} style={{ padding: "8px 0", borderBottom: `1px solid ${S.line}` }}>
                <span className="id-tag" style={{ marginRight: 8 }}>{fmtW(r.id)}</span>
                <strong>{r.nama}</strong> — {r.status}
              </li>
            ))}
            {(residentsByFamily[openKK] || []).length === 0 && <Empty text="Belum ada anggota." />}
          </ul>
        </Modal>
      )}
    </div>
  );
}

function familyLabel(families, id) {
  const f = families.find((x) => x.id === id);
  return f ? `${f.nama} (${fmtKK(f.id)})` : id;
}

function FamilyForm({ initial, onClose, onSave }) {
  const [f, setF] = useState({ nama: initial.nama || "", alamat: initial.alamat || "" });
  return (
    <Modal title={initial.id ? `Edit KK — ${fmtKK(initial.id)}` : "Buat KK Baru"} onClose={onClose}>
      <Field label="Nama Keluarga"><input className="rt-input" value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} placeholder="Keluarga Budi" /></Field>
      <div style={{ height: 10 }} />
      <Field label="No. Rumah"><input className="rt-input" value={f.alamat} onChange={(e) => setF({ ...f, alamat: e.target.value })} /></Field>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
        <button className="rt-btn ghost" onClick={onClose}>Batal</button>
        <button className="rt-btn" disabled={!f.nama} onClick={() => onSave(f)}>Simpan</button>
      </div>
    </Modal>
  );
}

function IuranForm({ initial, onClose, onSave }) {
  const [f, setF] = useState({ nama: initial.nama || "", nominal: initial.nominal || "", temporary: initial.temporary || false });
  return (
    <Modal title={initial.id ? `Edit Iuran — ${fmtIUR(initial.id)}` : "Tambah Jenis Iuran"} onClose={onClose}>
      <Field label="Nama Iuran"><input className="rt-input" value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} placeholder="cth. Iuran Pengajian" /></Field>
      <div style={{ height: 10 }} />
      <Field label="Nominal (opsional)"><input className="rt-input" type="number" value={f.nominal} onChange={(e) => setF({ ...f, nominal: e.target.value })} placeholder="cth. 20000" /></Field>
      <div style={{ height: 10 }} />
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
        <input type="checkbox" checked={f.temporary} onChange={(e) => setF({ ...f, temporary: e.target.checked })} />
        Iuran sementara / temporary (mudah dihapus setelah acara selesai)
      </label>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
        <button className="rt-btn ghost" onClick={onClose}>Batal</button>
        <button className="rt-btn" disabled={!f.nama} onClick={() => onSave(f)}>Simpan</button>
      </div>
    </Modal>
  );
}

// ============================ REMINDER TAB (rt/dev saja) ============================
function ReminderTab({ db, logReminder, showToast }) {
  const [selected, setSelected] = useState([]);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");

  const filtered = db.residents.filter((r) => r.nama.toLowerCase().includes(query.toLowerCase()));
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const send = async () => {
    const targets = db.residents.filter((r) => selected.includes(r.id));
    for (const r of targets) {
      await logReminder({ type: "reminder", target: r.nama, targetId: r.id, message });
    }
    showToast(`Reminder dicatat untuk ${targets.length} warga`);
    setSelected([]);
    setMessage("");
  };

  return (
    <div className="split-2">
      <div className="card">
        <h4 style={{ marginTop: 0, fontFamily: "'Lora', serif" }}>1. Pilih warga</h4>
        <input className="rt-input" placeholder="Cari nama…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ marginBottom: 10 }} />
        <div style={{ maxHeight: 320, overflowY: "auto", border: `1px solid ${S.line}`, borderRadius: 3 }}>
          {filtered.map((r) => (
            <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", fontSize: 13.5, borderBottom: `1px solid ${S.line}` }}>
              <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
              <span className="id-tag" style={{ fontSize: 10 }}>{fmtW(r.id)}</span>
              {r.nama} <span style={{ opacity: 0.5 }}>· No. {r.alamat}</span>
              {!r.hp && <span style={{ marginLeft: "auto", color: S.stamp, fontSize: 11 }}>tanpa No. HP</span>}
            </label>
          ))}
          {filtered.length === 0 && <Empty text="Tidak ada warga ditemukan." />}
        </div>
        <div style={{ fontSize: 12.5, marginTop: 8, opacity: 0.7 }}>{selected.length} warga dipilih</div>
      </div>

      <div className="card">
        <h4 style={{ marginTop: 0, fontFamily: "'Lora', serif" }}>2. Tulis pesan</h4>
        <textarea className="rt-textarea" rows={6} value={message} onChange={(e) => setMessage(e.target.value)}
          placeholder="cth. Bapak/Ibu, iuran sampah bulan ini belum tercatat lunas. Mohon segera diselesaikan ya, terima kasih." />
        <button className="rt-btn stamp" style={{ marginTop: 10 }} disabled={!selected.length || !message} onClick={send}>
          ✉ Catat &amp; kirim reminder ({selected.length})
        </button>

        {selected.length > 0 && message && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, opacity: 0.7 }}>Buka WhatsApp langsung ke:</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {db.residents.filter((r) => selected.includes(r.id)).map((r) => {
                const link = waLink(r.hp, message);
                return (
                  <a key={r.id} href={link || "#"} target="_blank" rel="noreferrer"
                    style={{ fontSize: 12.5, color: link ? S.paid : S.stamp, pointerEvents: link ? "auto" : "none", textDecoration: "underline" }}>
                    {link ? `→ Kirim WA ke ${r.nama}` : `${r.nama} tidak punya No. HP tersimpan`}
                  </a>
                );
              })}
            </div>
          </div>
        )}

        <h5 style={{ marginTop: 20, marginBottom: 8, opacity: 0.7 }}>Riwayat reminder</h5>
        <div style={{ maxHeight: 160, overflowY: "auto" }}>
          {db.reminders.filter((r) => r.type === "reminder").slice(0, 15).map((r) => (
            <div key={r.id} style={{ fontSize: 12, padding: "6px 0", borderBottom: `1px solid ${S.line}` }}>
              <strong>{r.target}</strong> — {r.message.slice(0, 40)}{r.message.length > 40 ? "…" : ""}
              <span style={{ float: "right", opacity: 0.5 }}>{new Date(r.waktu).toLocaleDateString("id-ID")}</span>
            </div>
          ))}
          {db.reminders.filter((r) => r.type === "reminder").length === 0 && <Empty text="Belum ada riwayat." />}
        </div>
      </div>
    </div>
  );
}

// ============================ BROADCAST TAB (semua role) ============================
function BroadcastTab({ db, logReminder, showToast }) {
  const [message, setMessage] = useState("");
  const withPhone = db.residents.filter((r) => r.hp);

  const send = async () => {
    await logReminder({ type: "broadcast", target: `Seluruh warga (${db.residents.length})`, message });
    showToast(`Broadcast dicatat untuk ${db.residents.length} warga`);
    setMessage("");
  };

  return (
    <div className="split-2">
      <div className="card">
        <h4 style={{ marginTop: 0, fontFamily: "'Lora', serif" }}>Informasi untuk seluruh warga</h4>
        <p style={{ fontSize: 13, opacity: 0.75 }}>
          Total penerima: <strong>{db.residents.length} warga</strong> ({withPhone.length} punya No. HP tersimpan untuk WA).
        </p>
        <textarea className="rt-textarea" rows={7} value={message} onChange={(e) => setMessage(e.target.value)}
          placeholder="cth. Pengumuman: kerja bakti akan dilaksanakan Minggu, 24 Agustus pukul 07.00 di pos RT." />
        <button className="rt-btn stamp" style={{ marginTop: 10 }} disabled={!message} onClick={send}>
          📣 Catat &amp; kirim ke semua warga
        </button>
        {message && withPhone.length > 0 && (
          <div style={{ marginTop: 14, maxHeight: 160, overflowY: "auto" }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, opacity: 0.7 }}>Buka WhatsApp satu-satu:</div>
            {withPhone.map((r) => (
              <a key={r.id} href={waLink(r.hp, message)} target="_blank" rel="noreferrer"
                style={{ display: "block", fontSize: 12.5, color: S.paid, textDecoration: "underline", padding: "3px 0" }}>
                → {r.nama}
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h4 style={{ marginTop: 0, fontFamily: "'Lora', serif" }}>Riwayat broadcast</h4>
        <div style={{ maxHeight: 380, overflowY: "auto" }}>
          {db.reminders.filter((r) => r.type === "broadcast").map((r) => (
            <div key={r.id} style={{ fontSize: 13, padding: "10px 0", borderBottom: `1px solid ${S.line}` }}>
              <div style={{ opacity: 0.5, fontSize: 11 }}>
                {new Date(r.waktu).toLocaleString("id-ID")}
                {r.createdByName && ` · oleh ${r.createdByName} (${ROLE_LABEL[r.createdByRole] || r.createdByRole})`}
              </div>
              {r.message}
            </div>
          ))}
          {db.reminders.filter((r) => r.type === "broadcast").length === 0 && <Empty text="Belum ada broadcast dikirim." />}
        </div>
      </div>
    </div>
  );
}

// ============================ SHARED UI ============================
function Field({ label, children, full }) {
  return (
    <div style={{ gridColumn: full ? "1 / -1" : "auto" }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 5, opacity: 0.7, textTransform: "uppercase", letterSpacing: ".03em" }}>{label}</div>
      {children}
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(27,42,74,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40, padding: 16 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card" style={{ width: "100%", maxWidth: 480, maxHeight: "88vh", overflowY: "auto", background: "#FFFDF7" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ fontFamily: "'Lora', serif", margin: 0, fontSize: 18 }}>{title}</h3>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 18, cursor: "pointer", color: S.ink }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
