"use client";

import {
  ArrowLeft,
  CalendarPlus,
  ClipboardList,
  LogIn,
  MessageCircle,
  RefreshCw,
  Save,
  Send,
  UserRound
} from "lucide-react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAllowedAdminEmail } from "@/lib/admin";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

const PRODUCTION_SITE_URL = "https://agenda.massanonh.com";

const WORKFLOW_OPTIONS = [
  { value: "nuevo", label: "Nuevo" },
  { value: "interesado", label: "Interesado" },
  { value: "cita_agendada", label: "Cita agendada" },
  { value: "seguimiento", label: "Dar seguimiento" },
  { value: "no_interesado", label: "No interesado" },
  { value: "cerrado", label: "Atención cerrada" },
  { value: "no_contactar", label: "No contactar" }
] as const;

const BRANCH_OPTIONS = [
  { value: "", label: "Sucursal por confirmar" },
  { value: "SN", label: "San Nicolás" },
  { value: "MTY_SUR", label: "Monterrey Sur" }
] as const;

const QUICK_REPLIES = [
  {
    label: "Saludo",
    text: (name: string) => `Hola${name ? ` ${name}` : ""}, gracias por escribir a Más Sano. ¿En qué podemos ayudarte?`
  },
  {
    label: "Agendar",
    text: (name: string) => `Hola${name ? ` ${name}` : ""}. Con gusto podemos ayudarte a agendar. ¿Qué día y horario te resultaría más conveniente?`
  },
  {
    label: "Precio",
    text: () => "La Sesión Integral tiene una inversión de $399. Si gustas, revisamos los horarios disponibles para ti."
  },
  {
    label: "Ubicación SN",
    text: () => "Estamos en Av. Las Puentes 511, Col. Las Puentes 3er Sector, San Nicolás."
  },
  {
    label: "Confirmación",
    text: (name: string) => `Hola${name ? ` ${name}` : ""}. Te escribimos de Más Sano para confirmar tu cita. ¿Nos confirmas tu asistencia?`
  },
  {
    label: "Seguimiento",
    text: (name: string) => `Hola${name ? ` ${name}` : ""}, esperamos que estés muy bien. Queremos saber si podemos apoyarte para retomar tu seguimiento en Más Sano.`
  }
];

type Conversation = {
  id: string;
  whatsapp: string;
  contact_name: string | null;
  unread_count: number;
  last_inbound_at: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_direction: 1 | 2 | null;
  workflow_status: string;
  branch_interest: string | null;
  admin_note: string | null;
};

type InboxMessage = {
  id: number;
  meta_message_id: string;
  direction: 1 | 2;
  message_type: string;
  body: string | null;
  delivery_status: -1 | 0 | 1 | 2 | 3;
  sent_at: string;
  delivered_at: string | null;
  read_at: string | null;
};

type PatientMatch = {
  patient_id: string;
  full_name: string;
  first_appointment_at: string | null;
  last_appointment_at: string | null;
  last_attended_at: string | null;
  total_appointments: number;
  attended_appointments: number;
  has_future_appointment: boolean;
  last_branch_id: number | null;
  segment_key: string;
};

type PatientHistory = {
  id: string;
  patient_id: string;
  branch_id: number;
  scheduled_at: string;
  confirmed: boolean | null;
  attended: boolean | null;
  released_at_8: boolean;
  cancelled: boolean;
};

type Branch = { id: number; name: string };

function getPanelRedirectUrl() {
  const browserOrigin = window.location.origin.replace(/\/+$/, "");
  const envSiteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
  const safeSiteUrl = browserOrigin.includes("localhost")
    ? envSiteUrl && !envSiteUrl.includes("localhost") ? envSiteUrl : PRODUCTION_SITE_URL
    : browserOrigin;
  return `${safeSiteUrl}/auth/panel-callback`;
}

function formatDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Monterrey",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDate(value: string | null) {
  if (!value) return "Sin registro";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin registro";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Monterrey",
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function segmentLabel(value: string) {
  const labels: Record<string, string> = {
    activa: "Activa",
    seguimiento: "En seguimiento",
    inactiva: "Inactiva",
    reactivacion: "Reactivación",
    primera_consulta_sin_regreso: "Primera consulta sin regreso",
    agendo_no_acudio: "Agendó y no acudió",
    sin_asistencia_comprobada: "Sin asistencia comprobada",
    con_cita_futura: "Tiene cita futura"
  };
  return labels[value] ?? value;
}

