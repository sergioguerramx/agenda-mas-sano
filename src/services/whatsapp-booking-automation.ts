import type { SupabaseClient } from "@supabase/supabase-js";
import { BRANCH_SHORT_NAMES, getBranchLocation } from "@/lib/branch-locations";
import { buildAvailableDates, buildSlotsForDate, formatDisplayDate } from "@/lib/schedule";
import {
  isCloudWhatsAppOutboundEnabled,
  sendCloudWhatsAppList,
  sendCloudWhatsAppReplyButtons,
  sendCloudWhatsAppText
} from "@/lib/meta-whatsapp";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";
import { syncContactFromAppointment } from "@/services/contacts";
import {
  createGoogleCalendarEvent,
  getGoogleCalendarSlotCounts,
  isGoogleCalendarSlotAvailable
} from "@/services/google-calendar";
import type { AppointmentRow } from "@/types/appointments";

type BookingStep = "awaiting_branch" | "awaiting_day_shift" | "awaiting_time" | "awaiting_name";
type BranchCode = "SN" | "MTY_SUR";
type Shift = "morning" | "afternoon";

type BookingContext = {
  branchCode?: BranchCode;
  date?: string;
  shift?: Shift;
  time?: string;
  slotOffset?: number;
  invalidAttempts?: number;
  appointmentId?: string;
};

type ConversationRow = {
  id: string;
  whatsapp: string;
  contact_name: string | null;
  workflow_status: string;
  automation_step: BookingStep | null;
  automation_context: BookingContext | null;
};

type IncomingBookingMessage = {
  conversationId: string;
  whatsapp: string;
  body: string;
  selectionId?: string;
  fromAd?: boolean;
};

const MTY_SUR_OPENING_DATE = "2026-08-03";
const PRICE_CHANGE_AT = new Date("2026-08-01T17:00:00-06:00").getTime();
const FALLBACK_TEST_WHATSAPP = "+528132469930";
const AUTOMATION_SENDER = "automatizacion";
const MAX_INVALID_ATTEMPTS = 2;

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9:/. ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getOffer(now = new Date()) {
  const price = now.getTime() >= PRICE_CHANGE_AT ? 449 : 399;
  return {
    price,
    service: price === 449 ? "sesion_integral_449" : "sesion_integral_399"
  };
}

function getAutomationMode() {
  return (process.env.WHATSAPP_BOOKING_AUTOMATION_MODE ?? "test").trim().toLowerCase();
}

function getTestNumbers() {
  const configured = (process.env.WHATSAPP_BOOKING_TEST_NUMBERS ?? FALLBACK_TEST_WHATSAPP)
    .split(",")
    .map((value) => value.replace(/\s+/g, ""))
    .filter(Boolean);
  return new Set(configured);
}

function canAutomate(whatsapp: string) {
  const mode = getAutomationMode();
  if (mode === "live") return true;
  if (mode !== "test") return false;
  return getTestNumbers().has(whatsapp);
}

function isTestStartMessage(body: string) {
  return ["prueba agenda", "iniciar prueba agenda", "probar agenda"].includes(normalize(body));
}

