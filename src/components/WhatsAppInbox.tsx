"use client";

import { ArrowLeft, LogIn, MessageCircle, RefreshCw, Send } from "lucide-react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isAllowedAdminEmail } from "@/lib/admin";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

const PRODUCTION_SITE_URL = "https://agenda.massanonh.com";

type Conversation = {
  id: string;
  whatsapp: string;
  contact_name: string | null;
  unread_count: number;
  last_inbound_at: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_direction: 1 | 2 | null;
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
  last_attended_at: string | null;
  segment_key: string;
};

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

function deliveryLabel(message: InboxMessage) {
  if (message.direction === 1) return "";
  if (message.delivery_status === 3) return "Leído";
  if (message.delivery_status === 2) return "Entregado";
  if (message.delivery_status === 1) return "Enviado";
  if (message.delivery_status === -1) return "No entregado";
  return "Procesando";
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
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);

  const selected = conversations.find((item) => item.id === selectedId) ?? null;
  const filteredConversations = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return conversations;
    return conversations.filter((item) => `${item.contact_name ?? ""} ${item.whatsapp} ${item.last_message_preview ?? ""}`.toLowerCase().includes(value));
  }, [conversations, search]);

  const loadConversations = useCallback(async (supabase: SupabaseClient) => {
    const { data, error } = await supabase
      .from("whatsapp_conversations")
      .select("id, whatsapp, contact_name, unread_count, last_inbound_at, last_message_at, last_message_preview, last_message_direction")
      .order("last_message_at", { ascending: false });
    if (error) {
      setNotice("La bandeja todavía no está activada en la base de datos.");
      return;
    }
    setConversations((data ?? []) as Conversation[]);
  }, []);

  const loadConversation = useCallback(async (supabase: SupabaseClient, conversation: Conversation) => {
    const [{ data: messageData }, { data: patientData }] = await Promise.all([
      supabase
        .from("whatsapp_messages")
        .select("id, meta_message_id, direction, message_type, body, delivery_status, sent_at, delivered_at, read_at")
        .eq("conversation_id", conversation.id)
        .order("sent_at", { ascending: true }),
      supabase
        .from("patient_activity_summary")
        .select("patient_id, full_name, last_attended_at, segment_key")
        .eq("whatsapp", conversation.whatsapp)
    ]);
    setMessages((messageData ?? []) as InboxMessage[]);
    setPatientMatches((patientData ?? []) as PatientMatch[]);
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

  async function selectConversation(conversation: Conversation) {
    if (!client) return;
    setSelectedId(conversation.id);
    setNotice("");
    await loadConversation(client, conversation);
  }

  async function sendMessage() {
    if (!client || !session || !selected || !draft.trim() || sending) return;
    setSending(true);
    setNotice("");
    const body = draft.trim();
    try {
      const response = await fetch("/api/admin/whatsapp/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ conversationId: selected.id, body })
      });
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
    <main className="page">
      <div className="shell inbox-shell">
        <header className="top">
          <div><p className="eyebrow">Panel interno</p><h1 className="title">Mensajes de Más Sano</h1></div>
          <button className="secondary compact-button" onClick={() => { window.location.href = "/panel"; }} type="button"><ArrowLeft size={17} />Agenda</button>
        </header>
        <section className="card inbox-layout">
          <aside className={`inbox-sidebar ${selected ? "has-selection" : ""}`}>
            <div className="inbox-sidebar-header">
              <div><strong>Conversaciones</strong><p className="copy inbox-number">Número de campañas: 81 2576 1735</p></div>
              <button className="icon-button" onClick={() => client && loadConversations(client)} aria-label="Actualizar conversaciones" type="button"><RefreshCw size={17} /></button>
            </div>
            <input className="inbox-search" type="search" placeholder="Buscar nombre o WhatsApp" value={search} onChange={(event) => setSearch(event.target.value)} />
            <div className="conversation-list">
              {filteredConversations.map((conversation) => (
                <button className={`conversation-item ${selectedId === conversation.id ? "active" : ""}`} key={conversation.id} onClick={() => selectConversation(conversation)} type="button">
                  <span className="conversation-icon"><MessageCircle size={17} /></span>
                  <span className="conversation-copy"><strong>{conversation.contact_name || conversation.whatsapp}</strong><small>{conversation.last_message_direction === 2 ? "Tú: " : ""}{conversation.last_message_preview || "Sin mensajes"}</small></span>
                  <span className="conversation-meta"><small>{formatDateTime(conversation.last_message_at)}</small>{conversation.unread_count > 0 && <b>{conversation.unread_count}</b>}</span>
                </button>
              ))}
              {filteredConversations.length === 0 && <p className="copy empty-inbox">Aquí aparecerán los mensajes nuevos cuando terminemos la conexión con Meta.</p>}
            </div>
          </aside>
          <section className={`chat-panel ${selected ? "open" : ""}`}>
            {!selected ? <div className="chat-placeholder"><MessageCircle size={32} /><strong>Selecciona una conversación</strong><p className="copy">Podrás ver a la paciente, su historial y responder desde aquí.</p></div> : (
              <>
                <header className="chat-header">
                  <button className="icon-button mobile-back" onClick={() => setSelectedId("")} aria-label="Volver a conversaciones" type="button"><ArrowLeft size={18} /></button>
                  <div><strong>{selected.contact_name || selected.whatsapp}</strong><p className="copy">{selected.whatsapp}</p></div>
                  <div className="patient-matches">
                    {patientMatches.map((patient) => <span className="badge" key={patient.patient_id}>{patient.full_name} · {segmentLabel(patient.segment_key)}</span>)}
                    {patientMatches.length === 0 && <span className="badge">Contacto aún no relacionado</span>}
                  </div>
                </header>
                <div className="message-list">
                  {messages.map((message) => <div className={`message-bubble ${message.direction === 2 ? "outbound" : "inbound"}`} key={message.id}><p>{message.body || "Mensaje sin texto"}</p><small>{formatDateTime(message.sent_at)} {deliveryLabel(message)}</small></div>)}
                  {messages.length === 0 && <p className="copy empty-inbox">Todavía no hay mensajes guardados.</p>}
                </div>
                <div className="composer">
                  {notice && <p className="error composer-notice">{notice}</p>}
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