function workflowLabel(value: string) {
  return WORKFLOW_OPTIONS.find((option) => option.value === value)?.label ?? "Nuevo";
}

function deliveryLabel(message: InboxMessage) {
  if (message.direction === 1) return "";
  if (message.delivery_status === 3) return "Leído";
  if (message.delivery_status === 2) return "Entregado";
  if (message.delivery_status === 1) return "Enviado";
  if (message.delivery_status === -1) return "No entregado";
  return "Procesando";
}

function historyStatus(item: PatientHistory) {
  if (item.attended) return "Acudió";
  if (item.cancelled || item.released_at_8) return "Canceló";
  if (new Date(item.scheduled_at).getTime() > Date.now()) return item.confirmed ? "Próxima confirmada" : "Próxima";
  if (item.confirmed) return "Confirmó, sin asistencia";
  return "Sin asistencia confirmada";
}

function firstName(value?: string | null) {
  return value?.trim().split(/\s+/)[0] ?? "";
}

function buildBookingUrl(conversation: Conversation, patient: PatientMatch | null) {
  const params = new URLSearchParams({ whatsapp: conversation.whatsapp, adOrigin: "whatsapp_directo" });
  if (patient?.full_name) params.set("name", patient.full_name);
  return `/?${params.toString()}#agenda`;
}

async function isAdmin(client: SupabaseClient, session: Session | null) {
  const email = session?.user.email ?? "";
  if (!session || !isAllowedAdminEmail(email)) return false;
  const { data } = await client.from("admin_users").select("email").eq("email", email).maybeSingle();
  return Boolean(data);
}

