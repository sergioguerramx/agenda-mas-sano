import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { createSupabaseServiceRoleClient, getSupabaseConfig } from "@/lib/supabase";

export async function getAuthenticatedUserEmail(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return "";

  const config = getSupabaseConfig();
  const authClient = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await authClient.auth.getUser(token);
  return error ? "" : data.user?.email?.trim().toLowerCase() ?? "";
}

export async function getAuthenticatedAdminEmail(request: NextRequest) {
  const email = await getAuthenticatedUserEmail(request);
  if (!email) return "";

  const client = createSupabaseServiceRoleClient();
  const { data: admin, error } = await client
    .from("admin_users")
    .select("email")
    .eq("email", email)
    .maybeSingle();

  return error ? "" : admin?.email ?? "";
}

export async function getAuthenticatedMessagingEmail(request: NextRequest) {
  const email = await getAuthenticatedUserEmail(request);
  if (!email) return "";

  const client = createSupabaseServiceRoleClient();
  const [{ data: admin }, { data: operator }] = await Promise.all([
    client.from("admin_users").select("email").eq("email", email).maybeSingle(),
    client.from("message_access_users").select("email").eq("email", email).eq("active", true).maybeSingle()
  ]);

  return admin?.email ?? operator?.email ?? "";
}
