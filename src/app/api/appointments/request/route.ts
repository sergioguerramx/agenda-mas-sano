import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceRoleClient, isSupabaseConfigured } from "@/lib/supabase";
import { syncContactFromAppointment } from "@/services/contacts";
import { createGoogleCalendarEvent } from "@/services/google-calendar";
import { upsertGoogleContact } from "@/services/google-contacts";
import { sendInternalAppointmentEmail } from "@/services/resend";
import type { AppointmentRow } from "@/types/appointments";

type RequestPayload = {
  firstName?: string;
  lastName?: string;
  whatsapp?: string;
  date?: string;
  time?: string;
};

type SupabaseSafeError = { message?: string; code?: string; details?: string; hint?: string };
type PublicAppointmentResponse = { success: boolean; appointment_id?: string };

function logAutomationError(context: string, error: unknown) {
  console.error(context, {
    message: error instanceof Error ? error.message : "Error desconocido"
  });
}

function logAutomationWarning(context: string, error: unknown) {
  console.warn(context, {
    message: error instanceof Error ? error.message : "Aviso sin detalle"
  });
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Falta conectar Supabase." }, { status: 500 });
  }

  let payload: RequestPayload;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "No se pudieron leer los datos de la cita." }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.rpc("request_public_appointment", {
      p_first_name: payload.firstName,
      p_last_name: payload.lastName,
      p_whatsapp: payload.whatsapp,
      p_appointment_date: payload.date,
      p_appointment_time: payload.time
    });

    if (error) throw error;

    const createdAppointment = (data?.[0] ?? null) as PublicAppointmentResponse | null;
    const createdAppointmentId = createdAppointment?.appointment_id ?? "";
    let adminSupabase: ReturnType<typeof createSupabaseServiceRoleClient> | null = null;
    let row: AppointmentRow = {
      id: createdAppointmentId,
      first_name: payload.firstName ?? "",
      last_name: payload.lastName ?? "",
      whatsapp: payload.whatsapp ?? "",
      appointment_date: payload.date ?? "",
      appointment_time: payload.time ?? "",
      status: "pending"
    };

    try {
      adminSupabase = createSupabaseServiceRoleClient();
      let appointmentQuery = adminSupabase
        .from("appointments")
        .select("id, first_name, last_name, whatsapp, appointment_date, appointment_time, status, google_calendar_event_id, google_contact_id, resend_email_id, created_at, updated_at");

      if (createdAppointmentId) {
        appointmentQuery = appointmentQuery.eq("id", createdAppointmentId);
      } else {
        appointmentQuery = appointmentQuery
          .eq("appointment_date", payload.date)
          .eq("appointment_time", payload.time)
          .eq("whatsapp", payload.whatsapp)
          .order("created_at", { ascending: false })
          .limit(1);
      }

      const { data: appointment, error: appointmentError } = await appointmentQuery.maybeSingle();

      if (appointmentError || !appointment) {
        throw appointmentError ?? new Error("No se encontro la cita recien creada.");
      }

      row = appointment as AppointmentRow;
    } catch (automationError) {
      logAutomationError("Appointment automation setup error", automationError);
    }

    const automationStatus: Record<string, string> = {};

    try {
      if (!adminSupabase) throw new Error("No se pudo conectar contactos.");
      const contactResult = await syncContactFromAppointment(adminSupabase, row.id);
      automationStatus.contact = contactResult.status;
    } catch (contactError) {
      automationStatus.contact = "failed";
      logAutomationWarning("Contact sync warning", contactError);
    }

    try {
      const calendarResult = await createGoogleCalendarEvent(row);
      automationStatus.calendar = calendarResult.status;

      if (calendarResult.eventId && adminSupabase && row.id) {
        await adminSupabase
          .from("appointments")
          .update({ google_calendar_event_id: calendarResult.eventId })
          .eq("id", row.id);
      }
    } catch (calendarError) {
      automationStatus.calendar = "failed";
      logAutomationError("Google Calendar appointment automation error", calendarError);
    }

    try {
      const googleContactResult = await upsertGoogleContact(row);
      automationStatus.googleContact = googleContactResult.status;

      if (googleContactResult.resourceName && adminSupabase && row.id) {
        await adminSupabase
          .from("appointments")
          .update({ google_contact_id: googleContactResult.resourceName })
          .eq("id", row.id);

        await adminSupabase
          .from("contacts")
          .update({ google_contact_resource_name: googleContactResult.resourceName })
          .eq("whatsapp", row.whatsapp);
      }
    } catch (googleContactError) {
      automationStatus.googleContact = "failed";
      logAutomationWarning("Google Contacts appointment automation warning", googleContactError);
    }

    try {
      const emailResult = await sendInternalAppointmentEmail(row);
      automationStatus.email = emailResult.status;

      if (emailResult.emailId && adminSupabase && row.id) {
        await adminSupabase
          .from("appointments")
          .update({ resend_email_id: emailResult.emailId })
          .eq("id", row.id);
      }
    } catch (emailError) {
      automationStatus.email = "failed";
      logAutomationWarning("Internal appointment email automation warning", emailError);
    }

    return NextResponse.json({ success: true, automationStatus });
  } catch (error) {
    const safeError = error as SupabaseSafeError;
    console.error("Supabase request_public_appointment server error", {
      message: safeError.message,
      code: safeError.code,
      details: safeError.details,
      hint: safeError.hint
    });

    return NextResponse.json(
      { error: safeError.message ?? "No se pudo guardar la cita." },
      { status: 500 }
    );
  }
}