export function WhatsAppInbox() {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [patientMatches, setPatientMatches] = useState<PatientMatch[]>([]);
  const [patientHistory, setPatientHistory] = useState<PatientHistory[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activePatientId, setActivePatientId] = useState("");
  const [search, setSearch] = useState("");
  const [workflowFilter, setWorkflowFilter] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [workflowStatus, setWorkflowStatus] = useState("nuevo");
  const [branchInterest, setBranchInterest] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const messageListRef = useRef<HTMLDivElement | null>(null);

  const selected = conversations.find((item) => item.id === selectedId) ?? null;
  const activePatient = patientMatches.find((patient) => patient.patient_id === activePatientId) ?? patientMatches[0] ?? null;
  const activeHistory = patientHistory.filter((item) => item.patient_id === activePatient?.patient_id).slice(0, 5);
  const branchNames = useMemo(() => new Map(branches.map((branch) => [branch.id, branch.name])), [branches]);
  const filteredConversations = useMemo(() => {
    const value = search.trim().toLowerCase();
    return conversations.filter((item) => {
      if (workflowFilter && item.workflow_status !== workflowFilter) return false;
      if (unreadOnly && item.unread_count === 0) return false;
      if (!value) return true;
      return `${item.contact_name ?? ""} ${item.whatsapp} ${item.last_message_preview ?? ""}`.toLowerCase().includes(value);
    });
  }, [conversations, search, unreadOnly, workflowFilter]);

  const loadConversations = useCallback(async (supabase: SupabaseClient) => {
    const { data, error } = await supabase
      .from("whatsapp_conversations")
      .select("id, whatsapp, contact_name, unread_count, last_inbound_at, last_message_at, last_message_preview, last_message_direction, workflow_status, branch_interest, admin_note")
      .order("last_message_at", { ascending: false });
    if (error) {
      setNotice("La bandeja necesita completar su actualización de seguimiento.");
      return;
    }
    setConversations((data ?? []) as Conversation[]);
  }, []);

  const loadConversation = useCallback(async (supabase: SupabaseClient, conversation: Conversation) => {
    const [{ data: messageData }, { data: patientData }, { data: branchData }] = await Promise.all([
      supabase
        .from("whatsapp_messages")
        .select("id, meta_message_id, direction, message_type, body, delivery_status, sent_at, delivered_at, read_at")
        .eq("conversation_id", conversation.id)
        .order("sent_at", { ascending: true }),
      supabase
        .from("patient_activity_summary")
        .select("patient_id, full_name, first_appointment_at, last_appointment_at, last_attended_at, total_appointments, attended_appointments, has_future_appointment, last_branch_id, segment_key")
        .eq("whatsapp", conversation.whatsapp),
      supabase.from("branches").select("id, name")
    ]);

    const patients = (patientData ?? []) as PatientMatch[];
    setMessages((messageData ?? []) as InboxMessage[]);
    setPatientMatches(patients);
    setBranches((branchData ?? []) as Branch[]);
    setActivePatientId((current) => patients.some((patient) => patient.patient_id === current) ? current : patients[0]?.patient_id ?? "");

    if (patients.length > 0) {
      const { data: historyData } = await supabase
        .from("patient_appointment_history")
        .select("id, patient_id, branch_id, scheduled_at, confirmed, attended, released_at_8, cancelled")
        .in("patient_id", patients.map((patient) => patient.patient_id))
        .order("scheduled_at", { ascending: false })
        .limit(30);
      setPatientHistory((historyData ?? []) as PatientHistory[]);
    } else {
      setPatientHistory([]);
    }

    if (conversation.unread_count > 0) {
      await supabase.from("whatsapp_conversations").update({ unread_count: 0 }).eq("id", conversation.id);
      setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, unread_count: 0 } : item));
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setNotice("Falta conectar la base de datos.");
      setLoading(false);
      return;
    }

    const supabase = createSupabaseBrowserClient();
    setClient(supabase);
    let active = true;

    async function applySession(nextSession: Session | null) {
      const hasAccess = await isAdmin(supabase, nextSession);
      if (!active) return;
      setSession(nextSession);
      setAllowed(hasAccess);
      setLoading(false);
      if (hasAccess) await loadConversations(supabase);
    }

    void supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      window.setTimeout(() => void applySession(nextSession), 0);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [loadConversations]);

  useEffect(() => {
    if (!client || !allowed) return;
    const timer = window.setInterval(() => {
      void loadConversations(client);
      if (selected) void loadConversation(client, selected);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [allowed, client, loadConversation, loadConversations, selected]);

  useEffect(() => {
    const element = messageListRef.current;
    if (!element) return;
    window.requestAnimationFrame(() => element.scrollTo({ top: element.scrollHeight, behavior: "smooth" }));
  }, [messages, selectedId]);

  async function selectConversation(conversation: Conversation) {
    if (!client) return;
    setSelectedId(conversation.id);
    setWorkflowStatus(conversation.workflow_status || "nuevo");
    setBranchInterest(conversation.branch_interest ?? "");
    setAdminNote(conversation.admin_note ?? "");
    setShowDetails(false);
    setNotice("");
    await loadConversation(client, conversation);
  }

  async function saveConversationDetails() {
    if (!client || !session || !selected || savingDetails) return;
    setSavingDetails(true);
    setNotice("");
    const updatedAt = new Date().toISOString();
    const changes = {
      workflow_status: workflowStatus,
      branch_interest: branchInterest || null,
      admin_note: adminNote.trim() || null,
      updated_by_email: session.user.email ?? null,
      updated_at: updatedAt
    };
    const { error } = await client.from("whatsapp_conversations").update(changes).eq("id", selected.id);
    if (error) {
      setNotice("No se pudo guardar el seguimiento.");
    } else {
      setConversations((current) => current.map((item) => item.id === selected.id ? { ...item, ...changes } : item));
      setNotice("Seguimiento guardado.");
    }
    setSavingDetails(false);
  }

  async function sendMessage() {
    if (!client || !session || !selected || !draft.trim() || sending) return;
    setSending(true);
    setNotice("");
    const body = draft.trim();
    try {
      const sendWithToken = (accessToken: string) => fetch("/api/admin/whatsapp/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ conversationId: selected.id, body })
      });

      const { data: currentSessionData } = await client.auth.getSession();
      let accessToken = currentSessionData.session?.access_token ?? session.access_token;
      let response = await sendWithToken(accessToken);

      if (response.status === 401) {
        const { data: refreshedSessionData, error: refreshError } = await client.auth.refreshSession();
        accessToken = refreshedSessionData.session?.access_token ?? "";
        if (refreshError || !accessToken) throw new Error("Tu sesión terminó. Vuelve a entrar con Google.");
        response = await sendWithToken(accessToken);
      }

      const data = await response.json() as { error?: string; message?: InboxMessage };
      if (!response.ok || !data.message) throw new Error(data.error ?? "No se pudo enviar.");
      setDraft("");
      setMessages((current) => [...current, data.message as InboxMessage]);
      await loadConversations(client);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo enviar el mensaje.");
    } finally {
      setSending(false);
    }
  }

  async function login() {
    if (!client) return;
    await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: getPanelRedirectUrl() } });
  }

  if (loading) return <main className="page"><div className="shell"><section className="card panel-card"><p className="copy">Cargando bandeja...</p></section></div></main>;

  if (!session || !allowed) {
    return <main className="page"><div className="shell"><section className="card panel-card"><h2>Acceso administrativo</h2><p className="copy">Entra con Google para abrir la bandeja de Más Sano.</p>{notice && <p className="error">{notice}</p>}<div className="actions"><button className="primary" onClick={login} type="button"><LogIn size={18} />Entrar con Google</button></div></section></div></main>;
  }

  return (
    <main className="page inbox-page">
      <div className="shell inbox-shell">
        <header className="top inbox-top">
          <div><p className="eyebrow">Panel interno</p><h1 className="title">Mensajes de Más Sano</h1></div>
          <button className="secondary compact-button" onClick={() => { window.location.href = "/panel"; }} type="button"><ArrowLeft size={17} />Agenda</button>
        </header>
        <section className="card inbox-layout">
          <aside className={`inbox-sidebar ${selected ? "has-selection" : ""}`}>
            <div className="inbox-sidebar-header">
              <div><strong>Conversaciones</strong><p className="copy inbox-number">Número de campañas: 81 2576 1735</p></div>
              <button className="icon-button" onClick={() => client && loadConversations(client)} aria-label="Actualizar conversaciones" type="button"><RefreshCw size={17} /></button>
            </div>
            <div className="inbox-filters">
              <input className="inbox-search" type="search" placeholder="Buscar nombre o WhatsApp" value={search} onChange={(event) => setSearch(event.target.value)} />
              <select aria-label="Filtrar por estado" value={workflowFilter} onChange={(event) => setWorkflowFilter(event.target.value)}>
                <option value="">Todos los estados</option>
                {WORKFLOW_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <label className="unread-filter"><input checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} type="checkbox" />Solo pendientes</label>
            </div>
            <div className="conversation-list">
              {filteredConversations.map((conversation) => (
                <button className={`conversation-item ${selectedId === conversation.id ? "active" : ""}`} key={conversation.id} onClick={() => selectConversation(conversation)} type="button">
                  <span className="conversation-icon"><MessageCircle size={17} /></span>
                  <span className="conversation-copy"><strong>{conversation.contact_name || conversation.whatsapp}</strong><small>{conversation.last_message_direction === 2 ? "Tú: " : ""}{conversation.last_message_preview || "Sin mensajes"}</small><em>{workflowLabel(conversation.workflow_status)}</em></span>
                  <span className="conversation-meta"><small>{formatDateTime(conversation.last_message_at)}</small>{conversation.unread_count > 0 && <b>{conversation.unread_count}</b>}</span>
                </button>
              ))}
              {filteredConversations.length === 0 && <p className="copy empty-inbox">No hay conversaciones con estos filtros.</p>}
            </div>
          </aside>
          <section className={`chat-panel ${selected ? "open" : ""}`}>
            {!selected ? <div className="chat-placeholder"><MessageCircle size={32} /><strong>Selecciona una conversación</strong><p className="copy">Podrás ver a la paciente, su historial, registrar seguimiento y responder desde aquí.</p></div> : (
              <>
                <header className="chat-header">
                  <button className="icon-button mobile-back" onClick={() => setSelectedId("")} aria-label="Volver a conversaciones" type="button"><ArrowLeft size={18} /></button>
                  <div className="chat-contact"><strong>{selected.contact_name || selected.whatsapp}</strong><p className="copy">{selected.whatsapp}</p></div>
                  <div className="patient-matches">
                    {patientMatches.map((patient) => <button className={`badge patient-badge ${activePatient?.patient_id === patient.patient_id ? "active" : ""}`} key={patient.patient_id} onClick={() => setActivePatientId(patient.patient_id)} type="button">{patient.full_name} · {segmentLabel(patient.segment_key)}</button>)}
                    {patientMatches.length === 0 && <span className="badge">Contacto aún no relacionado</span>}
                  </div>
                </header>

                <div className="chat-action-bar">
                  <a className="secondary mini-action" href={buildBookingUrl(selected, activePatient)} target="_blank" rel="noreferrer"><CalendarPlus size={16} />Agendar San Nicolás</a>
                  <button className={`secondary mini-action ${showDetails ? "active" : ""}`} onClick={() => setShowDetails((value) => !value)} type="button"><UserRound size={16} />Ficha y seguimiento</button>
                </div>

                {showDetails && (
                  <section className="conversation-details-panel">
                    <div className="patient-summary-section">
                      <div className="detail-heading"><ClipboardList size={17} /><strong>Paciente e historial</strong></div>
                      {activePatient ? (
                        <div className="patient-summary-card">
                          <strong>{activePatient.full_name}</strong>
                          <span>{branchNames.get(activePatient.last_branch_id ?? -1) ?? "Sucursal por confirmar"}</span>
                          <div className="patient-stats"><span><b>{activePatient.total_appointments}</b>Citas</span><span><b>{activePatient.attended_appointments}</b>Asistencias</span><span><b>{formatDate(activePatient.last_attended_at)}</b>Última visita</span></div>
                          <span className="badge">{segmentLabel(activePatient.segment_key)}</span>
                          {patientMatches.length > 1 && <small>Este WhatsApp está compartido por {patientMatches.length} pacientes. Selecciona arriba a quién corresponde el seguimiento.</small>}
                        </div>
                      ) : <p className="copy compact-copy">Este teléfono todavía no coincide con la base histórica.</p>}
                      {activeHistory.length > 0 && <div className="history-list">{activeHistory.map((item) => <div key={item.id}><span>{formatDateTime(item.scheduled_at)} · {branchNames.get(item.branch_id) ?? "Sucursal"}</span><strong>{historyStatus(item)}</strong></div>)}</div>}
                    </div>
                    <div className="follow-up-form">
                      <div className="detail-heading"><Save size={17} /><strong>Seguimiento administrativo</strong></div>
                      <label>Estado<select value={workflowStatus} onChange={(event) => setWorkflowStatus(event.target.value)}>{WORKFLOW_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                      <label>Sucursal de interés<select value={branchInterest} onChange={(event) => setBranchInterest(event.target.value)}>{BRANCH_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                      <label>Nota administrativa<textarea placeholder="Ej. Prefiere horario por la tarde. No incluir datos clínicos." value={adminNote} onChange={(event) => setAdminNote(event.target.value)} /></label>
                      <button className="primary save-follow-up" disabled={savingDetails} onClick={saveConversationDetails} type="button"><Save size={16} />{savingDetails ? "Guardando" : "Guardar seguimiento"}</button>
                    </div>
                  </section>
                )}

                <div className="message-list" ref={messageListRef}>
                  {messages.map((message) => <div className={`message-bubble ${message.direction === 2 ? "outbound" : "inbound"}`} key={message.id}><p>{message.body || "Mensaje sin texto"}</p><small>{formatDateTime(message.sent_at)} {deliveryLabel(message)}</small></div>)}
                  {messages.length === 0 && <p className="copy empty-inbox">Todavía no hay mensajes guardados.</p>}
                </div>

                <div className="quick-replies" aria-label="Respuestas rápidas">
                  {QUICK_REPLIES.map((reply) => <button key={reply.label} onClick={() => setDraft(reply.text(firstName(activePatient?.full_name)))} type="button">{reply.label}</button>)}
                </div>
                <div className="composer">
                  {notice && <p className={notice === "Seguimiento guardado." ? "success-note composer-notice" : "error composer-notice"}>{notice}</p>}
                  <textarea aria-label="Escribe una respuesta" placeholder="Escribe una respuesta..." value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} />
                  <button className="primary send-button" disabled={!draft.trim() || sending} onClick={sendMessage} type="button"><Send size={17} />{sending ? "Enviando" : "Enviar"}</button>
                </div>
              </>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}
