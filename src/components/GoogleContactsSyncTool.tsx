"use client";

import { LogIn, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { isAllowedAdminEmail } from "@/lib/admin";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

const PRODUCTION_SITE_URL = "https://agenda.massanonh.com";

type AccountStatus = {
  configured?: boolean;
  connected?: boolean;
  email?: string;
  name?: string;
  reason?: string;
  error?: string;
};

type SyncResult = {
  success?: boolean;
  pendingContacts?: number;
  synced?: number;
  failed?: number;
  errors?: Array<{ whatsapp: string; reason: string }>;
  error?: string;
};

type TestContactResult = {
  success?: boolean;
  whatsapp?: string;
  count?: number;
  deleted?: number;
  contacts?: Array<{ resourceName: string; displayName: string; phoneNumbers: string[] }>;
  error?: string;
};

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

async function getAccountStatus(session: Session) {
  const response = await fetch("/api/admin/google-contacts", {
    headers: { authorization: `Bearer ${session.access_token}` }
  });
  const body = (await response.json()) as AccountStatus;
  if (!response.ok) throw new Error(body.error || body.reason || "No se pudo revisar Google Contacts.");
  return body;
}

async function syncPendingContacts(session: Session) {
  const response = await fetch("/api/admin/google-contacts/sync", {
    method: "POST",
    headers: { authorization: `Bearer ${session.access_token}` }
  });
  const body = (await response.json()) as SyncResult;
  if (!response.ok) throw new Error(body.error || "No se pudo sincronizar Google Contacts.");
  return body;
}

async function reviewTestContact(session: Session) {
  const response = await fetch("/api/admin/google-contacts/test-contact", {
    headers: { authorization: `Bearer ${session.access_token}` }
  });
  const body = (await response.json()) as TestContactResult;
  if (!response.ok) throw new Error(body.error || "No se pudo revisar el contacto de prueba.");
  return body;
}

async function deleteTestContact(session: Session) {
  const response = await fetch("/api/admin/google-contacts/test-contact", {
    method: "DELETE",
    headers: { authorization: `Bearer ${session.access_token}` }
  });
  const body = (await response.json()) as TestContactResult;
  if (!response.ok) throw new Error(body.error || "No se pudo borrar el contacto de prueba.");
  return body;
}

export function GoogleContactsSyncTool() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [testContact, setTestContact] = useState<TestContactResult | null>(null);

  useEffect(() => {
    let isActive = true;

    if (!isSupabaseConfigured()) {
      setMessage("Falta conectar Supabase.");
      setLoading(false);
      return;
    }

    const client = createSupabaseBrowserClient();
    setSupabase(client);

    async function initialize() {
      const { data, error } = await client.auth.getSession();
      if (!isActive) return;
      if (error) {
        setMessage("No se pudo validar el acceso.");
        setLoading(false);
        return;
      }

      const currentSession = data.session;
      const email = currentSession?.user.email ?? "";
      setSession(currentSession);
      setIsAdmin(Boolean(currentSession && isAllowedAdminEmail(email)));
      setLoading(false);
    }

    void initialize();

    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      const email = nextSession?.user.email ?? "";
      setSession(nextSession);
      setIsAdmin(Boolean(nextSession && isAllowedAdminEmail(email)));
    });

    return () => {
      isActive = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function login() {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: getPanelRedirectUrl() }
    });
  }

  async function reviewConnection() {
    if (!session) return;
    setRunning(true);
    setMessage("");
    setAccount(null);

    try {
      const nextAccount = await getAccountStatus(session);
      setAccount(nextAccount);
      setMessage(nextAccount.connected ? "Google Contacts esta conectado." : "Google Contacts requiere revision.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo revisar Google Contacts.");
    } finally {
      setRunning(false);
    }
  }

  async function runSync() {
    if (!session) return;
    setRunning(true);
    setMessage("");
    setResult(null);

    try {
      const nextResult = await syncPendingContacts(session);
      setResult(nextResult);
      setMessage("Sincronizacion terminada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo sincronizar Google Contacts.");
    } finally {
      setRunning(false);
    }
  }

  async function reviewTest() {
    if (!session) return;
    setRunning(true);
    setMessage("");

    try {
      const nextResult = await reviewTestContact(session);
      setTestContact(nextResult);
      setMessage(nextResult.count
        ? `Encontramos ${nextResult.count} contacto${nextResult.count === 1 ? "" : "s"} de prueba.`
        : "No encontramos contactos de prueba en Google Contacts.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo revisar el contacto de prueba.");
    } finally {
      setRunning(false);
    }
  }

  async function removeTest() {
    if (!session) return;
    if (!window.confirm("¿Deseas borrar de Google Contacts todos los registros asociados al número de prueba 81 1474 0974?")) return;

    setRunning(true);
    setMessage("");

    try {
      const nextResult = await deleteTestContact(session);
      setTestContact({ ...nextResult, count: 0, contacts: [] });
      setMessage(nextResult.deleted
        ? `Se borraron ${nextResult.deleted} contacto${nextResult.deleted === 1 ? "" : "s"} de prueba.`
        : "No había contactos de prueba por borrar.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo borrar el contacto de prueba.");
    } finally {
      setRunning(false);
    }
  }

  if (loading) {
    return (
      <main className="page">
        <section className="shell">
          <div className="panel-card card">Validando acceso...</div>
        </section>
      </main>
    );
  }

  if (!session || !isAdmin) {
    return (
      <main className="page">
        <section className="shell">
          <div className="panel-card card">
            <p className="eyebrow">Panel interno</p>
            <h1 className="title">Google Contacts</h1>
            <p className="copy">{message || "Entra con una cuenta autorizada para continuar."}</p>
            <button className="primary" type="button" onClick={login}>
              <LogIn size={18} />
              Entrar
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="shell">
        <div className="panel-card card">
          <div className="tabs">
            <button onClick={() => { window.location.href = "/panel"; }} type="button">Agenda</button>
            <button onClick={() => { window.location.href = "/panel?view=contacts"; }} type="button">Contactos</button>
            <button className="active" type="button">Google Contacts</button>
          </div>
          <p className="eyebrow">Panel interno</p>
          <h1 className="title">Google Contacts</h1>
          <p className="copy">Revisa la conexion y agrega a Google Contacts los contactos pendientes de la agenda.</p>
          <div className="actions">
            <button className="secondary" type="button" disabled={running} onClick={reviewConnection}>
              Revisar conexion
            </button>
            <button className="primary" type="button" disabled={running} onClick={runSync}>
              <RefreshCw size={18} />
              Sincronizar pendientes
            </button>
          </div>
          {message ? <p className={message.includes("No se pudo") || message.includes("requiere") ? "error" : "copy"}>{message}</p> : null}
          {account ? (
            <div className="summary">
              <div className="row"><span>Configurado</span><strong>{account.configured ? "Si" : "No"}</strong></div>
              <div className="row"><span>Conectado</span><strong>{account.connected ? "Si" : "No"}</strong></div>
              <div className="row"><span>Cuenta</span><strong>{account.email || account.name || "No disponible"}</strong></div>
              {account.reason ? <p className="error">{account.reason}</p> : null}
            </div>
          ) : null}
          {result ? (
            <div className="summary">
              <div className="row"><span>Contactos pendientes</span><strong>{result.pendingContacts ?? 0}</strong></div>
              <div className="row"><span>Sincronizados</span><strong>{result.synced ?? 0}</strong></div>
              <div className="row"><span>No sincronizados</span><strong>{result.failed ?? 0}</strong></div>
              {result.errors?.length ? <p className="error">{result.errors[0].reason}</p> : null}
            </div>
          ) : null}
          <div className="summary">
            <div className="row"><span>Número usado en pruebas</span><strong>81 1474 0974</strong></div>
            <div className="actions">
              <button className="secondary" type="button" disabled={running} onClick={reviewTest}>
                Revisar contacto de prueba
              </button>
              <button className="secondary" type="button" disabled={running} onClick={removeTest}>
                Borrar contacto de prueba
              </button>
            </div>
            {testContact?.contacts?.length ? (
              <p className="copy">
                {testContact.contacts.map((contact) => contact.displayName || contact.phoneNumbers[0]).join(", ")}
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
