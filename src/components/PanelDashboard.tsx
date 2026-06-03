"use client";

import { Copy, LogIn } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { isAllowedAdminEmail } from "@/lib/admin";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";
import type { Appointment, AppointmentRow, AppointmentStatus } from "@/types/appointments";

const labels: Record<AppointmentStatus, string> = {
  pending: "pendiente",
  confirmed: "confirmada",
  cancelled: "cancelada",
  completed: "completada"
};

const PRODUCTION_SITE_URL = "https://agenda-mas-sano.vercel.app";

function getPanelRedirectUrl() {
  const browserOrigin = window.location.origin.replace(/\/+$/, "");
  const envSiteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
  const safeSiteUrl = browserOrigin.includes("localhost")
    ? envSiteUrl && !envSiteUrl.includes("localhost")
      ? envSiteUrl
      : PRODUCTION_SITE_URL
    : browserOrigin;

  return `${safeSiteUrl}/panel`;
}

function toAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    whatsapp: row.whatsapp,
    date: row.appointment_date,
    time: row.appointment_time.slice(0, 5),
    status: row.status
  };
}

async function checkAdminAccess(client: SupabaseClient, email: string) {
  if (!isAllowedAdminEmail(email)) return false;

  const { data, error } = await client
    .from("admin_users")
    .select("email")
    .eq("email", email)
    .maybeSingle();

  return Boolean(!error && data);
}

export function PanelDashboard() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState("");
  const [status, setStatus] = useState<"all" | AppointmentStatus>("all");
  const [items, setItems] = useState<Appointment[]>([]);
  const [message, setMessage] = useState("");

  const filtered = useMemo(
    () => items.filter((item) => (!date || item.date === date) && (status === "all" || item.status === status)),
    [items, date, status]
  );

  const loadAppointments = useCallback(async (client: SupabaseClient) => {
    setMessage("");
    const { data, error } = await client
      .from("appointments")
      .select("id, first_name, last_name, whatsapp, appointment_date, appointment_time, status")
      .order("appointment_date", { ascending: true })
      .order("appointment_time", { ascending: true });

    if (error) {
      setMessage("No se pudieron cargar las citas.");
      return;
    }

    setItems(((data ?? []) as AppointmentRow[]).map(toAppointment));
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setMessage("Falta conectar Supabase.");
      setLoading(false);
      return;
    }

    const client = createSupabaseBrowserClient();
    setSupabase(client);

    client.auth.getSession().then(async ({ data }) => {
      const currentSession = data.session;
      const email = currentSession?.user.email ?? "";
      const allowed = currentSession ? await checkAdminAccess(client, email) : false;

      setSession(currentSession);
      setIsAdmin(allowed);

      if (currentSession && allowed) {
        await loadAppointments(client);
      } else if (currentSession && !allowed) {
        setMessage("Esta cuenta no tiene acceso al panel.");
      }

      setLoading(false);
    });

    const { data: listener } = client.auth.onAuthStateChange(async (_event, nextSession) => {
      const email = nextSession?.user.email ?? "";
      const allowed = nextSession ? await checkAdminAccess(client, email) : false;

      setSession(nextSession);
      setIsAdmin(allowed);

      if (nextSession && allowed) {
        await loadAppointments(client);
      } else {
        setItems([]);
        if (nextSession && !allowed) setMessage("Esta cuenta no tiene acceso al panel.");
      }
    });

    return () => listener.subscription.unsubscribe();
  }, [loadAppointments]);

  async function login() {
    if (!supabase) return;

    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: getPanelRedirectUrl() }
    });
  }

  async function logout() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setIsAdmin(false);
    setItems([]);
  }

  async function updateStatus(id: string, next: AppointmentStatus) {
    if (!supabase) return;

    const previous = items;
    setItems((all) => all.map((item) => (item.id === id ? { ...item, status: next } : item)));

    const { error } = await supabase.from("appointments").update({ status: next }).eq("id", id);

    if (error) {
      setItems(previous);
      setMessage("No se pudo cambiar el estado.");
    }
  }

  if (loading) {
    return (
      <main className="page">
        <div className="shell">
          <section className="card panel-card"><p className="copy">Cargando panel...</p></section>
        </div>
      </main>
    );
  }

  if (!session || !isAdmin) {
    return (
      <main className="page">
        <div className="shell">
          <header className="top"><div><p className="eyebrow">Panel interno</p><h1 className="title">Agenda Mas Sano</h1></div></header>
          <section className="card panel-card">
            <h2>Acceso administrativo</h2>
            <p className="copy">Entra con Google para ver y administrar las citas.</p>
            {message && <p className="error">{message}</p>}
            <div className="actions"><button className="primary" onClick={login} type="button"><LogIn size={18} />Entrar con Google</button></div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="shell">
        <header className="top"><div><p className="eyebrow">Panel interno</p><h1 className="title">Citas</h1></div><button className="secondary" onClick={logout} type="button">Salir</button></header>
        <section className="card panel-card">
          <div className="filters">
            <div className="field"><label htmlFor="dateFilter">Fecha</label><input id="dateFilter" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
            <div className="field"><label htmlFor="statusFilter">Estado</label><select id="statusFilter" value={status} onChange={(event) => setStatus(event.target.value as "all" | AppointmentStatus)}><option value="all">todos</option><option value="pending">pendiente</option><option value="confirmed">confirmada</option><option value="cancelled">cancelada</option><option value="completed">completada</option></select></div>
          </div>
          {message && <p className="error">{message}</p>}
          <div className="list">
            {filtered.map((item) => (
              <article className="apt" key={item.id}>
                <div><strong>{item.firstName} {item.lastName}</strong><p className="copy">{item.date} - {item.time} - {item.whatsapp}</p></div>
                <span className="badge">{labels[item.status]}</span>
                <div className="actions">
                  <select value={item.status} onChange={(event) => updateStatus(item.id, event.target.value as AppointmentStatus)}><option value="pending">pendiente</option><option value="confirmed">confirmada</option><option value="cancelled">cancelada</option><option value="completed">completada</option></select>
                  <button className="secondary" onClick={() => navigator.clipboard.writeText(item.whatsapp)} type="button"><Copy size={17} />Copiar WhatsApp</button>
                </div>
              </article>
            ))}
            {filtered.length === 0 && <p className="copy">No hay citas con esos filtros.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
