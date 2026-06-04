import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceRoleClient, isSupabaseConfigured } from "@/lib/supabase";
import { buildSlotsForDate } from "@/lib/schedule";
import { syncContactFromAppointment } from "@/services/contacts";
import { createGoogleCalendarEvent, isGoogleCalendarSlotAvailable } from "@/services/google-calendar";
import { isGoogleContactsConfigured, upsertGoogleContact } from "@/services/google-contacts";
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

const SLOT_TAKEN_MESSAGE = "Este horario acaba de ocuparse. Elige otro horario disponible.";

function readErrorField(error: unknown, field: string) {
  if (!error || typeof error !== "object" || !(field in error)) return undefined;
  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" ? value : value;
}

function stringifyError(error: unknown) {
  try {
    if (error instanceof Error) {
      return JSON.stringify(error, Object.getOwnPropertyNames(error));
    }

    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function getAutomationErrorDetails(error: unknown) {
  return {
    message: error instanceof Error ? error.message : readErrorField(error, "message"),
    code: readErrorField(error, "code"),
    details: readErrorField(error, "details"),
    hint: readErrorField(error, "hint"),
    name: error instanceof Error ? error.name : readErrorField(error, "name"),
    stack: error instanceof Error ? error.stack : readErrorField(error, "stack"),
    raw: stringifyError(error)
  };
}

function isSlotCapacityError(error: unknown) {
  const details = getAutomationErrorDetails(error);
  const text = [details.message, details.code, details.details, details.hint, details.raw]
    .filter(Boolean)
    .join(" ");

  return text.includes("appointments_slot_capacity_guard")
    || text.includes("Este horario ya no tiene lugares disponibles")
    || text.includes("Este horario ya tiene el maximo de citas permitido")
    || (text.includes("duplicate key") && text.includes("appointments"));
}

function logAutomationError(context: string, error: unknown, extra?: Record<string, unknown>) {
  console.error(context, {
    ...extra,
    error: getAutomationErrorDetails(error)
  });
}

function logAutomationWarning(context: string, error: unknown, extra?: Record<string, unknown>) {
  console.warn(context, {
    ...extra,
    error: getAutomationErrorDetails(error)
  });
}

async function getSlotDiagnostics(payload: RequestPayload) {
  try {
    const adminSupabase = createSupabaseServiceRoleClient();
    const { data, error } = await adminSupabase
      .from("appointments")
      .select("id, first_name, last_name, whatsapp, appointment_date, appointment_time, status, google_calendar_event_id, created_at, updated_at")
      .eq("appointment_date", payload.date)
      .eq("appointment_time", payload.time)
      .order("created_at", { ascending: false });

    if (error) {
      return { diagnosticError: getAutomationErrorDetails(error) };
    }

    return { appointments: data ?? [] };
  } catch (diagnosticError) {
    return { diagnosticError: getAutomationErrorDetails(diagnosticError) };
  }
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
    if (!payload.date || !payload.time) {
      return NextResponse.json({ error: "Elige fecha y horario para continuar." }, { status: 400 });
    }

    const normalizedTime = payload.time.slice(0, 5);
    const requestedSlot = buildSlotsForDate(payload.date, new Date()).find((slot) => slot.time === normalizedTime);

    if (!requestedSlot || !requestedSlot.available) {
      console.warn("Appointment rejected by public schedule validation", {
        payload: {
          date: payload.date,
          time: payload.time,
          whatsapp: payload.whatsapp
        }
      });

      return NextResponse.json(
        { error: "Ese horario no está disponible. Elige otro horario." },
        { status: 409 }
      );
    }

    const calendarSlotAvailable = await isGoogleCalendarSlotAvailable(payload.date, payload.time);

    if (!calendarSlotAvailable) {
      console.warn("Appointment rejected by Google Calendar availability", {
        payload: {
          date: payload.date,
          time: payload.time,
          whatsapp: payload.whatsapp
        }
      });

      return NextResponse.json({ error: SLOT_TAKEN_MESSAGE }, { status: 409 });
    }

    console.info("Appointment Google Calendar availability passed", {
      payload: {
        date: payload.date,
        time: payload.time,
        whatsapp: payload.whatsapp
      }
    });

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.rpc("request_public_appointment", {
      p_first_name: payload.firstName,
      p_last_name: payload.lastName,
      p_whatsapp: payload.whatsapp,
      p_appointment_date: payload.date,
      p_appointment_time: normalizedTime
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
      appointment_time: normalizedTime,
      status: "pending"
    };

    console.info("Appointment automation setup started", {
      createdAppointmentId,
      payload: {
        date: payload.date,
        time: normalizedTime,
        whatsapp: payload.whatsapp
      },
      adminSupabaseAvailable: false
    });

    try {
      try {
        adminSupabase = createSupabaseServiceRoleClient();
        console.info("Appointment automation service role client created", {
          createdAppointmentId,
          adminSupabaseAvailable: Boolean(adminSupabase)
        });
      } catch (serviceRoleError) {
        logAutomationError("createSupabaseServiceRoleClient failed", serviceRoleError, {
          createdAppointmentId,
          payload: {
            date: payload.date,
            time: normalizedTime,
            whatsapp: payload.whatsapp
          },
          adminSupabaseAvailable: false
        });
        throw serviceRoleError;
      }

      let appointmentQuery = adminSupabase
        .from("appointments")
        .select("id, first_name, last_name, whatsapp, appointment_date, appointment_time, status, google_calendar_event_id, google_contact_id, resend_email_id, created_at, updated_at");

      if (createdAppointmentId) {
        appointmentQuery = appointmentQuery.eq("id", createdAppointmentId);
      } else {
        appointmentQuery = appointmentQuery
          .eq("appointment_date", payload.date)
          .eq("appointment_time", normalizedTime)
          .eq("whatsapp", payload.whatsapp)
          .order("created_at", { ascending: false })
          .limit(1);
      }

      console.info("Appointment automation appointment query started", {
        createdAppointmentId,
        payload: {
          date: payload.date,
          time: normalizedTime,
          whatsapp: payload.whatsapp
        },
        adminSupabaseAvailable: Boolean(adminSupabase)
      });

      const { data: appointment, error: appointmentError } = await appointmentQuery.maybeSingle();

      if (appointmentError) {
        logAutomationError("Appointment automation appointment query failed", appointmentError, {
          createdAppointmentId,
          payload: {
            date: payload.date,
            time: normalizedTime,
            whatsapp: payload.whatsapp
          },
          adminSupabaseAvailable: Boolean(adminSupabase)
        });
        throw appointmentError;
      }

      if (!appointment) {
        const notFoundError = new Error("No se encontro la cita recien creada.");
        logAutomationError("Appointment automation appointment query returned empty", notFoundError, {
          createdAppointmentId,
          payload: {
            date: payload.date,
            time: normalizedTime,
            whatsapp: payload.whatsapp
          },
          adminSupabaseAvailable: Boolean(adminSupabase)
        });
        throw notFoundError;
      }

      row = appointment as AppointmentRow;
      console.info("Appointment automation appointment loaded", {
        createdAppointmentId,
        appointmentId: row.id,
        payload: {
          date: payload.date,
          time: normalizedTime,
          whatsapp: payload.whatsapp
        },
        adminSupabaseAvailable: Boolean(adminSupabase)
      });
    } catch (automationError) {
      logAutomationError("Appointment automation setup error", automationError, {
        createdAppointmentId,
        payload: {
          date: payload.date,
          time: normalizedTime,
          whatsapp: payload.whatsapp
        },
        adminSupabaseAvailable: Boolean(adminSupabase)
      });
    }

    const automationStatus: Record<string, string> = {};

    try {
      if (!adminSupabase) throw new Error("No se pudo conectar contactos.");
      const contactResult = await syncContactFromAppointment(adminSupabase, row.id);
      automationStatus.contact = contactResult.status;
    } catch (contactError) {
      automationStatus.contact = "failed";
      logAutomationWarning("Contact sync warning", contactError, {
        appointmentId: row.id
      });
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
      logAutomationError("Google Calendar appointment automation error", calendarError, {
        appointmentId: row.id
      });
    }

    try {
      const googleContactsConfigured = isGoogleContactsConfigured();
      console.info("Google Contacts configured", {
        configured: googleContactsConfigured,
        appointmentId: row.id
      });
      console.info("Google Contacts attempt started", {
        appointmentId: row.id,
        whatsapp: row.whatsapp
      });

      const googleContactResult = await upsertGoogleContact(row);
      automationStatus.googleContact = googleContactResult.status;

      console.info("Google Contacts result", {
        status: googleContactResult.status,
        reason: googleContactResult.reason,
        resourceName: googleContactResult.resourceName,
        appointmentId: row.id
      });

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
      console.warn("Google Contacts result", {
        status: "failed",
        appointmentId: row.id
      });
      logAutomationWarning("Google Contacts appointment automation warning", googleContactError, {
        appointmentId: row.id,
        whatsapp: row.whatsapp
      });
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
      logAutomationWarning("Internal appointment email automation warning", emailError, {
        appointmentId: row.id
      });
    }

    return NextResponse.json({ success: true, automationStatus });
  } catch (error) {
    if (isSlotCapacityError(error)) {
      const diagnostics = await getSlotDiagnostics(payload);

      logAutomationWarning("Appointment rejected by Supabase capacity after Calendar availability passed", error, {
        payload: {
          date: payload.date,
          time: payload.time,
          whatsapp: payload.whatsapp
        },
        diagnostics
      });

      return NextResponse.json(
        { error: SLOT_TAKEN_MESSAGE },
        { status: 409 }
      );
    }

    const safeError = error as SupabaseSafeError;
    console.error("Supabase request_public_appointment server error", getAutomationErrorDetails(error));

    return NextResponse.json(
      { error: safeError.message ?? "No se pudo guardar la cita." },
      { status: 500 }
    );
  }
}
