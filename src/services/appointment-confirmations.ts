import {
  getAppointmentTemplateNames,
  isCloudWhatsAppOutboundEnabled,
  sendCloudWhatsAppReplyButtons,
  sendCloudWhatsAppTemplate,
  sendCloudWhatsAppText
} from "@/lib/meta-whatsapp";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";
import { releaseGoogleCalendarEventAtEight, syncGoogleCalendarEventStatus } from "@/services/google-calendar";
import type { AppointmentRow } from "@/types/appointments";

const TIME_ZONE = "America/Monterrey";
const AUTOMATION_START_DATE = "2026-08-03";
const ACTIVE_BRANCHES = ["SN", "MTY_SUR"];
const TEST_WHATSAPP = "+528132469930";
const CONFIRMATION_BUTTONS = [
  { id: "confirmar_cita", title: "Sí, confirmo" },
  { id: "reagendar_cita", title: "Quiero reagendar" },
  { id: "cancelar_cita", title: "No podré asistir" }
];
const APPOINTMENT_SELECT = [
  "id", "first_name", "last_name", "whatsapp", "appointment_date", "appointment_time", "status",
  "google_calendar_event_id", "brand", "modality", "service", "origin", "branch_code",
  "confirmation_first_sent_at", "confirmation_second_sent_at", "confirmation_response",
  "confirmation_response_at", "confirmation_released_at", "confirmation_release_notice_sent_at",
  "confirmation_original_time", "confirmation_last_error"
].join(", ");

type ConfirmationStage = "first" | "second";
type ConfirmationAction = { stage: ConfirmationStage | "release"; targetDates: string[] };
type BranchRow = { code: string; name: string; calendar_email: string | null };

function toDateIso(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateIso(date);
}

function getMonterreyNow(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  return {
    date,
    hour: Number(values.hour),
    weekday: new Date(`${date}T12:00:00Z`).getUTCDay()
  };
}

function formatDate(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  const value = new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "UTC"
  }).format(date);
  return value.charAt(0).toUpperCase() + value.slice(1).replace(".", "");
}

