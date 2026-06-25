import { NextResponse } from "next/server";
import { buildSlotsForDate } from "@/lib/schedule";
import { createSupabaseServiceRoleClient, isSupabaseConfigured } from "@/lib/supabase";
import { normalizeMexicanWhatsapp } from "@/lib/whatsapp";
import {
  getYoSoySanoServiceLabel,
  verifyYoSoySanoBookingToken
} from "@/lib/yosoysano-booking-token";
import { syncContactFromAppointment } from "@/services/contacts";
import { createGoogleCalendarEvent, isGoogleCalendarSlotAvailable } from "@/services/google-calendar";
import { upsertGoogleContact } from "@/services/google-contacts";
import { sendInternalAppointmentEmail } from "@/services/resend";
import type { AppointmentRow } from "@/types/appointments";

type RequestPayload = {
  token?: string;
  date?: string;
  time?: string;
};

type PublicAppointmentResponse = { success: boolean; appointment_id?: string };

const SLOT_TAKEN_MESSAGE = "Este horario acaba de ocuparse. Elige otro horario disponible.";

function splitName(fullName: string) {
  const parts = fullName.trim().replace(/\s+/g, " ").split(" ");
  const firstName = parts.shift() ?? "";
  const lastName = parts.join(" ") || "Yo Soy Sano";
  return { firstName, lastName };
}

function getAutomationError(error: unknown) {
  return {
    message: error instanceof Error ? error.message : "Error sin detalle",
    name: error instanceof Error ? error.name : undefined
  };
}

async function getExistingAppointment(registroId: string) {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("appointments")
    .select("id, first_name, last_name, whatsapp, appointment_date, appointment_time, status, google_calendar_event_id, google_contact_id, resend_email_id, brand, modality, service, origin, registro_id, cliente_id, correo, created_at, updated_at")
    .eq("registro_id", registroId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("Yo Soy Sano existing appointment lookup warning", getAutomationError(error));
    return null;
  }

  return data as AppointmentRow | null;
}

async function loadAppointment(appointmentId: string) {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("appointments")
    .select("id, first_name, last_name, whatsapp, appointment_date, appointment_time, status, google_calendar_event_id, google_contact_id, resend_email_id, brand, modality, service, origin, registro_id, cliente_id, correo, created_at, updated_at")
    .eq("id", appointmentId)
    .maybeSingle();

  if (error || !data) {
    throw error ?? new Error("No se encontro la llamada recien creada.");
  }

  return data as AppointmentRow;
}

function alreadyCreatedResponse(appointment: AppointmentRow) {
  return NextResponse.json({
    success: true,
    appointment_id: appointment.id,
    alreadyCreated: true
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
    return NextResponse.json({ error: "No se pudieron leer los datos." }, { status: 400 });
  }

  const tokenPayload = verifyYoSoySanoBookingToken(payload.token ?? "");

  if (!tokenPayload) {
    return NextResponse.json({ error: "El enlace de agenda no es valido o ya vencio." }, { status: 403 });
  }

  if (!payload.date || !payload.time) {
    return NextResponse.json({ error: "Elige fecha y horario para continuar." }, { status: 400 });
  }

  const normalizedTime = payload.time.slice(0, 5);
  const requestedSlot = buildSlotsForDate(payload.date, new Date()).find((slot) => slot.time === normalizedTime);

  if (!requestedSlot?.available) {
    return NextResponse.json({ error: "Ese horario no está disponible. Elige otro horario." }, { status: 409 });
  }

  const existingAppointment = await getExistingAppointment(tokenPayload.registroId);
  if (existingAppointment) return alreadyCreatedResponse(existingAppointment);

  const calendarSlotAvailable = await isGoogleCalendarSlotAvailable(payload.date, normalizedTime);

  if (!calendarSlotAvailable) {
    const appointmentAfterCalendarCheck = await getExistingAppointment(tokenPayload.registroId);
    if (appointmentAfterCalendarCheck) return alreadyCreatedResponse(appointmentAfterCalendarCheck);

    return NextResponse.json({ error: SLOT_TAKEN_MESSAGE }, { status: 409 });
  }

  const { firstName, lastName } = splitName(tokenPayload.nombre);
  const whatsapp = normalizeMexicanWhatsapp(tokenPayload.whatsapp);

  if (!whatsapp) {
    return NextResponse.json({ error: "El WhatsApp del registro no es valido." }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase.rpc("request_yosoysano_appointment", {
      p_first_name: firstName,
      p_last_name: lastName,
      p_whatsapp: whatsapp,
      p_correo: tokenPayload.correo,
      p_appointment_date: payload.date,
      p_appointment_time: normalizedTime,
      p_service: tokenPayload.servicio,
      p_registro_id: tokenPayload.registroId,
      p_cliente_id: tokenPayload.clienteId
    });

    if (error) throw error;

    const createdAppointment = (data?.[0] ?? null) as PublicAppointmentResponse | null;
    const appointmentId = createdAppointment?.appointment_id ?? "";
    const appointment = await loadAppointment(appointmentId);
    const automationStatus: Record<string, string> = {};

    try {
      const contactResult = await syncContactFromAppointment(supabase, appointment.id);
      automationStatus.contact = contactResult.status;
    } catch (contactError) {
      automationStatus.contact = "failed";
      console.warn("Yo Soy Sano contact sync warning", getAutomationError(contactError));
    }

    try {
      const calendarResult = await createGoogleCalendarEvent(appointment);
      automationStatus.calendar = calendarResult.status;

      if (calendarResult.eventId) {
        await supabase
          .from("appointments")
          .update({ google_calendar_event_id: calendarResult.eventId })
          .eq("id", appointment.id);
      }
    } catch (calendarError) {
      automationStatus.calendar = "failed";
      console.error("Yo Soy Sano Google Calendar error", getAutomationError(calendarError));
    }

    try {
      const googleContactResult = await upsertGoogleContact(appointment);
      automationStatus.googleContact = googleContactResult.status;

      if (googleContactResult.resourceName) {
        await supabase
          .from("appointments")
          .update({ google_contact_id: googleContactResult.resourceName })
          .eq("id", appointment.id);
      }
    } catch (googleContactError) {
      automationStatus.googleContact = "failed";
      console.warn("Yo Soy Sano Google Contacts warning", getAutomationError(googleContactError));
    }

    try {
      const emailResult = await sendInternalAppointmentEmail({
        ...appointment,
        service: getYoSoySanoServiceLabel(tokenPayload.servicio)
      });
      automationStatus.email = emailResult.status;

      if (emailResult.emailId) {
        await supabase
          .from("appointments")
          .update({ resend_email_id: emailResult.emailId })
          .eq("id", appointment.id);
      }
    } catch (emailError) {
      automationStatus.email = "failed";
      console.warn("Yo Soy Sano internal email warning", getAutomationError(emailError));
    }

    return NextResponse.json({ success: true, appointment_id: appointment.id, automationStatus });
  } catch (error) {
    console.error("Yo Soy Sano appointment request error", getAutomationError(error));

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo guardar la llamada." },
      { status: 500 }
    );
  }
}
