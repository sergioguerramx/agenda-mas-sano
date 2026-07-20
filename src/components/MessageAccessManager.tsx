"use client";

import { ArrowLeft, LogIn, Trash2, UserPlus, Users } from "lucide-react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { isAllowedAdminEmail } from "@/lib/admin";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

const PRODUCTION_SITE_URL = "https://agenda.massanonh.com";

type AccessUser = {
  email: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

function getPanelRedirectUrl() {
  const browserOrigin = window.location.origin.replace(/\/+$/, "");
  const envSiteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
  const safeSiteUrl = browserOrigin.includes("localhost")
    ? envSiteUrl && !envSiteUrl.includes("localhost") ? envSiteUrl : PRODUCTION_SITE_URL
    : browserOrigin;
  return `${safeSiteUrl}/auth/panel-callback`;
}

async function checkAdmin(client: SupabaseClient, session: Session | null) {
  const email = session?.user.email ?? "";
  if (!session || !isAllowedAdminEmail(email)) return false;
  const { data } = await client.from("admin_users").select("email").eq("email", email).maybeSingle();
  return Boolean(data);
}

export function MessageAccessManager() {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState("");

  const authorizedFetch = useCallback(async (input: string, init?: RequestInit) => {
    if (!client || !session) throw new Error("Tu sesión terminó. Vuelve a entrar.");
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token ?? session.access_token;
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  }, [client, session]);

  const loadUsers = useCallback(async () => {
    const response = await authorizedFetch("/api/admin/message-access");
    const data = await response.json() as { error?: string; users?: AccessUser[] };
    if (!response.ok || !data.users) throw new Error(data.error ?? "No se pudieron cargar los accesos.");
    setUsers(data.users);
  }, [authorizedFetch]);

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
      const hasAccess = await checkAdmin(supabase, nextSession);
      if (!active) return;
      setSession(nextSession);
      setAllowed(hasAccess);
      setLoading(false);
    }

    void supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      window.setTimeout(() => void applySession(nextSession), 0);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!allowed || !client || !session) return;
    void loadUsers().catch((error) => setNotice(error instanceof Error ? error.message : "No se pudieron cargar los accesos."));
  }, [allowed, client, loadUsers, session]);

  async function login() {
    if (!client) return;
    await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: getPanelRedirectUrl() } });
  }

  async function addUser() {
    if (!email.trim() || saving) return;
    setSaving(true);
    setNotice("");
    try {
      const response = await authorizedFetch("/api/admin/message-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "No se pudo agregar el acceso.");
      setEmail("");
      setNotice("Acceso agregado.");
      await loadUsers();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo agregar el acceso.");
    } finally {
      setSaving(false);
    }
  }

  async function removeUser(targetEmail: string) {
    if (saving) return;
    setSaving(true);
    setNotice("");
    try {
      const response = await authorizedFetch("/api/admin/message-access", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: targetEmail })
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "No se pudo retirar el acceso.");
      setConfirmRemove("");
      setNotice("Acceso retirado.");
      await loadUsers();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo retirar el acceso.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className="page"><div className="shell"><section className="card panel-card"><p className="copy">Cargando accesos...</p></section></div></main>;

  if (!session || !allowed) {
    return <main className="page"><div className="shell"><section className="card panel-card"><h2>Acceso administrativo</h2><p className="copy">Solo administración puede cambiar los correos autorizados.</p>{notice && <p className="error">{notice}</p>}<div className="actions"><button className="primary" onClick={login} type="button"><LogIn size={18} />Entrar con Google</button></div></section></div></main>;
  }

  return (
    <main className="page">
      <div className="shell">
        <header className="top">
          <div><p className="eyebrow">Panel interno</p><h1 className="title">Accesos a mensajes</h1></div>
          <button className="secondary compact-button" onClick={() => { window.location.href = "/panel"; }} type="button"><ArrowLeft size={17} />Volver</button>
        </header>
        <section className="card panel-card access-manager">
          <div className="access-intro"><Users size={24} /><div><strong>Equipo autorizado</strong><p className="copy">Estos correos pueden responder WhatsApp y agendar en ambas sucursales. No pueden abrir contactos, historiales ni configuración.</p></div></div>
          <div className="access-add">
            <label htmlFor="messageAccessEmail">Correo de Google</label>
            <div><input id="messageAccessEmail" type="email" placeholder="correo@gmail.com" value={email} onChange={(event) => setEmail(event.target.value)} /><button className="primary" disabled={!email.trim() || saving} onClick={addUser} type="button"><UserPlus size={17} />Agregar</button></div>
          </div>
          {notice && <p className={notice.includes("agregado") || notice.includes("retirado") ? "success-note" : "error"}>{notice}</p>}
          <div className="access-list">
            {users.map((user) => (
              <article key={user.email}>
                <div><strong>{user.email}</strong><span>Mensajes y agendas de San Nicolás y Monterrey Sur</span></div>
                {confirmRemove === user.email ? (
                  <div className="access-confirm"><button className="secondary" onClick={() => setConfirmRemove("")} type="button">Cancelar</button><button className="danger-button" disabled={saving} onClick={() => removeUser(user.email)} type="button">Confirmar retiro</button></div>
                ) : <button className="icon-button" aria-label={`Retirar acceso de ${user.email}`} onClick={() => setConfirmRemove(user.email)} type="button"><Trash2 size={17} /></button>}
              </article>
            ))}
            {users.length === 0 && <p className="copy">Todavía no hay correos autorizados.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
