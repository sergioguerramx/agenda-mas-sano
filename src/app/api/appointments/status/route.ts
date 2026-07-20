import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAllowedAdminEmail } from "@/lib/admin";
import { createSupabaseServiceRoleClient, getSupabaseConfig, getSupabaseConfigError } from "@/lib/supabase";
import { syncContactFromAppointment } from "@/services/contacts";
import { syncGoogleCalendarEventStatus } from "@/services/google-calendar";
import type { AppointmentRow, AppointmentStatus } from "@/types/appointments";

type StatusPayload = {
  id?: string;
  status?: AppointmentStatus;
};

const allowedStatuses: AppointmentStatus[] = ["pending", "confirmed", "cancelled", "completed"];

async function getAuthenticatedAdminEmail(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();

  if (!token) return null;

  const configError = getSupabaseConfigError();
  if (configError) throw new Error(configError);

  const config = getSupabaseConfig();
  const supabase = createClient(config.url, config.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await supabase.auth.getUser(token);
  const email = data.user?.email ?? "";

  if (error || !isAllowedAdminEmail(email)) return null;

  const adminSupabase = createSupabaseServiceRoleClient();
  const { data: adminUser } = await adminSupabase
    .from("admin_users")
    .select("email")
    .eq("email", email)
    .maybeSingle();

  return adminUser ? email : null;
}

export async function POST(request: Request) {
  let payload: StatusPayload;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "No se pudieron leer los datos." }, { status: 400 });
  }

  if (!payload.id || !payload.status || !allowedStatuses.includes(payload.status)) {
    return NextResponse.json({ error: "Estado invalido." }, { status: 400 });
  }

  try {
    const adminEmail = await getAuthenticatedAdminEmail(request);

    if (!adminEmail) {
      return NextResponse.json({ error: "No tienes acceso al panel." }, { status: 403 });
    }

    const supabase = createSupabaseServiceRoleClient();
    const { data: currentAppointment, error: loadError } = await supabase
      .from("appointments")
      .select("id, first_name, last_name, whatsapp, appointment_date, appointment_time, status, google_calendar_event_id, google_contact_id, resend_email_id, brand, modality, service, origin, branch_code, created_at, updated_at")
      .eq("id", payload.id)
      .maybeSingle();

    if (loadError || !currentAppointment) {
      return NextResponse.json({ error: "No se encontro la cita." }, { status: 404 });
    }

    const appointment = currentAppointment as AppointmentRow;
    const { error: updateError } = await supabase
      .from("appointments")
      .update({ status: payload.status })
      .eq("id", payload.id);

    if (updateError) throw updateError;

    try {
      await syncContactFromAppointment(supabase, appointment.id);
    } catch (contactError) {
      console.warn("Contact status sync warning", {
        message: contactError instanceof Error ? contactError.message : "Aviso sin detalle"
      });
    }

    let calendarStatus = "skipped";

    try {
      const { data: branch } = await supabase
        .from("branches")
        .select("calendar_email")
        .eq("code", appointment.branch_code ?? "SN")
        .maybeSingle();
      const calendarResult = await syncGoogleCalendarEventStatus(
        { ...appointment, status: payload.status },
        payload.status,
        branch?.calendar_email ?? undefined
      );
      calendarStatus = calendarResult.status;

      if (payload.status === "cancelled" && appointment.google_calendar_event_id) {
        await supabase
          .from("appointments")
          .update({ google_calendar_event_id: null })
          .eq("id", appointment.id);
      } else if (calendarResult.eventId && calendarResult.eventId !== appointment.google_calendar_event_id) {
        await supabase
          .from("appointments")
          .update({ google_calendar_event_id: calendarResult.eventId })
          .eq("id", appointment.id);
      }
    } catch (calendarError) {
      calendarStatus = "failed";
      console.error("Google Calendar status sync error", {
        message: calendarError instanceof Error ? calendarError.message : "Error desconocido"
      });
    }

    return NextResponse.json({ success: true, calendarStatus });
  } catch (error) {
    console.error("Appointment status update error", {
      message: error instanceof Error ? error.message : "Error desconocido"
    });

    return NextResponse.json({ error: "No se pudo cambiar el estado." }, { status: 500 });
  }
}
