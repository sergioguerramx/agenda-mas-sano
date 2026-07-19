import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase";

export async function getAuthenticatedAdminEmail(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return "";

  const config = getSupabaseConfig();
  const userClient = createClient(config.url, config.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: admin, error } = await userClient
    .from("admin_users")
    .select("email")
    .maybeSingle();

  return error ? "" : admin?.email ?? "";
}
