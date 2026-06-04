"use client";

import { useEffect } from "react";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

export const PANEL_AUTH_REDIRECT_KEY = "mas_sano_panel_auth_redirect";

function hasAuthResponse() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const searchParams = new URLSearchParams(window.location.search);
  const authKeys = ["access_token", "refresh_token", "provider_token", "code", "error", "error_description"];

  return authKeys.some((key) => hashParams.has(key) || searchParams.has(key));
}

export function AuthRedirectHandler() {
  useEffect(() => {
    if (!hasAuthResponse() || !isSupabaseConfigured()) return;
    if (window.location.pathname.replace(/\/+$/, "") === "/auth/callback") return;

    const requestedPanel = window.localStorage.getItem(PANEL_AUTH_REDIRECT_KEY) === "panel";
    const isPanelPath = window.location.pathname.replace(/\/+$/, "") === "/panel";

    createSupabaseBrowserClient().auth.getSession().finally(() => {
      window.localStorage.removeItem(PANEL_AUTH_REDIRECT_KEY);

      if (requestedPanel || !isPanelPath) {
        window.location.replace("/panel");
      } else if (window.location.hash || window.location.search) {
        window.history.replaceState(null, "", "/panel");
      }
    });
  }, []);

  return null;
}
