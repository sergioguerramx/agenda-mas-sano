import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAdminEmail } from "@/lib/admin-auth";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";

export const runtime = "nodejs";

function normalizeEmail(value?: string) {
  return value?.trim().toLowerCase() ?? "";
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function GET(request: NextRequest) {
  if (!await getAuthenticatedAdminEmail(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const client = createSupabaseServiceRoleClient();
  const { data, error } = await client
    .from("message_access_users")
    .select("email, active, created_at, updated_at")
    .order("email", { ascending: true });

  if (error) return NextResponse.json({ error: "No se pudieron cargar los accesos." }, { status: 500 });
  return NextResponse.json({ users: data ?? [] });
}

export async function POST(request: NextRequest) {
  const adminEmail = await getAuthenticatedAdminEmail(request);
  if (!adminEmail) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const payload = await request.json().catch(() => ({})) as { email?: string };
  const email = normalizeEmail(payload.email);
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Escribe un correo válido." }, { status: 400 });
  }

  const client = createSupabaseServiceRoleClient();
  const { data, error } = await client
    .from("message_access_users")
    .upsert({
      email,
      active: true,
      created_by_email: adminEmail,
      updated_at: new Date().toISOString()
    }, { onConflict: "email" })
    .select("email, active, created_at, updated_at")
    .single();

  if (error || !data) return NextResponse.json({ error: "No se pudo agregar el acceso." }, { status: 500 });
  return NextResponse.json({ user: data });
}

export async function DELETE(request: NextRequest) {
  if (!await getAuthenticatedAdminEmail(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const payload = await request.json().catch(() => ({})) as { email?: string };
  const email = normalizeEmail(payload.email);
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Escribe un correo válido." }, { status: 400 });
  }

  const client = createSupabaseServiceRoleClient();
  const { error } = await client.from("message_access_users").delete().eq("email", email);
  if (error) return NextResponse.json({ error: "No se pudo retirar el acceso." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
