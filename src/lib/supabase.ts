import { createClient } from "@supabase/supabase-js";

const FALLBACK_SUPABASE_URL = "https://wsztokoowfwbebpeutnj.supabase.co";

export function normalizeSupabaseUrl(value: string) {
  const trimmedValue = value.trim();
  const withoutRestPath = trimmedValue.split("/rest/v1")[0];
  const normalizedUrl = withoutRestPath.replace(/\/+$/, "");

  if (!normalizedUrl || normalizedUrl.includes("vercel.app")) {
    return FALLBACK_SUPABASE_URL;
  }

  return normalizedUrl;
}

export function getSupabaseConfig() {
  return {
    url: normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""),
    anonKey: (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim()
  };
}

export function getSupabaseConfigError() {
  const config = getSupabaseConfig();

  if (!config.anonKey) {
    return "Falta configurar NEXT_PUBLIC_SUPABASE_ANON_KEY";
  }

  if (!config.url.includes("supabase.co")) {
    return "La URL de Supabase está mal configurada";
  }

  return "";
}

export function isSupabaseConfigured() {
  return !getSupabaseConfigError();
}

export function createSupabaseBrowserClient() {
  const config = getSupabaseConfig();
  const configError = getSupabaseConfigError();

  if (configError) {
    throw new Error(configError);
  }

  return createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
}

export function createSupabaseServerClient() {
  const config = getSupabaseConfig();
  const configError = getSupabaseConfigError();

  if (configError) {
    throw new Error(configError);
  }

  return createClient(config.url, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}
