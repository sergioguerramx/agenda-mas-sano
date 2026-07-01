"use client";

import { LogIn, Send } from "lucide-react";
import { useEffect, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { isAllowedAdminEmail } from "@/lib/admin";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

const PRODUCTION_SITE_URL = "https://agenda.massanonh.com";

type BackfillResult = {
  success?: boolean;
  dryRun?: boolean;
  selected?: number;
  sent?: number;
  failed?: number;
  skipped?: number;
  failures?: Array<{ id: string; reason: string }>;
  sample?: Array<{
    id: string;
    appointmentDate: string;
    appointmentTime: string;
    createdAt: string;
    origin: string;
  }>;
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

async function callBackfill(session: Session, dryRun: boolean, limit: number) {
  const response = await fetch("/api/admin/meta/backfill", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify({ dryRun, limit })
  });

  const body = (await response.json()) as BackfillResult;
  if (!response.ok) {
    throw new Error(body.error || "No se pudo ejecutar la accion.");
  }

  return body;
}

export function MetaBackfillTool() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<BackfillResult | null>(null);

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

  async function run(dryRun: boolean, limit: number) {
    if (!session) return;
    setRunning(true);
    setMessage("");
    setResult(null);

    try {
      const nextResult = await callBackfill(session, dryRun, limit);
      setResult(nextResult);
      setMessage(dryRun ? "Revision lista. No se envio nada a Meta." : "Envio terminado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo ejecutar la accion.");
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
            <h1 className="title">Meta histórico</h1>
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
          <p className="eyebrow">Panel interno</p>
          <h1 className="title">Meta histórico</h1>
          <p className="copy">
            Esta herramienta permite revisar y enviar citas ya registradas como compras historicas de $399 MXN.
          </p>
          <div className="actions">
            <button className="secondary" type="button" disabled={running} onClick={() => run(true, 5)}>
              Revisar primeras 5
            </button>
            <button className="primary" type="button" disabled={running} onClick={() => run(false, 1)}>
              <Send size={18} />
              Enviar prueba 1
            </button>
            <button className="primary" type="button" disabled={running} onClick={() => run(false, 200)}>
              <Send size={18} />
              Enviar todas
            </button>
          </div>
          {message ? <p className={message.includes("No se pudo") ? "error" : "copy"}>{message}</p> : null}
          {result ? (
            <div className="summary">
              <div className="row">
                <span>Seleccionadas</span>
                <strong>{result.selected ?? 0}</strong>
              </div>
              <div className="row">
                <span>Enviadas</span>
                <strong>{result.sent ?? 0}</strong>
              </div>
              <div className="row">
                <span>No enviadas</span>
                <strong>{(result.failed ?? 0) + (result.skipped ?? 0)}</strong>
              </div>
              {result.sample?.length ? (
                <p className="copy">Revision: se detectaron citas registradas desde {result.sample[0].createdAt}.</p>
              ) : null}
              {result.failures?.length ? (
                <p className="error">{result.failures[0].reason}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
