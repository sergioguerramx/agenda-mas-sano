import { NextResponse } from "next/server";
import { isAllowedAdminEmail } from "@/lib/admin";
import { createSupabaseServerClient, createSupabaseServiceRoleClient, isSupabaseConfigured } from "@/lib/supabase";
import { sendMasSanoPurchaseToMeta } from "@/services/meta-offline";
import type { AppointmentRow } from "@/types/appointments";

type BackfillPayload = {
  dryRun?: boolean;
  limit?: number;
  from?: string;
  to?: string;
  appointmentIds?: string[];
};

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 10;
const APPOINTMENT_SELECT = [
  "id",
  "first_name",
  "last_name",
  "whatsapp",
  "appointment_date",
  "appointment_time",
  "status",
  "google_calendar_event_id",
  "google_contact_id",
  "resend_email_id",
  "brand",
  "modality",
  "service",
  "origin",
  "registro_id",
  "cliente_id",
  "correo",
  "created_at",
  "updated_at"
].join(", ");

async function verifyAdmin(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser(token);
  const email = data.user?.email ?? "";

  return Boolean(!error && isAllowedAdminEmail(email));
}

function normalizeLimit(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(numeric), MAX_LIMIT);
}

function normalizeDateBoundary(value?: string, endOfDay = false) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return endOfDay ? `${trimmed}T23:59:59.999-06:00` : `${trimmed}T00:00:00.000-06:00`;
  }
  return trimmed;
}

function getEventTime(appointment: AppointmentRow) {
  const timestamp = appointment.created_at ? new Date(appointment.created_at).getTime() : NaN;
  if (!Number.isFinite(timestamp)) return Math.floor(Date.now() / 1000);
  return Math.floor(timestamp / 1000);
}

function getSafeFailureReason(result: unknown) {
  if (!result || typeof result !== "object") return "No se pudo enviar.";
  const response = "response" in result ? (result as { response?: unknown }).response : undefined;
  if (response && typeof response === "object" && "error" in response) {
    const error = (response as { error?: { message?: string; code?: number } }).error;
    return [error?.message, error?.code ? `codigo ${error.code}` : ""].filter(Boolean).join(" ");
  }
  if ("reason" in result && typeof (result as { reason?: unknown }).reason === "string") {
    return (result as { reason: string }).reason;
  }
  return "Meta no confirmo el evento.";
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Falta conectar Supabase." }, { status: 500 });
  }

  const isAdmin = await verifyAdmin(request);
  if (!isAdmin) {
    return NextResponse.json({ error: "No tienes acceso a esta accion." }, { status: 403 });
  }

  let payload: BackfillPayload = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const limit = normalizeLimit(payload.limit);
  const dryRun = payload.dryRun !== false;
  const from = normalizeDateBoundary(payload.from);
  const to = normalizeDateBoundary(payload.to, true);
  const appointmentIds = Array.isArray(payload.appointmentIds)
    ? payload.appointmentIds.filter((id) => typeof id === "string" && id.trim()).slice(0, MAX_LIMIT)
    : [];

  const supabase = createSupabaseServiceRoleClient();
  let query = supabase
    .from("appointments")
    .select(APPOINTMENT_SELECT)
    .neq("status", "cancelled")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (appointmentIds.length > 0) {
    query = query.in("id", appointmentIds);
  } else {
    if (from) query = query.gte("created_at", from);
    if (to) query = query.lte("created_at", to);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "No se pudieron cargar las citas historicas." }, { status: 500 });
  }

  const appointments = (data ?? []) as unknown as AppointmentRow[];

  if (dryRun) {
    return NextResponse.json({
      success: true,
      dryRun: true,
      selected: appointments.length,
      limit,
      filters: { from: from || null, to: to || null, appointmentIds: appointmentIds.length },
      sample: appointments.slice(0, 10).map((appointment) => ({
        id: appointment.id,
        appointmentDate: appointment.appointment_date,
        appointmentTime: appointment.appointment_time,
        createdAt: appointment.created_at,
        eventTime: getEventTime(appointment),
        origin: appointment.origin ?? "sin_identificar"
      }))
    });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const failures: Array<{ id: string; reason: string }> = [];

  for (const appointment of appointments) {
    const result = await sendMasSanoPurchaseToMeta(appointment, {
      eventTime: getEventTime(appointment)
    });

    if (result.status === "sent") {
      sent += 1;
    } else if (result.status === "skipped") {
      skipped += 1;
      failures.push({ id: appointment.id, reason: getSafeFailureReason(result) });
    } else {
      failed += 1;
      failures.push({ id: appointment.id, reason: getSafeFailureReason(result) });
    }
  }

  return NextResponse.json({
    success: failed === 0 && skipped === 0,
    dryRun: false,
    selected: appointments.length,
    sent,
    failed,
    skipped,
    filters: { from: from || null, to: to || null, appointmentIds: appointmentIds.length },
    failures: failures.slice(0, 20)
  });
}
