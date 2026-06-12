import { NextResponse } from "next/server";
import { isAllowedAdminEmail } from "@/lib/admin";
import { createSupabaseServerClient, createSupabaseServiceRoleClient, isSupabaseConfigured } from "@/lib/supabase";
import { upsertGoogleContact } from "@/services/google-contacts";
import type { AppointmentRow } from "@/types/appointments";

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

async function verifyAdmin(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser(token);
  const email = data.user?.email ?? "";

  return Boolean(!error && isAllowedAdminEmail(email));
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Falta conectar Supabase." }, { status: 500 });
  }

  const isAdmin = await verifyAdmin(request);
  if (!isAdmin) {
    return NextResponse.json({ error: "No tienes acceso a esta accion." }, { status: 403 });
  }

  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("appointments")
    .select("id, first_name, last_name, whatsapp, appointment_date, appointment_time, status, google_contact_id, created_at, updated_at")
    .is("google_contact_id", null)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json({ error: "No se pudieron cargar los contactos pendientes." }, { status: 500 });
  }

  const latestByWhatsapp = new Map<string, AppointmentRow>();

  ((data ?? []) as AppointmentRow[]).forEach((appointment) => {
    const key = normalizePhone(appointment.whatsapp);
    if (key && !latestByWhatsapp.has(key)) latestByWhatsapp.set(key, appointment);
  });

  let synced = 0;
  let failed = 0;
  const errors: Array<{ whatsapp: string; reason: string }> = [];

  for (const appointment of latestByWhatsapp.values()) {
    try {
      const result = await upsertGoogleContact(appointment);

      if (!result.resourceName) {
        failed += 1;
        errors.push({ whatsapp: appointment.whatsapp, reason: result.reason ?? "Google Contacts no devolvio confirmacion." });
        continue;
      }

      await supabase
        .from("appointments")
        .update({ google_contact_id: result.resourceName })
        .eq("whatsapp", appointment.whatsapp);

      await supabase
        .from("contacts")
        .update({ google_contact_resource_name: result.resourceName })
        .eq("whatsapp", appointment.whatsapp);

      synced += 1;
    } catch (error) {
      failed += 1;
      errors.push({
        whatsapp: appointment.whatsapp,
        reason: error instanceof Error ? error.message : "No se pudo sincronizar."
      });
    }
  }

  return NextResponse.json({
    success: failed === 0,
    pendingContacts: latestByWhatsapp.size,
    synced,
    failed,
    errors: errors.slice(0, 10)
  });
}
