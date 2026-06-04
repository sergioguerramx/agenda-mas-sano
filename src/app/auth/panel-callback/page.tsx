"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

export default function PanelAuthCallbackPage() {
  const [message, setMessage] = useState("Validando acceso...");

  useEffect(() => {
    async function finishLogin() {
      if (!isSupabaseConfigured()) {
        setMessage("Falta conectar Supabase.");
        return;
      }

      const supabase = createSupabaseBrowserClient();
      const searchParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const code = searchParams.get("code");
      const hasHashSession = hashParams.has("access_token") || hashParams.has("refresh_token");

      try {
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (hasHashSession) {
          const { error } = await supabase.auth.getSession();
          if (error) throw error;
        }

        window.location.replace("/panel");
      } catch (error) {
        const detail = error instanceof Error ? error.message : "No se pudo completar el login.";
        setMessage(`No se pudo completar el login: ${detail}`);
      }
    }

    void finishLogin();
  }, []);

  return (
    <main className="page">
      <div className="shell">
        <section className="card panel-card">
          <h1 className="title">Acceso</h1>
          <p className="copy">{message}</p>
        </section>
      </div>
    </main>
  );
}
