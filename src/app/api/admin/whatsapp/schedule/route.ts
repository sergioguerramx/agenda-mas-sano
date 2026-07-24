import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedMessagingEmail } from "@/lib/admin-auth";
import { BRANCH_SHORT_NAMES, getBranchLocation } from "@/lib/branch-locations";
import { getMasSanoAppointmentOffer } from "@/lib/mas-sano-pricing";
import { buildSlotsForDate, formatDisplayDate } from "@/lib/schedule";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";
import { syncContactFromAppointment } from "@/services/contacts";
import { createGoogleCalendarEvent, isGoogleCalendarSlotAvailable } from "@/services/google-calendar";
import { upsertGoogleContact } from "@/services/google-contacts";
import type { AppointmentRow } from "@/types/appointments";

export const runtime = "nodejs";

const BRANCH_CODES = new Set(["SN", "MTY_SUR"]);
const MTY_SUR_OPENING_DATE = "2026-08-03";

type SchedulePayload = {
  conversationId?: string;
  patientId?: string;
  fullName?: string;
  branchCode?: string;
  date?: string;
  time?: string;
};

function splitName(value: string) {
  const parts = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  return {
    firstName: parts.shift() ?? "",
    lastName: parts.join(" ")
  };
}

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function formatTime(time: string) {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const suffix = hour >= 12 ? "p.m." : "a.m.";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function getMonterreyToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Monterrey",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addOneDay(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export async function POST(request: NextRequest) {
  const operatorEmail = await getAuthenticatedMessagingEmail(request);
  if (!operatorEmail) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const payload = await request.json().catch(() => ({})) as SchedulePayload;
  const conversationId = payload.conversationId?.trim() ?? "";
  const patientId = payload.patientId?.trim() ?? "";
  const branchCode = payload.branchCode?.trim() ?? "";
  const date = payload.date?.trim() ?? "";
  const time = payload.time?.slice(0, 5) ?? "";

  if (!conversationId || !BRANCH_CODES.has(branchCode) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return NextResponse.json({ error: "Completa sucursal, fecha y horario." }, { status: 400 });
  }
  if (branchCode === "MTY_SUR" && date < MTY_SUR_OPENING_DATE) {
    return NextResponse.json({ error: "Monterrey Poniente abre agenda a partir del 3 de agosto." }, { status: 409 });
  }

  const requestedSlot = buildSlotsForDate(date, new Date(), {}, branchCode as "SN" | "MTY_SUR").find((slot) => slot.time === time);
  if (!requestedSlot?.available) {
    return NextResponse.json({ error: "Ese horario ya no está disponible." }, { status: 409 });
  }

  const client = createSupabaseServiceRoleClient();
  const [{ data: conversation }, { data: branch }] = await Promise.all([
    client.from("whatsapp_conversations").select("id, whatsapp, contact_name").eq("id", conversationId).maybeSingle(),
    client.from("branches").select("code, name, calendar_email").eq("code", branchCode).eq("is_active", true).maybeSingle()
  ]);

  if (!conversation) {
    return NextResponse.json({ error: "No se encontró la conversación." }, { status: 404 });
  }
  if (!branch?.calendar_email) {
    return NextResponse.json({ error: "Esta sucursal todavía no tiene agenda conectada." }, { status: 409 });
  }

  let fullName = payload.fullName?.replace(/\s+/g, " ").trim() ?? "";
  if (patientId) {
    const { data: patient } = await client
      .from("patient_profiles")
      .select("id, full_name, whatsapp")
      .eq("id", patientId)
      .maybeSingle();
    if (!patient || patient.whatsapp !== conversation.whatsapp) {
      return NextResponse.json({ error: "No se pudo relacionar a la paciente elegida." }, { status: 409 });
    }
    fullName = patient.full_name;
  }

  if (!fullName) fullName = conversation.contact_name?.trim() ?? "";
  const { firstName, lastName } = splitName(fullName);
  if (!firstName) {
    return NextResponse.json({ error: "Agrega el nombre de la paciente." }, { status: 400 });
  }

  try {
    const calendarAvailable = await isGoogleCalendarSlotAvailable(
      date,
      time,
      branch.calendar_email,
      branchCode as "SN" | "MTY_SUR"
    );
    if (!calendarAvailable) {
      return NextResponse.json({ error: "Ese horario acaba de ocuparse. Elige otro." }, { status: 409 });
    }

    const { data: existingRows } = await client
      .from("appointments")
      .select("id, first_name, last_name")
      .eq("branch_code", branchCode)
      .eq("appointment_date", date)
      .eq("appointment_time", time)
      .eq("whatsapp", conversation.whatsapp)
      .in("status", ["pending", "confirmed"]);
    const existing = (existingRows ?? []).find((item) => normalizeName(`${item.first_name} ${item.last_name}`) === normalizeName(fullName));
    if (existing) {
      return NextResponse.json({ error: "Esta cita ya estaba registrada." }, { status: 409 });
    }

    const today = getMonterreyToday();
    const immediatelyConfirmed = date <= addOneDay(today);
    const initialStatus = immediatelyConfirmed ? "confirmed" : "pending";

    const { data: inserted, error: insertError } = await client
      .from("appointments")
      .insert({
        first_name: firstName,
        last_name: lastName,
        whatsapp: conversation.whatsapp,
        appointment_date: date,
        appointment_time: time,
        status: initialStatus,
        brand: "mas_sano",
        modality: "presencial",
        service: getMasSanoAppointmentOffer(date).service,
        origin: "whatsapp_directo",
        branch_code: branchCode
      })
      .select("id, first_name, last_name, whatsapp, appointment_date, appointment_time, status, google_calendar_event_id, brand, modality, service, origin, branch_code")
      .single();
    if (insertError || !inserted) throw insertError ?? new Error("No se pudo guardar la cita.");

    const appointment = inserted as AppointmentRow;
    try {
      const calendarResult = await createGoogleCalendarEvent(appointment, branch.calendar_email);
      if (!calendarResult.eventId) throw new Error("Google Calendar no confirmó la cita.");
      const { error: updateError } = await client
        .from("appointments")
        .update({ google_calendar_event_id: calendarResult.eventId })
        .eq("id", appointment.id);
      if (updateError) console.warn("Appointment created but calendar id was not saved", { appointmentId: appointment.id, updateError });
    } catch (calendarError) {
      await client.from("patient_appointment_history").delete().eq("legacy_appointment_id", appointment.id);
      await client.from("appointments").delete().eq("id", appointment.id);
      throw calendarError;
    }

    try {
      await syncContactFromAppointment(client, appointment.id);
    } catch (contactError) {
      console.warn("Appointment created but contact summary was not refreshed", { appointmentId: appointment.id, contactError });
    }
    try {
      const googleContact = await upsertGoogleContact(appointment);
      if (googleContact.resourceName) {
        await client.from("appointments").update({ google_contact_id: googleContact.resourceName }).eq("id", appointment.id);
        await client.from("contacts").update({ google_contact_resource_name: googleContact.resourceName }).eq("whatsapp", appointment.whatsapp);
      }
    } catch (googleContactError) {
      console.warn("Appointment created but Google Contacts sync is pending", { appointmentId: appointment.id, googleContactError });
    }
    const updatedAt = new Date().toISOString();
    await client.from("whatsapp_conversations").update({
      workflow_status: "cita_agendada",
      branch_interest: branchCode,
      follow_up_at: null,
      updated_by_email: operatorEmail,
      updated_at: updatedAt
    }).eq("id", conversationId);

    const location = getBranchLocation(branchCode as "SN" | "MTY_SUR", date);
    const branchDisplayName = BRANCH_SHORT_NAMES[branchCode as "SN" | "MTY_SUR"];
    const confirmationDraft = immediatelyConfirmed
      ? `Hola ${firstName}, tu cita en Más Sano ${branchDisplayName} quedó agendada y confirmada 📌\n\n📅 ${formatDisplayDate(date)}\n🕐 ${formatTime(time)}\n📍 ${location.address}\n🗺️ ${location.mapsUrl}\n\nSerá un gusto recibirte 💚`
      : `Hola ${firstName}, tu cita en Más Sano ${branchDisplayName} quedó agendada 📌\n\n📅 ${formatDisplayDate(date)}\n🕐 ${formatTime(time)}\n📍 ${location.address}\n🗺️ ${location.mapsUrl}\n\nAntes de tu cita te escribiremos para confirmar tu asistencia. Será un gusto recibirte 💚`;
    return NextResponse.json({
      appointmentId: appointment.id,
      branchName: branch.name,
      fullName,
      date,
      time,
      confirmationDraft
    });
  } catch (error) {
    console.error("WhatsApp direct schedule error", { branchCode, date, time, error });
    const message = error instanceof Error && /maximo|disponible|duplicate/i.test(error.message)
      ? "Ese horario acaba de ocuparse. Elige otro."
      : `No pudimos crear la cita en ${branch.name}. Revisa la conexión de esa agenda.`;
    return NextResponse.json({ error: message }, { status: /ocup/.test(message.toLowerCase()) ? 409 : 500 });
  }
}
