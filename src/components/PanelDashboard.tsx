"use client";

import { Copy, Download, LogIn, MessageCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { isAllowedAdminEmail } from "@/lib/admin";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";
import type { Appointment, AppointmentRow, AppointmentStatus, Contact, ContactRow } from "@/types/appointments";

const labels: Record<AppointmentStatus, string> = {
  pending: "agendada",
  confirmed: "confirmada",
  cancelled: "cancelada",
  completed: "completada"
};

const PRODUCTION_SITE_URL = "https://agenda-mas-sano.vercel.app";
const PANEL_REQUEST_TIMEOUT_MS = 12000;
type PanelView = "appointments" | "contacts";

function getPanelRedirectUrl() {
  const browserOrigin = window.location.origin.replace(/\/+$/, "");
  const envSiteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
  const safeSiteUrl = browserOrigin.includes("localhost")
    ? envSiteUrl && !envSiteUrl.includes("localhost")
      ? envSiteUrl
      : PRODUCTION_SITE_URL
    : browserOrigin;

  return `${safeSiteUrl}/auth/panel-callback`;
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

function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    whatsapp: row.whatsapp,
    source: row.source,
    branch: row.branch,
    firstAppointmentDate: row.first_appointment_date,
    lastAppointmentDate: row.last_appointment_date,
    totalAppointments: row.total_appointments,
    latestStatus: row.latest_status,
    latestAppointmentId: row.latest_appointment_id
  };
}

function escapeCsvValue(value: string | number) {
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function exportCsv(filename: string, rows: Array<Record<string, string | number>>) {
  if (rows.length === 0) return;

  const firstRow = rows[0];
  if (!firstRow) return;

  const headers = Object.keys(firstRow);
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header] ?? "")).join(","))
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function withPanelTimeout<T>(promise: PromiseLike<T>, message: string) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), PANEL_REQUEST_TIMEOUT_MS);
    })
  ]);
}

function formatContactName(firstName: string, lastName: string) {
  return `${firstName} ${lastName}`.replace(/\s+/g, " ").trim();
}

function getWhatsAppUrl(whatsapp: string) {
  const digits = whatsapp.replace(/\D/g, "");
  return `https://wa.me/${digits}`;
}

function openWhatsApp(whatsapp: string) {
  window.open(getWhatsAppUrl(whatsapp), "_blank", "noopener,noreferrer");
}

function formatHistory(history: Appointment[]) {
  return history
    .slice(0, 4)
    .map((item) => `${item.date} ${item.time} ${labels[item.status]}`)
    .join(" | ");
}

async function checkAdminAccess(client: SupabaseClient, email: string) {
  if (!isAllowedAdminEmail(email)) return false;

  const { data, error } = await withPanelTimeout(
    client
      .from("admin_users")
      .select("email")
      .eq("email", email)
      .maybeSingle(),
    "No se pudo validar el acceso al panel. Intenta entrar de nuevo."
  );

  return Boolean(!error && data);
}

