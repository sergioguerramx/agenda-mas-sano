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

const PRODUCTION_SITE_URL = "https://agenda.massanonh.com";
const PANEL_REQUEST_TIMEOUT_MS = 12000;
const TIME_ZONE = "America/Monterrey";
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

function getRegistrationDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function getRegistrationLabel(value?: string) {
  if (!value) return "Sin fecha de registro";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha de registro";

  return new Intl.DateTimeFormat("es-MX", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function isDateInRange(value: string, from: string, to: string) {
  if (!value) return false;
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
}

function getPeriodLabel(from: string, to: string) {
  if (from && to) return `${from} a ${to}`;
  if (from) return `desde ${from}`;
  if (to) return `hasta ${to}`;
  return "todos los registros";
}

function toAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    whatsapp: row.whatsapp,
    date: row.appointment_date,
    time: row.appointment_time.slice(0, 5),
    status: row.status,
    createdAt: row.created_at,
    googleContactId: row.google_contact_id,
    brand: row.brand,
    modality: row.modality,
    service: row.service,
    origin: row.origin,
    registroId: row.registro_id,
    clienteId: row.cliente_id,
    correo: row.correo
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
    latestAppointmentId: row.latest_appointment_id,
    googleContactId: row.google_contact_resource_name
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
  const csv = `\uFEFF${[
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header] ?? "")).join(","))
  ].join("\n")}`;

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

function getGoogleContactsLabel(value?: string | null) {
  return value ? "Registrado en Google Contacts" : "Pendiente en Google Contacts";
}

function getAppointmentTypeLabel(item: Appointment) {
  if (item.brand === "yo_soy_sano" || item.origin === "yosoysano") return "Yo Soy Sano Online";
  return "Más Sano Presencial";
}

function getServiceLabel(item: Appointment) {
  if (item.service === "paquete_1199") return "Paquete 4 sesiones";
  if (item.service === "sesion_online_399") return "Sesión Online $399";
  return "Sesión Integral $399";
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
    .map((item) => `Cita para ${item.date} ${item.time}: ${labels[item.status]}`)
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
  const [appointmentDateFrom, setAppointmentDateFrom] = useState("");
  const [appointmentDateTo, setAppointmentDateTo] = useState("");
  const [registrationDateFrom, setRegistrationDateFrom] = useState("");
  const [registrationDateTo, setRegistrationDateTo] = useState("");
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
    () => items.filter((item) => {
      const registrationDate = getRegistrationDate(item.createdAt);
      const matchesAppointmentDate = isDateInRange(item.date, appointmentDateFrom, appointmentDateTo);
      const matchesRegistrationDate = isDateInRange(registrationDate, registrationDateFrom, registrationDateTo);
      return matchesAppointmentDate && matchesRegistrationDate;
    }),
    [items, appointmentDateFrom, appointmentDateTo, registrationDateFrom, registrationDateTo]
  );

  const appointmentReportSummary = useMemo(
    () => ({
      total: filtered.length,
      appointmentPeriod: getPeriodLabel(appointmentDateFrom, appointmentDateTo),
      registrationPeriod: getPeriodLabel(registrationDateFrom, registrationDateTo)
    }),
    [filtered.length, appointmentDateFrom, appointmentDateTo, registrationDateFrom, registrationDateTo]
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
        .select("id, first_name, last_name, whatsapp, appointment_date, appointment_time, status, google_contact_id, brand, modality, service, origin, registro_id, cliente_id, correo, created_at")
        .order("created_at", { ascending: false })
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
        .select("id, first_name, last_name, whatsapp, source, branch, first_appointment_date, last_appointment_date, total_appointments, latest_status, latest_appointment_id, google_contact_resource_name, created_at, updated_at")
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
        "Estado reciente": labels[contact.latestStatus],
        "Google Contacts": getGoogleContactsLabel(contact.googleContactId)
      }))
    );
  }

  function clearAppointmentFilters() {
    setAppointmentDateFrom("");
    setAppointmentDateTo("");
    setRegistrationDateFrom("");
    setRegistrationDateTo("");
  }

  function exportAppointments() {
    const from = registrationDateFrom || appointmentDateFrom || "inicio";
    const to = registrationDateTo || appointmentDateTo || "fin";

    exportCsv(
      `reporte-citas-mas-sano-${from}-a-${to}.csv`,
      filtered.map((item) => {
        const contact = contactByWhatsapp.get(item.whatsapp);
        const history = appointmentHistoryByWhatsapp.get(item.whatsapp) ?? [];
        const googleContactId = item.googleContactId ?? contact?.googleContactId;

        return {
          "Agendada el": getRegistrationLabel(item.createdAt),
          "Fecha agendada": getRegistrationDate(item.createdAt),
          "Fecha de cita": item.date,
          "Hora de cita": item.time,
          Nombre: item.firstName,
          Apellidos: item.lastName,
          WhatsApp: item.whatsapp,
          Tipo: getAppointmentTypeLabel(item),
          Servicio: getServiceLabel(item),
          Correo: item.correo ?? "",
          Estado: labels[item.status],
          "Total de citas del contacto": contact?.totalAppointments ?? history.length,
          "Ultima cita del contacto": contact?.lastAppointmentDate ?? item.date,
          "Google Contacts": getGoogleContactsLabel(googleContactId)
        };
      })
    );
  }

  if (loading) {
    return <main className="page"><div className="shell"><section className="card panel-card"><p className="copy">Cargando panel...</p></section></div></main>;
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
              <div className="list">
                <article className="apt">
                  <div>
                    <strong>Fecha de la cita</strong>
                    <p className="copy">Usa este filtro para revisar que citas estan programadas para asistir entre estas fechas.</p>
                    <div className="filters">
                      <div className="field"><label htmlFor="appointmentDateFrom">Desde</label><input id="appointmentDateFrom" type="date" value={appointmentDateFrom} onChange={(event) => setAppointmentDateFrom(event.target.value)} /></div>
                      <div className="field"><label htmlFor="appointmentDateTo">Hasta</label><input id="appointmentDateTo" type="date" value={appointmentDateTo} onChange={(event) => setAppointmentDateTo(event.target.value)} /></div>
                    </div>
                  </div>
                </article>
                <article className="apt">
                  <div>
                    <strong>Fecha en que se agendo</strong>
                    <p className="copy">Usa este filtro para medir cuantas citas se registraron en un periodo. Es el mas util para reportes de publicidad.</p>
                    <div className="filters">
                      <div className="field"><label htmlFor="registrationDateFrom">Desde</label><input id="registrationDateFrom" type="date" value={registrationDateFrom} onChange={(event) => setRegistrationDateFrom(event.target.value)} /></div>
                      <div className="field"><label htmlFor="registrationDateTo">Hasta</label><input id="registrationDateTo" type="date" value={registrationDateTo} onChange={(event) => setRegistrationDateTo(event.target.value)} /></div>
                    </div>
                  </div>
                </article>
              </div>
              <p className="copy">
                <strong>Resultado:</strong> {appointmentReportSummary.total} citas encontradas.
                {" "}Fecha de cita: {appointmentReportSummary.appointmentPeriod}.
                {" "}Fecha en que se agendo: {appointmentReportSummary.registrationPeriod}.
              </p>
              <div className="actions">
                <button className="secondary" onClick={exportAppointments} type="button"><Download size={17} />Descargar reporte de citas</button>
                <button className="secondary" onClick={clearAppointmentFilters} type="button">Limpiar filtros</button>
              </div>
              <div className="list">
                {filtered.map((item) => {
                  const contact = contactByWhatsapp.get(item.whatsapp);
                  const history = appointmentHistoryByWhatsapp.get(item.whatsapp) ?? [];
                  const totalAppointments = contact?.totalAppointments ?? history.length;
                  const lastAppointmentDate = contact?.lastAppointmentDate ?? item.date;
                  const googleContactId = item.googleContactId ?? contact?.googleContactId;
                  return (
                    <article className="apt" key={item.id}>
                      <div>
                        <strong>Cita para: {item.date} - {item.time}</strong>
                        <p className="copy"><strong>{formatContactName(item.firstName, item.lastName)}</strong></p>
                        <p className="copy">Tipo: {getAppointmentTypeLabel(item)} - {getServiceLabel(item)}</p>
                        <p className="copy">Agendada el: {getRegistrationLabel(item.createdAt)}</p>
                        <p className="copy">WhatsApp: {item.whatsapp}</p>
                        {item.correo && <p className="copy">Correo: {item.correo}</p>}
                        <p className="copy">Google Contacts: {getGoogleContactsLabel(googleContactId)}</p>
                        <p className="copy">Total de citas: {totalAppointments} - Ultima cita: {lastAppointmentDate}</p>
                        {history.length > 0 && <p className="copy">Historial de citas: {formatHistory(history)}</p>}
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
                        <p className="copy">Google Contacts: {getGoogleContactsLabel(contact.googleContactId)}</p>
                        <p className="copy">Total de citas: {contact.totalAppointments} - Ultima cita: {contact.lastAppointmentDate}</p>
                        <p className="copy">Primera cita: {contact.firstAppointmentDate}</p>
                        {history.length > 0 && <p className="copy">Historial de citas: {formatHistory(history)}</p>}
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