function formatTime(time: string) {
  const [hour = 0, minute = 0] = time.slice(0, 5).split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "p.m." : "a.m."}`;
}

function fullName(appointment: AppointmentRow) {
  return `${appointment.first_name} ${appointment.last_name}`.replace(/\s+/g, " ").trim();
}

function getActions(now: Date): ConfirmationAction[] {
  const local = getMonterreyNow(now);
  const actions: ConfirmationAction[] = [];
  const workingDays = new Set([1, 2, 4, 5, 6]);

  if (local.hour === 8 && workingDays.has(local.weekday)) {
    actions.push({ stage: "release", targetDates: [local.date] });
  }

  const targetOffsets = local.weekday === 1 || local.weekday === 3
    ? [1]
    : local.weekday === 4
      ? [1, 2]
      : local.weekday === 6
        ? [2]
        : [];
  const firstHour = local.weekday === 6 ? 12 : 10;

  if (targetOffsets.length > 0 && local.hour === firstHour) {
    actions.push({ stage: "first", targetDates: targetOffsets.map((days) => addDays(local.date, days)) });
  }
  if (targetOffsets.length > 0 && local.hour === 18) {
    actions.push({ stage: "second", targetDates: targetOffsets.map((days) => addDays(local.date, days)) });
  }

  return actions;
}

async function loadBranches() {
  const client = createSupabaseServiceRoleClient();
  const { data, error } = await client
    .from("branches")
    .select("code, name, calendar_email")
    .in("code", ACTIVE_BRANCHES);
  if (error) throw error;
  return new Map((data as BranchRow[]).map((branch) => [branch.code, branch]));
}

async function saveOutboundMessage(appointment: AppointmentRow, metaMessageId: string, body: string, sentAt: string) {
  const client = createSupabaseServiceRoleClient();
  const { data: conversation, error: conversationError } = await client
    .from("whatsapp_conversations")
    .upsert({
      whatsapp: appointment.whatsapp,
      contact_name: fullName(appointment),
      status: 1,
      last_message_at: sentAt,
      last_message_preview: body.slice(0, 180),
      last_message_direction: 2,
      updated_at: sentAt
    }, { onConflict: "whatsapp" })
    .select("id")
    .single();
  if (conversationError || !conversation) throw conversationError ?? new Error("No se guardó la conversación");

  const { error: messageError } = await client.from("whatsapp_messages").insert({
    conversation_id: conversation.id,
    meta_message_id: metaMessageId,
    direction: 2,
    message_type: "template",
    body,
    delivery_status: 1,
    sent_at: sentAt,
    sent_by_email: "automatizacion"
  });
  if (messageError && messageError.code !== "23505") throw messageError;
}

function confirmationCopy(appointment: AppointmentRow, branchName: string, stage: ConfirmationStage) {
  const name = appointment.first_name;
  const date = formatDate(appointment.appointment_date);
  const time = formatTime(appointment.appointment_time);
  if (stage === "second") {
    return `Hola ${name}. Aún no recibimos confirmación para tu cita del ${date} a las ${time} en ${branchName}. Para conservar tu horario, selecciona una opción:`;
  }
  return `Hola ${name}. Te escribimos de Más Sano para confirmar tu cita del ${date} a las ${time} en ${branchName}. Para conservar tu horario, selecciona una opción:`;
}

async function claimAndSendConfirmation(
  appointment: AppointmentRow,
  branch: BranchRow,
  requestedStage: ConfirmationStage,
  deliveryMode: "template" | "buttons" = "template"
) {
  const client = createSupabaseServiceRoleClient();
  const stage: ConfirmationStage = requestedStage === "second" && !appointment.confirmation_first_sent_at
    ? "first"
    : requestedStage;
  const column = stage === "first" ? "confirmation_first_sent_at" : "confirmation_second_sent_at";
  if (appointment[column]) return "skipped";

  const claimTime = new Date().toISOString();
  const { data: claimed, error: claimError } = await client
    .from("appointments")
    .update({ [column]: claimTime, confirmation_last_error: null })
    .eq("id", appointment.id)
    .is(column, null)
    .eq("status", "pending")
    .is("confirmation_response", null)
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return "skipped";

  try {
    const templates = getAppointmentTemplateNames();
    const isSaturdayAppointment = new Date(`${appointment.appointment_date}T12:00:00Z`).getUTCDay() === 6;
    const useGenericTemplate = stage === "second" && isSaturdayAppointment;
    const body = confirmationCopy(appointment, branch.name, useGenericTemplate ? "first" : stage);
    const templateName = stage === "first" || useGenericTemplate ? templates.first : templates.second;
    const metaMessageId = deliveryMode === "buttons"
      ? await sendCloudWhatsAppReplyButtons(appointment.whatsapp, body, CONFIRMATION_BUTTONS)
      : await sendCloudWhatsAppTemplate(
        appointment.whatsapp,
        templateName,
        templates.language,
        [appointment.first_name, formatDate(appointment.appointment_date), formatTime(appointment.appointment_time), branch.name]
      );
    await saveOutboundMessage(appointment, metaMessageId, body, claimTime);
    return "sent";
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo enviar la confirmación";
    await client.from("appointments").update({ [column]: null, confirmation_last_error: message }).eq("id", appointment.id);
    throw error;
  }
}

function releaseCopy(appointment: AppointmentRow) {
  const originalTime = appointment.confirmation_original_time ?? appointment.appointment_time;
  return `Hola ${appointment.first_name}. Como no recibimos confirmación, liberamos el horario de tu cita de hoy a las ${formatTime(originalTime)}. Si deseas reagendar, con gusto te ayudamos. Quedamos a tus órdenes.`;
}

async function sendReleaseNotice(appointment: AppointmentRow) {
  const client = createSupabaseServiceRoleClient();
  const templates = getAppointmentTemplateNames();
  const body = releaseCopy(appointment);
  const sentAt = new Date().toISOString();
  const originalTime = appointment.confirmation_original_time ?? appointment.appointment_time;
  const metaMessageId = await sendCloudWhatsAppTemplate(
    appointment.whatsapp,
    templates.released,
    templates.language,
    [appointment.first_name, formatTime(originalTime)]
  );
  await saveOutboundMessage(appointment, metaMessageId, body, sentAt);
  await client.from("appointments").update({
    confirmation_release_notice_sent_at: sentAt,
    confirmation_last_error: null
  }).eq("id", appointment.id);
}

async function releaseAppointment(appointment: AppointmentRow, branch: BranchRow) {
  const client = createSupabaseServiceRoleClient();
  const releasedAt = new Date().toISOString();
  const originalTime = appointment.appointment_time;

  await client
    .from("patient_appointment_history")
    .update({ original_scheduled_at: `${appointment.appointment_date}T${originalTime.slice(0, 5)}:00-06:00` })
    .eq("legacy_appointment_id", appointment.id)
    .is("original_scheduled_at", null);

  const { data: released, error: releaseError } = await client
    .from("appointments")
    .update({
      appointment_time: "08:00",
      status: "cancelled",
      confirmation_original_time: originalTime,
      confirmation_released_at: releasedAt,
      confirmation_last_error: null
    })
    .eq("id", appointment.id)
    .eq("status", "pending")
    .is("confirmation_response", null)
    .is("confirmation_released_at", null)
    .select(APPOINTMENT_SELECT)
    .maybeSingle();
  if (releaseError) throw releaseError;
  if (!released) return "skipped";

  const releasedAppointment = released as unknown as AppointmentRow;
  try {
    await releaseGoogleCalendarEventAtEight(
      { ...appointment, confirmation_original_time: originalTime },
      branch.calendar_email ?? undefined
    );
    await sendReleaseNotice(releasedAppointment);
  } catch (error) {
    await client.from("appointments").update({
      confirmation_last_error: error instanceof Error ? error.message : "No se envió el aviso de liberación"
    }).eq("id", appointment.id);
  }
  return "released";
}

async function loadPendingAppointments(date: string) {
  const client = createSupabaseServiceRoleClient();
  const { data, error } = await client
    .from("appointments")
    .select(APPOINTMENT_SELECT)
    .eq("appointment_date", date)
    .eq("status", "pending")
    .in("branch_code", ACTIVE_BRANCHES)
    .is("confirmation_response", null)
    .order("appointment_time", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as AppointmentRow[];
}

async function retryUnsentReleaseNotices(date: string, branches: Map<string, BranchRow>) {
  const client = createSupabaseServiceRoleClient();
  const { data, error } = await client
    .from("appointments")
    .select(APPOINTMENT_SELECT)
    .eq("appointment_date", date)
    .not("confirmation_released_at", "is", null)
    .is("confirmation_release_notice_sent_at", null);
  if (error) throw error;
  for (const appointment of (data ?? []) as unknown as AppointmentRow[]) {
    try {
      const branch = appointment.branch_code ? branches.get(appointment.branch_code) : null;
      if (!branch) throw new Error("No se encontró la sucursal para liberar la cita");
      await releaseGoogleCalendarEventAtEight(appointment, branch.calendar_email ?? undefined);
      await sendReleaseNotice(appointment);
    } catch (error) {
      await client.from("appointments").update({
        confirmation_last_error: error instanceof Error ? error.message : "No se envió el aviso de liberación"
      }).eq("id", appointment.id);
    }
  }
}

export async function runAppointmentConfirmationCycle(now = new Date()) {
  const local = getMonterreyNow(now);
  const actions = getActions(now);
  if (!isCloudWhatsAppOutboundEnabled()) {
    return { sent: 0, released: 0, skipped: 0, errors: 0, actions, paused: true };
  }
  const branches = await loadBranches();
  const result = { sent: 0, released: 0, skipped: 0, errors: 0, actions };

  await retryUnsentReleaseNotices(local.date, branches);

  for (const action of actions) {
    for (const targetDate of action.targetDates.filter((date) => date >= AUTOMATION_START_DATE)) {
      const appointments = await loadPendingAppointments(targetDate);
      for (const appointment of appointments) {
        const branch = appointment.branch_code ? branches.get(appointment.branch_code) : null;
        if (!branch) {
          result.skipped += 1;
          continue;
        }
        try {
          if (action.stage === "release") {
            if (!appointment.confirmation_first_sent_at || !appointment.confirmation_second_sent_at) {
              result.skipped += 1;
              continue;
            }
            const status = await releaseAppointment(appointment, branch);
            status === "released" ? result.released += 1 : result.skipped += 1;
          } else {
            const status = await claimAndSendConfirmation(appointment, branch, action.stage);
            status === "sent" ? result.sent += 1 : result.skipped += 1;
          }
        } catch (error) {
          result.errors += 1;
          console.error("Appointment confirmation automation error", {
            appointmentId: appointment.id,
            stage: action.stage,
            error
          });
        }
      }
    }
  }

  return result;
}

export async function sendTestAppointmentConfirmation(conversationId: string) {
  if (!isCloudWhatsAppOutboundEnabled()) {
    throw new Error("Los mensajes de WhatsApp no están habilitados.");
  }

  const client = createSupabaseServiceRoleClient();
  const { data: conversation } = await client
    .from("whatsapp_conversations")
    .select("whatsapp")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conversation || conversation.whatsapp !== TEST_WHATSAPP) {
    throw new Error("La prueba inmediata solo está permitida con el número de INCAIN.");
  }

  const today = getMonterreyNow(new Date()).date;
  const { data, error } = await client
    .from("appointments")
    .select(APPOINTMENT_SELECT)
    .eq("whatsapp", TEST_WHATSAPP)
    .ilike("first_name", "PRUEBA%")
    .eq("status", "pending")
    .gte("appointment_date", today)
    .is("confirmation_response", null)
    .is("confirmation_first_sent_at", null)
    .order("appointment_date", { ascending: true })
    .order("appointment_time", { ascending: true })
    .limit(2);
  if (error) throw error;
  if (!data || data.length !== 1) {
    throw new Error(data?.length ? "Hay más de una cita de prueba pendiente." : "No encontramos la cita de prueba pendiente.");
  }

  const appointment = data[0] as unknown as AppointmentRow;
  const branches = await loadBranches();
  const branch = appointment.branch_code ? branches.get(appointment.branch_code) : null;
  if (!branch) throw new Error("No se encontró la sucursal de la cita de prueba.");

  const status = await claimAndSendConfirmation(appointment, branch, "first", "buttons");
  if (status !== "sent") throw new Error("La confirmación de prueba ya había sido enviada.");

  return {
    appointmentId: appointment.id,
    appointmentDate: appointment.appointment_date,
    appointmentTime: appointment.appointment_time,
    branchName: branch.name
  };
}

function normalizeReply(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

type ConfirmationIntent = "confirm" | "reschedule" | "cancel";

function getConfirmationIntent(value: string): ConfirmationIntent | null {
  const reply = normalizeReply(value);
  const delayed = [
    "mas tarde", "al rato", "luego", "despues", "en un momento", "te aviso",
    "dejame revisar", "aun no", "todavia no", "tal vez", "puede ser"
  ].some((phrase) => reply.includes(phrase));
  if (delayed) return null;

  const confirmations = new Set([
    "si", "si confirmo", "confirmo", "confirmado", "confirmada", "si asistire",
    "si voy", "ahi estare", "claro que si", "cuenten conmigo"
  ]);
  const reschedules = new Set([
    "quiero reagendar", "necesito reagendar", "reagendar", "quiero cambiar",
    "cambiar horario", "necesito cambiar la cita"
  ]);
  const cancellations = new Set([
    "no podre asistir", "no asistire", "no voy a poder", "cancelo", "cancelar cita",
    "quiero cancelar"
  ]);

  if (confirmations.has(reply)) return "confirm";
  if (reschedules.has(reply)) return "reschedule";
  if (cancellations.has(reply)) return "cancel";
  return null;
}

async function releaseFromPatientReply(
  appointment: AppointmentRow,
  response: "reprogram_requested" | "cancelled",
  responseAt: string
) {
  const client = createSupabaseServiceRoleClient();
  const originalTime = appointment.appointment_time;

  await client
    .from("patient_appointment_history")
    .update({ original_scheduled_at: `${appointment.appointment_date}T${originalTime.slice(0, 5)}:00-06:00` })
    .eq("legacy_appointment_id", appointment.id)
    .is("original_scheduled_at", null);

  await client.from("appointments").update({
    appointment_time: "08:00",
    status: "cancelled",
    confirmation_response: response,
    confirmation_response_at: responseAt,
    confirmation_original_time: originalTime,
    confirmation_released_at: responseAt,
    confirmation_release_notice_sent_at: responseAt,
    confirmation_last_error: null
  }).eq("id", appointment.id);

  const { data: branch } = await client
    .from("branches")
    .select("calendar_email")
    .eq("code", appointment.branch_code ?? "SN")
    .maybeSingle();
  await releaseGoogleCalendarEventAtEight(
    appointment,
    branch?.calendar_email ?? undefined,
    response === "cancelled" ? "cancelo" : "reagendar"
  );
}

async function sendReplyAndSave(appointment: AppointmentRow, body: string) {
  if (!isCloudWhatsAppOutboundEnabled()) return;
  const sentAt = new Date().toISOString();
  const metaMessageId = await sendCloudWhatsAppText(appointment.whatsapp, body);
  await saveOutboundMessage(appointment, metaMessageId, body, sentAt);
}

export async function handleAppointmentConfirmationReply(
  whatsapp: string,
  incomingBody: string,
  replyToMetaMessageId?: string
) {
  const intent = getConfirmationIntent(incomingBody);
  if (!intent) return false;

  const client = createSupabaseServiceRoleClient();
  const today = getMonterreyNow(new Date()).date;
  let appointment: AppointmentRow | null = null;

  if (replyToMetaMessageId) {
    const { data: relatedMessage } = await client
      .from("whatsapp_messages")
      .select("sent_at")
      .eq("meta_message_id", replyToMetaMessageId)
      .maybeSingle();

    if (relatedMessage?.sent_at) {
      const { data: relatedAppointments } = await client
        .from("appointments")
        .select(APPOINTMENT_SELECT)
        .eq("whatsapp", whatsapp)
        .or([
          `confirmation_first_sent_at.eq.${relatedMessage.sent_at}`,
          `confirmation_second_sent_at.eq.${relatedMessage.sent_at}`,
          `confirmation_release_notice_sent_at.eq.${relatedMessage.sent_at}`
        ].join(","))
        .limit(2);
      if (relatedAppointments?.length === 1) {
        appointment = relatedAppointments[0] as unknown as AppointmentRow;
      }
    }
  }

  if (!appointment) {
    const { data: candidates } = await client
      .from("appointments")
      .select(APPOINTMENT_SELECT)
      .eq("whatsapp", whatsapp)
      .eq("status", "pending")
      .gte("appointment_date", today)
      .not("confirmation_first_sent_at", "is", null)
      .is("confirmation_response", null)
      .order("appointment_date", { ascending: true })
      .order("appointment_time", { ascending: true })
      .limit(2);

    if (!candidates || candidates.length !== 1) return false;
    appointment = candidates[0] as unknown as AppointmentRow;
  }

  const isReleased = appointment.status === "cancelled" && Boolean(appointment.confirmation_released_at);
  if (appointment.confirmation_response || (appointment.status !== "pending" && !isReleased)) return false;
  if (intent === "confirm" && appointment.status !== "pending") return false;

  const responseAt = new Date().toISOString();

  if (intent === "confirm") {
    await client.from("appointments").update({
      status: "confirmed",
      confirmation_response: "confirmed",
      confirmation_response_at: responseAt,
      confirmation_last_error: null
    }).eq("id", appointment.id);

    const { data: branch } = await client
      .from("branches")
      .select("name, calendar_email")
      .eq("code", appointment.branch_code ?? "SN")
      .maybeSingle();
    await syncGoogleCalendarEventStatus(
      { ...appointment, status: "confirmed" },
      "confirmed",
      branch?.calendar_email ?? undefined
    );
    await sendReplyAndSave(
      appointment,
      `¡Gracias, ${appointment.first_name}! ✔️ Tu cita de ${formatDate(appointment.appointment_date)} a las ${formatTime(appointment.appointment_time)} quedó confirmada. ¡Te esperamos!`
    );
    return true;
  }

  const response = intent === "cancel" ? "cancelled" : "reprogram_requested";
  await releaseFromPatientReply(appointment, response, responseAt);
  await client.from("whatsapp_conversations").update({
    workflow_status: "seguimiento",
    updated_at: responseAt
  }).eq("whatsapp", whatsapp);
  await sendReplyAndSave(
    appointment,
    intent === "cancel"
      ? `Gracias por avisarnos, ${appointment.first_name}. Tu horario quedó liberado. Cuando desees agendar nuevamente, quedamos a tus órdenes.`
      : `Claro, ${appointment.first_name}. Liberamos tu horario actual y en breve te ayudamos a elegir una nueva cita.`
  );
  return true;
}