function formatTime(time: string) {
  const [hour = 0, minute = 0] = time.slice(0, 5).split(":").map(Number);
  const suffix = hour >= 12 ? "p.m." : "a.m.";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`;
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

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function splitName(value: string) {
  const parts = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  return { firstName: parts.shift() ?? "", lastName: parts.join(" ") };
}

function cleanFullName(value: string) {
  return value
    .replace(/^(me llamo|mi nombre es|a nombre de)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isFullName(value: string) {
  if (value.length < 4 || value.length > 90 || /[0-9?]/.test(value)) return false;
  return value.split(" ").filter(Boolean).length >= 2
    && /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]+$/.test(value);
}

async function updateAutomation(
  client: SupabaseClient,
  conversationId: string,
  step: BookingStep | null,
  context: BookingContext,
  extra: Record<string, unknown> = {}
) {
  const now = new Date().toISOString();
  const { error } = await client.from("whatsapp_conversations").update({
    automation_step: step,
    automation_context: context,
    automation_updated_at: now,
    ...(step ? {} : { automation_started_at: null }),
    ...extra,
    updated_at: now
  }).eq("id", conversationId);
  if (error) throw error;
}

async function saveOutbound(
  client: SupabaseClient,
  conversation: ConversationRow,
  metaMessageId: string,
  body: string,
  messageType: "text" | "interactive"
) {
  const sentAt = new Date().toISOString();
  const { error } = await client.from("whatsapp_messages").insert({
    conversation_id: conversation.id,
    meta_message_id: metaMessageId,
    direction: 2,
    message_type: messageType,
    body,
    delivery_status: 1,
    sent_at: sentAt,
    sent_by_email: AUTOMATION_SENDER
  });
  if (error) console.error("No se guardó el mensaje automático", error);

  await client.from("whatsapp_conversations").update({
    last_message_at: sentAt,
    last_message_preview: body.slice(0, 180),
    last_message_direction: 2,
    updated_at: sentAt
  }).eq("id", conversation.id);
}

async function sendText(client: SupabaseClient, conversation: ConversationRow, body: string) {
  const id = await sendCloudWhatsAppText(conversation.whatsapp, body);
  await saveOutbound(client, conversation, id, body, "text");
}

async function sendButtons(
  client: SupabaseClient,
  conversation: ConversationRow,
  body: string,
  buttons: Array<{ id: string; title: string }>
) {
  const id = await sendCloudWhatsAppReplyButtons(conversation.whatsapp, body, buttons);
  await saveOutbound(client, conversation, id, body, "interactive");
}

async function sendList(
  client: SupabaseClient,
  conversation: ConversationRow,
  body: string,
  rows: Array<{ id: string; title: string; description?: string }>
) {
  const id = await sendCloudWhatsAppList(conversation.whatsapp, body, "Ver horarios", rows);
  await saveOutbound(client, conversation, id, body, "interactive");
}

function welcomeMessage() {
  const { price } = getOffer();
  return [
    "¡Hola! 💚 Gracias por escribir a Más Sano.",
    "Tenemos activa la PROMO ÁMATE:",
    `Tu Sesión Integral tiene un costo de $${price}, antes $850.`,
    "Es ideal si deseas bajar tallas, sentirte más ligera, mejorar tus hábitos y comenzar con un plan realista, sin dietas imposibles.",
    [
      "Tu sesión incluye:",
      "✅ Sesión con nutrióloga",
      "✅ Plan de alimentación personalizado",
      "✅ Auriculoterapia metabólica",
      "✅ Seguimiento y asesoría por WhatsApp"
    ].join("\n"),
    `📌 Las sesiones de seguimiento son quincenales. Si asistes cada 15 días, tu precio se mantiene en $${price}.`,
    "📅 Tenemos disponibilidad para agendar a partir del 3 de agosto.",
    "¿En cuál sucursal te gustaría agendar?"
  ].join("\n\n");
}

async function sendBranchQuestion(client: SupabaseClient, conversation: ConversationRow, includeWelcome: boolean) {
  await sendButtons(client, conversation, includeWelcome ? welcomeMessage() : "Selecciona la sucursal que prefieras:", [
    { id: "book_branch_sn", title: "📍 San Nicolás" },
    { id: "book_branch_mty_sur", title: "📍 Monterrey Sur" },
    { id: "book_question", title: "💬 Tengo una duda" }
  ]);
}

function locationsMessage() {
  const sanNicolas = getBranchLocation("SN");
  const monterreySur = getBranchLocation("MTY_SUR");
  return [
    "Estas son nuestras sucursales 💚",
    `📍 San Nicolás\n${sanNicolas.address}\n🗺️ ${sanNicolas.mapsUrl}`,
    `📍 Monterrey Sur\n${monterreySur.address}\n🗺️ ${monterreySur.mapsUrl}`,
    "Selecciona la que te resulte más conveniente."
  ].join("\n\n");
}

function branchFromReply(body: string, selectionId: string) {
  if (selectionId === "book_branch_sn") return "SN" as const;
  if (selectionId === "book_branch_mty_sur") return "MTY_SUR" as const;
  const reply = normalize(body);
  if (reply.includes("san nicolas") || reply === "sn") return "SN" as const;
  if (reply.includes("monterrey sur") || reply.includes("mty sur") || reply === "sur") return "MTY_SUR" as const;
  return null;
}

function parseDateAndShift(body: string) {
  const reply = normalize(body);
  const availableDates = buildAvailableDates(new Date());
  let date: string | undefined;
  let shift: Shift | undefined;

  const morningPhrase = /\b(por la manana|en la manana|horario de manana|horario manana|turno matutino|matutino)\b/.test(reply);
  const afternoonPhrase = /\b(por la tarde|en la tarde|horario de tarde|horario tarde|turno vespertino|vespertino)\b/.test(reply);
  if (morningPhrase) shift = "morning";
  if (afternoonPhrase) shift = "afternoon";

  if (/^(manana|para manana)\b/.test(reply)) {
    date = addDays(getMonterreyToday(), 1);
  } else if (/\bhoy\b/.test(reply)) {
    date = getMonterreyToday();
  }

  const weekdays: Array<[string, string]> = [
    ["lunes", "lunes"], ["martes", "martes"], ["miercoles", "miércoles"],
    ["jueves", "jueves"], ["viernes", "viernes"], ["sabado", "sábado"], ["domingo", "domingo"]
  ];
  const weekday = weekdays.find(([key]) => new RegExp(`\\b${key}\\b`).test(reply));
  if (weekday) {
    date = availableDates.find((item) => normalize(item.shortLabel) === normalize(weekday[1]))?.iso;
    if (!shift && /\bmanana\b/.test(reply)) shift = "morning";
  }

  const numericDate = reply.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numericDate) {
    const today = getMonterreyToday();
    const year = numericDate[3]
      ? Number(numericDate[3]) < 100 ? 2000 + Number(numericDate[3]) : Number(numericDate[3])
      : Number(today.slice(0, 4));
    date = `${year}-${String(Number(numericDate[2])).padStart(2, "0")}-${String(Number(numericDate[1])).padStart(2, "0")}`;
  }

  if (!shift && weekday && /\btarde\b/.test(reply)) shift = "afternoon";
  if (!shift && weekday && /\bmanana\b/.test(reply)) shift = "morning";
  return { date, shift };
}

function matchesShift(time: string, shift: Shift) {
  const minutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  return shift === "morning" ? minutes <= 13 * 60 + 20 : minutes >= 13 * 60 + 40;
}

async function getAvailableSlots(client: SupabaseClient, branchCode: BranchCode, date: string, shift: Shift) {
  if (branchCode === "MTY_SUR" && date < MTY_SUR_OPENING_DATE) return [];
  const { data: branch } = await client
    .from("branches")
    .select("calendar_email")
    .eq("code", branchCode)
    .eq("is_active", true)
    .maybeSingle();
  if (!branch?.calendar_email) throw new Error("La agenda de la sucursal no está conectada.");

  const base = buildSlotsForDate(date, new Date());
  const counts = await getGoogleCalendarSlotCounts(date, base.map((slot) => slot.time), branch.calendar_email);
  const slots = buildSlotsForDate(date, new Date(), Object.fromEntries(counts.map((item) => [item.time, item.count])));
  return slots.filter((slot) => slot.available && matchesShift(slot.time, shift));
}

async function showAvailableSlots(
  client: SupabaseClient,
  conversation: ConversationRow,
  context: BookingContext,
  offset = 0
) {
  if (!context.branchCode || !context.date || !context.shift) return;
  const slots = await getAvailableSlots(client, context.branchCode, context.date, context.shift);
  if (!slots.length) {
    await updateAutomation(client, conversation.id, "awaiting_day_shift", {
      branchCode: context.branchCode,
      invalidAttempts: 0
    });
    await sendText(
      client,
      conversation,
      `Por ahora no encontramos horarios disponibles el ${formatDisplayDate(context.date)} en ese turno. ¿Qué otro día y horario de mañana o tarde prefieres?`
    );
    return;
  }

  const visible = slots.slice(offset, offset + 9);
  const hasMore = offset + visible.length < slots.length;
  const rows = visible.map((slot) => ({
    id: `book_time_${slot.time.replace(":", "_")}`,
    title: formatTime(slot.time),
    description: "Disponible"
  }));
  if (hasMore) rows.push({ id: "book_more_times", title: "Más horarios", description: "Mostrar otras opciones" });

  await updateAutomation(client, conversation.id, "awaiting_time", {
    ...context,
    slotOffset: offset,
    invalidAttempts: 0
  });
  await sendList(
    client,
    conversation,
    `Para el ${formatDisplayDate(context.date)} tenemos estos horarios disponibles:`,
    rows
  );
}

function timeFromReply(body: string, selectionId: string, shift: Shift) {
  if (selectionId.startsWith("book_time_")) return selectionId.replace("book_time_", "").replace("_", ":");
  const reply = normalize(body).replace(/\s+/g, "");
  const match = reply.match(/\b(\d{1,2})(?::(\d{2}))?(a\.?m\.?|p\.?m\.?)?/);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const suffix = match[3] ?? "";
  if (suffix.startsWith("p") && hour < 12) hour += 12;
  if (suffix.startsWith("a") && hour === 12) hour = 0;
  if (!suffix && shift === "afternoon" && hour < 12) hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

async function handOffToTeam(client: SupabaseClient, conversation: ConversationRow) {
  await updateAutomation(client, conversation.id, null, {}, {
    workflow_status: "interesado",
    follow_up_at: new Date().toISOString()
  });
  await sendText(client, conversation, "Con gusto 💚 Una asesora continuará contigo por aquí para ayudarte.");
}

async function retryOrHandOff(
  client: SupabaseClient,
  conversation: ConversationRow,
  step: BookingStep,
  context: BookingContext,
  clarification: string
) {
  const attempts = Number(context.invalidAttempts ?? 0) + 1;
  if (attempts >= MAX_INVALID_ATTEMPTS) {
    await handOffToTeam(client, conversation);
    return;
  }
  await updateAutomation(client, conversation.id, step, { ...context, invalidAttempts: attempts });
  await sendText(client, conversation, clarification);
}

async function createAutomaticAppointment(
  client: SupabaseClient,
  conversation: ConversationRow,
  context: BookingContext,
  fullName: string
) {
  const branchCode = context.branchCode;
  const date = context.date;
  const time = context.time;
  if (!branchCode || !date || !time) throw new Error("Faltan datos para crear la cita.");

  const { data: branch } = await client
    .from("branches")
    .select("name, calendar_email")
    .eq("code", branchCode)
    .eq("is_active", true)
    .maybeSingle();
  if (!branch?.calendar_email) throw new Error("La agenda de la sucursal no está conectada.");
  const stillAvailable = await isGoogleCalendarSlotAvailable(date, time, branch.calendar_email);
  if (!stillAvailable) return { status: "occupied" as const };

  const { firstName, lastName } = splitName(fullName);
  const today = getMonterreyToday();
  const immediatelyConfirmed = date <= addDays(today, 1);
  const offer = getOffer();
  const { data: inserted, error: insertError } = await client.from("appointments").insert({
    first_name: firstName,
    last_name: lastName,
    whatsapp: conversation.whatsapp,
    appointment_date: date,
    appointment_time: time,
    status: immediatelyConfirmed ? "confirmed" : "pending",
    brand: "mas_sano",
    modality: "presencial",
    service: offer.service,
    origin: "meta_ads_whatsapp_automatico",
    branch_code: branchCode
  }).select("id, first_name, last_name, whatsapp, appointment_date, appointment_time, status, google_calendar_event_id, brand, modality, service, origin, branch_code").single();
  if (insertError || !inserted) throw insertError ?? new Error("No se pudo guardar la cita.");

  const appointment = inserted as AppointmentRow;
  try {
    const calendarResult = await createGoogleCalendarEvent(appointment, branch.calendar_email);
    if (!calendarResult.eventId) throw new Error("Google Calendar no confirmó la cita.");
    await client.from("appointments").update({ google_calendar_event_id: calendarResult.eventId }).eq("id", appointment.id);
  } catch (error) {
    await client.from("patient_appointment_history").delete().eq("legacy_appointment_id", appointment.id);
    await client.from("appointments").delete().eq("id", appointment.id);
    throw error;
  }

  try {
    await syncContactFromAppointment(client, appointment.id);
  } catch (error) {
    console.warn("La cita se creó, pero el resumen del contacto quedó pendiente", error);
  }

  await updateAutomation(client, conversation.id, null, { appointmentId: appointment.id }, {
    workflow_status: "cita_agendada",
    branch_interest: branchCode,
    follow_up_at: null
  });

  const location = getBranchLocation(branchCode, date);
  const locationLines = [`📍 ${location.address}`];
  if (location.mapsUrl) locationLines.push(`🗺️ ${location.mapsUrl}`);
  const confirmation = immediatelyConfirmed
    ? [
        `¡Listo, ${firstName}! Tu cita en Más Sano ${BRANCH_SHORT_NAMES[branchCode]} quedó agendada y confirmada 📌`,
        `📅 ${formatDisplayDate(date)}`,
        `🕐 ${formatTime(time)}`,
        `💚 Sesión Integral: $${offer.price}`,
        ...locationLines,
        "Si necesitas realizar algún cambio, avísanos con anticipación.",
        "Será un gusto recibirte 💚"
      ].join("\n\n")
    : [
        `¡Listo, ${firstName}! Tu cita en Más Sano ${BRANCH_SHORT_NAMES[branchCode]} quedó agendada 📌`,
        `📅 ${formatDisplayDate(date)}`,
        `🕐 ${formatTime(time)}`,
        `💚 Sesión Integral: $${offer.price}`,
        ...locationLines,
        "Antes de tu cita te enviaremos un mensaje para confirmar tu asistencia.",
        "Será un gusto recibirte 💚"
      ].join("\n\n");
  await sendText(client, conversation, confirmation);
  return { status: "created" as const };
}

export async function handleWhatsAppBookingAutomation(message: IncomingBookingMessage) {
  if (!isCloudWhatsAppOutboundEnabled() || !canAutomate(message.whatsapp)) return false;

  const client = createSupabaseServiceRoleClient();
  const { data } = await client
    .from("whatsapp_conversations")
    .select("id, whatsapp, contact_name, workflow_status, automation_step, automation_context")
    .eq("id", message.conversationId)
    .maybeSingle();
  const conversation = data as ConversationRow | null;
  if (!conversation || conversation.workflow_status === "no_contactar") return false;

  const shouldStart = Boolean(message.fromAd || isTestStartMessage(message.body));
  if (!conversation.automation_step && !shouldStart) return false;
  if (!conversation.automation_step) {
    const now = new Date().toISOString();
    await updateAutomation(client, conversation.id, "awaiting_branch", {}, {
      workflow_status: "interesado",
      branch_interest: "POR_CONFIRMAR",
      automation_started_at: now
    });
    await sendBranchQuestion(client, conversation, true);
    return true;
  }

  const context = conversation.automation_context ?? {};
  const selectionId = message.selectionId ?? "";
  const reply = normalize(message.body);

  if (conversation.automation_step === "awaiting_branch") {
    if (selectionId === "book_question" || reply.includes("tengo una duda") || reply.includes("hablar con una asesora")) {
      await handOffToTeam(client, conversation);
      return true;
    }
    if (selectionId === "book_locations" || reply.includes("ver ubicaciones") || reply === "ubicaciones") {
      await sendText(client, conversation, locationsMessage());
      await sendBranchQuestion(client, conversation, false);
      return true;
    }
    const branchCode = branchFromReply(message.body, selectionId);
    if (!branchCode) {
      await retryOrHandOff(client, conversation, "awaiting_branch", context, "Para continuar, selecciona San Nicolás o Monterrey Sur.");
      return true;
    }
    await updateAutomation(client, conversation.id, "awaiting_day_shift", { branchCode, invalidAttempts: 0 }, {
      branch_interest: branchCode,
      workflow_status: "interesado"
    });
    await sendText(
      client,
      conversation,
      `Perfecto 💚 Elegiste Más Sano ${BRANCH_SHORT_NAMES[branchCode]}.\n\n¿Qué día te gustaría venir y prefieres horario de mañana o tarde?`
    );
    return true;
  }

  if (conversation.automation_step === "awaiting_day_shift") {
    const parsed = selectionId === "book_shift_morning"
      ? { date: context.date, shift: "morning" as const }
      : selectionId === "book_shift_afternoon"
        ? { date: context.date, shift: "afternoon" as const }
        : parseDateAndShift(message.body);
    const date = parsed.date ?? context.date;
    const shift = parsed.shift ?? context.shift;
    const validDate = date ? buildAvailableDates(new Date()).find((item) => item.iso === date && !item.closed) : null;
    if (!date || !validDate) {
      await retryOrHandOff(client, conversation, "awaiting_day_shift", { ...context, shift }, "Indícanos un día disponible dentro de los próximos 15 días. Por ejemplo: viernes por la tarde.");
      return true;
    }
    if (!shift) {
      await updateAutomation(client, conversation.id, "awaiting_day_shift", { ...context, date, invalidAttempts: 0 });
      await sendButtons(client, conversation, `¿Prefieres horario de mañana o tarde para el ${formatDisplayDate(date)}?`, [
        { id: "book_shift_morning", title: "🌤️ Mañana" },
        { id: "book_shift_afternoon", title: "🌙 Tarde" }
      ]);
      return true;
    }
    const selectedShift = selectionId === "book_shift_morning"
      ? "morning"
      : selectionId === "book_shift_afternoon"
        ? "afternoon"
        : shift;
    await showAvailableSlots(client, conversation, { ...context, date, shift: selectedShift });
    return true;
  }

  if (conversation.automation_step === "awaiting_time") {
    if (selectionId === "book_more_times" || reply === "mas horarios") {
      await showAvailableSlots(client, conversation, context, Number(context.slotOffset ?? 0) + 9);
      return true;
    }
    if (!context.branchCode || !context.date || !context.shift) {
      await handOffToTeam(client, conversation);
      return true;
    }
    const selectedTime = timeFromReply(message.body, selectionId, context.shift);
    const slots = await getAvailableSlots(client, context.branchCode, context.date, context.shift);
    if (!selectedTime || !slots.some((slot) => slot.time === selectedTime)) {
      await retryOrHandOff(client, conversation, "awaiting_time", context, "Ese horario no aparece disponible. Selecciona una de las opciones de la lista.");
      return true;
    }
    await updateAutomation(client, conversation.id, "awaiting_name", { ...context, time: selectedTime, invalidAttempts: 0 });
    await sendText(client, conversation, "Excelente 💚 ¿Me compartes el nombre completo de la persona que asistirá?");
    return true;
  }

  const fullName = cleanFullName(message.body);
  if (!isFullName(fullName)) {
    await retryOrHandOff(client, conversation, "awaiting_name", context, "Para registrar la cita necesitamos nombre y apellido de la persona que asistirá.");
    return true;
  }

  try {
    const result = await createAutomaticAppointment(client, conversation, context, fullName);
    if (result.status === "occupied") {
      await sendText(client, conversation, "Ese horario acaba de ocuparse. Te mostraré nuevamente los horarios disponibles.");
      await showAvailableSlots(client, conversation, context, 0);
    }
  } catch (error) {
    console.error("No se pudo completar el agendado automático", error);
    await handOffToTeam(client, conversation);
  }
  return true;
}