export function PanelDashboard() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState("");
  const [view, setView] = useState<PanelView>("appointments");
  const [items, setItems] = useState<Appointment[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [contactDate, setContactDate] = useState("");
  const [message, setMessage] = useState("");

  const appointmentHistoryByWhatsapp = useMemo(() => {
    const grouped = new Map<string, Appointment[]>();
    items.forEach((item) => {
      const list = grouped.get(item.whatsapp) ?? [];
      grouped.set(item.whatsapp, [...list, item]);
    });
    grouped.forEach((list, key) => {
      grouped.set(key, list.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)));
    });
    return grouped;
  }, [items]);

  const contactByWhatsapp = useMemo(() => {
    const map = new Map<string, Contact>();
    contacts.forEach((contact) => map.set(contact.whatsapp, contact));
    return map;
  }, [contacts]);

  const filtered = useMemo(
    () => items.filter((item) => !date || item.date === date),
    [items, date]
  );

  const filteredContacts = useMemo(() => {
    const search = contactSearch.trim().toLowerCase();
    return contacts.filter((contact) => {
      const matchesSearch = !search || `${contact.firstName} ${contact.lastName} ${contact.whatsapp}`.toLowerCase().includes(search);
      const matchesDate = !contactDate || contact.lastAppointmentDate === contactDate || contact.firstAppointmentDate === contactDate;
      return matchesSearch && matchesDate;
    });
  }, [contacts, contactDate, contactSearch]);

  const loadAppointments = useCallback(async (client: SupabaseClient) => {
    setMessage("");
    const { data, error } = await withPanelTimeout(
      client
        .from("appointments")
        .select("id, first_name, last_name, whatsapp, appointment_date, appointment_time, status")
        .order("appointment_date", { ascending: true })
        .order("appointment_time", { ascending: true }),
      "No se pudieron cargar las citas. Intenta refrescar el panel."
    );

    if (error) {
      setMessage("No se pudieron cargar las citas.");
      return;
    }

    setItems(((data ?? []) as AppointmentRow[]).map(toAppointment));
  }, []);

  const loadContacts = useCallback(async (client: SupabaseClient) => {
    const { data, error } = await withPanelTimeout(
      client
        .from("contacts")
        .select("id, first_name, last_name, whatsapp, source, branch, first_appointment_date, last_appointment_date, total_appointments, latest_status, latest_appointment_id, created_at, updated_at")
        .order("last_appointment_date", { ascending: false })
        .order("updated_at", { ascending: false }),
      "No se pudieron cargar los contactos. Intenta refrescar el panel."
    );

    if (error) {
      setMessage("No se pudieron cargar los contactos. Revisa que el SQL de Fase 4 ya este aplicado.");
      return;
    }

    setContacts(((data ?? []) as ContactRow[]).map(toContact));
  }, []);

  useEffect(() => {
    let isActive = true;

    if (!isSupabaseConfigured()) {
      setMessage("Falta conectar Supabase.");
      setLoading(false);
      return;
    }

    const client = createSupabaseBrowserClient();
    setSupabase(client);

    async function applySession(currentSession: Session | null) {
      const email = currentSession?.user.email ?? "";
      const allowed = currentSession ? await checkAdminAccess(client, email) : false;

      if (!isActive) return;

      setSession(currentSession);
      setIsAdmin(allowed);
      setLoading(false);

      if (currentSession && allowed) {
        try {
          await Promise.all([loadAppointments(client), loadContacts(client)]);
        } catch (error) {
          if (!isActive) return;
          setMessage(getErrorMessage(error, "No se pudieron cargar todos los datos del panel."));
        }
      } else if (currentSession && !allowed) {
        setMessage("Esta cuenta no tiene acceso al panel.");
      } else {
        setItems([]);
        setContacts([]);
      }
    }

    async function initializePanel() {
      try {
        const { data, error } = await withPanelTimeout(
          client.auth.getSession(),
          "No se pudo validar la sesion. Intenta entrar de nuevo."
        );

        if (error) throw error;

        await applySession(data.session);
      } catch (error) {
        if (!isActive) return;

        setSession(null);
        setIsAdmin(false);
        setItems([]);
        setContacts([]);
        setMessage(getErrorMessage(error, "No se pudo cargar el panel. Intenta entrar de nuevo."));
        setLoading(false);
      }
    }

    void initializePanel();

    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      window.setTimeout(() => {
        void applySession(nextSession).catch((error) => {
          setMessage(getErrorMessage(error, "No se pudo actualizar la sesion del panel."));
          setLoading(false);
        });
      }, 0);
    });

    return () => {
      isActive = false;
      listener.subscription.unsubscribe();
    };
  }, [loadAppointments, loadContacts]);

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
    setContacts([]);
  }

  function exportContacts() {
    exportCsv(
      "contactos-mas-sano.csv",
      filteredContacts.map((contact) => ({
        Nombre: contact.firstName,
        Apellidos: contact.lastName,
        WhatsApp: contact.whatsapp,
        Origen: contact.source,
        Sucursal: contact.branch,
        "Primera cita": contact.firstAppointmentDate,
        "Ultima cita": contact.lastAppointmentDate,
        "Total citas": contact.totalAppointments,
        "Estado reciente": labels[contact.latestStatus]
      }))
    );
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
        <header className="top"><div><p className="eyebrow">Panel interno</p><h1 className="title">{view === "appointments" ? "Agenda" : "Contactos"}</h1></div><button className="secondary" onClick={logout} type="button">Salir</button></header>
        <section className="card panel-card">
          <div className="tabs">
            <button className={view === "appointments" ? "active" : ""} onClick={() => setView("appointments")} type="button">Agenda</button>
            <button className={view === "contacts" ? "active" : ""} onClick={() => setView("contacts")} type="button">Contactos</button>
          </div>
          {message && <p className="error">{message}</p>}
          {view === "appointments" && (
            <>
              <div className="filters">
                <div className="field"><label htmlFor="dateFilter">Fecha</label><input id="dateFilter" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
              </div>
              <div className="list">
                {filtered.map((item) => {
                  const contact = contactByWhatsapp.get(item.whatsapp);
                  const history = appointmentHistoryByWhatsapp.get(item.whatsapp) ?? [];
                  const totalAppointments = contact?.totalAppointments ?? history.length;
                  const lastAppointmentDate = contact?.lastAppointmentDate ?? item.date;
                  return (
                    <article className="apt" key={item.id}>
                      <div>
                        <strong>{item.date} - {item.time}</strong>
                        <p className="copy"><strong>{formatContactName(item.firstName, item.lastName)}</strong></p>
                        <p className="copy">WhatsApp: {item.whatsapp}</p>
                        <p className="copy">Total de citas: {totalAppointments} - Ultima cita: {lastAppointmentDate}</p>
                        {history.length > 0 && <p className="copy">Historial: {formatHistory(history)}</p>}
                      </div>
                      <div className="actions">
                        <button className="primary" onClick={() => openWhatsApp(item.whatsapp)} type="button"><MessageCircle size={17} />Abrir WhatsApp</button>
                        <button className="secondary" onClick={() => navigator.clipboard.writeText(item.whatsapp)} type="button"><Copy size={17} />Copiar WhatsApp</button>
                      </div>
                    </article>
                  );
                })}
                {filtered.length === 0 && <p className="copy">No hay citas con esos filtros.</p>}
              </div>
            </>
          )}
          {view === "contacts" && (
            <>
              <div className="filters">
                <div className="field"><label htmlFor="contactSearch">Buscar</label><input id="contactSearch" type="search" placeholder="Nombre, apellido o WhatsApp" value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} /></div>
                <div className="field"><label htmlFor="contactDateFilter">Fecha</label><input id="contactDateFilter" type="date" value={contactDate} onChange={(event) => setContactDate(event.target.value)} /></div>
              </div>
              <div className="actions"><button className="secondary" onClick={exportContacts} type="button"><Download size={17} />Exportar CSV</button></div>
              <div className="list">
                {filteredContacts.map((contact) => {
                  const history = appointmentHistoryByWhatsapp.get(contact.whatsapp) ?? [];
                  return (
                    <article className="apt contact-card" key={contact.id}>
                      <div>
                        <strong>{formatContactName(contact.firstName, contact.lastName)}</strong>
                        <p className="copy">WhatsApp: {contact.whatsapp}</p>
                        <p className="copy">{contact.branch} - {contact.source}</p>
                        <p className="copy">Total de citas: {contact.totalAppointments} - Ultima cita: {contact.lastAppointmentDate}</p>
                        <p className="copy">Primera cita: {contact.firstAppointmentDate}</p>
                        {history.length > 0 && <p className="copy">Historial: {formatHistory(history)}</p>}
                      </div>
                      <div className="actions">
                        <button className="primary" onClick={() => openWhatsApp(contact.whatsapp)} type="button"><MessageCircle size={17} />Abrir WhatsApp</button>
                        <button className="secondary" onClick={() => navigator.clipboard.writeText(contact.whatsapp)} type="button"><Copy size={17} />Copiar WhatsApp</button>
                      </div>
                    </article>
                  );
                })}
                {filteredContacts.length === 0 && <p className="copy">No hay contactos con esos filtros.</p>}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
