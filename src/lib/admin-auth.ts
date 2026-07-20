import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase";

function getAuthenticatedClient(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return null;

  const config = getSupabaseConfig();
  return createClient(config.url, config.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export async function getAuthenticatedAdminEmail(request: NextRequest) {
  const client = getAuthenticatedClient(request);
  if (!client) return "";
  const { data: admin, error } = await client
    .from("admin_users")
    .select("email")
    .maybeSingle();

  return error ? "" : admin?.email ?? "";
}

export async function getAuthenticatedMessagingEmail(request: NextRequest) {
  const client = getAuthenticatedClient(request);
  if (!client) return "";
  const [{ data: admin }, { data: operator }] = await Promise.all([
    client.from("admin_users").select("email").maybeSingle(),
    client.from("message_access_users").select("email").eq("active", true).maybeSingle()
  ]);

  return admin?.email ?? operator?.email ?? "";
}
