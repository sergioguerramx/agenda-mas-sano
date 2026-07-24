import type { SupabaseClient } from "@supabase/supabase-js";
import { BRANCH_SHORT_NAMES, getBranchLocation } from "@/lib/branch-locations";
import { getCurrentMasSanoOffer, getMasSanoAppointmentOffer } from "@/lib/mas-sano-pricing";
import { buildAvailableDates, buildSlotsForDate } from "@/lib/schedule";
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
import { upsertGoogleContact } from "@/services/google-contacts";
import { startAdLeadFollowUpSequence } from "@/services/whatsapp-ad-followups";
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
  adFollowUpStage?: 0 | 1 | 2 | 3 | 4;
  adFollowUpStartedAt?: string;
  adFollowUpExpiresAt?: string;
};

type ConversationRow = {
  id: string;
  whatsapp: string;
  contact_name: string | null;
  workflow_status: string;
  branch_interest: string | null;
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
const AUTOMATION_SENDER = "automatizacion";
const MAX_INVALID_ATTEMPTS = 2;
const ADVISOR_BUTTON = { id: "book_question", title: "Hablar con asesora" };

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9:/. -]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getOffer(now = new Date()) {
  return getCurrentMasSanoOffer(now);
}

function getAppointmentOffer(date: string) {
  return getMasSanoAppointmentOffer(date);
}

function getAutomationMode() {
  return (process.env.WHATSAPP_BOOKING_AUTOMATION_MODE ?? "live").trim().toLowerCase();
}

function canAutomate(_whatsapp: string) {
  return getAutomationMode() !== "off";
}

function isTestStartMessage(body: string) {
  return ["prueba agenda", "iniciar prueba agenda", "probar agenda"].includes(normalize(body));
}

function retargetingAction(body: string, selectionId: string) {
  const value = normalize(selectionId || body);
  if (selectionId === "book_opt_out") return "opt_out" as const;
  if (value.includes("horarios y ubicacion")) return "show_slots" as const;
  if (value.includes("ver horarios")) return "show_slots" as const;
  if (value.includes("ver ubicacion") || value.includes("ver ubicación")) return "show_location" as const;
  if (value.includes("no recibir mensajes")) return "opt_out" as const;
  return null;
}

function branchInterestToCode(value: string | null) {
  return value === "SN" || value === "MTY_SUR" ? value : null;
}

function formatTime(time: string) {
  const [hour = 0, minute = 0] = time.slice(0, 5).split(":").map(Number);
  const suffix = hour >= 12 ? "p.m." : "a.m.";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatWhatsAppDate(dateIso: string) {
  const formatted = new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(new Date(`${dateIso}T12:00:00Z`));
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
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

function buildBranchAvailableDates(branchCode?: BranchCode, now = new Date()) {
  const today = getMonterreyToday();
  if (branchCode === "MTY_SUR" && today < MTY_SUR_OPENING_DATE) {
    return buildAvailableDates(new Date(`${MTY_SUR_OPENING_DATE}T12:00:00Z`));
  }
  return buildAvailableDates(now);
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
    serviceHoursMessage(),
    "¿En cuál sucursal te gustaría agendar?"
  ].join("\n\n");
}

async function sendBranchQuestion(client: SupabaseClient, conversation: ConversationRow, includeWelcome: boolean) {
  await sendButtons(client, conversation, includeWelcome ? welcomeMessage() : "Selecciona la sucursal que prefieras:", [
    { id: "book_branch_sn", title: "📍 San Nicolás" },
    { id: "book_branch_mty_sur", title: "📍 Mty. Poniente" },
    { id: "book_question", title: "💬 Tengo una duda" }
  ]);
}

async function sendAvailableBranches(client: SupabaseClient, conversation: ConversationRow) {
  await sendButtons(
    client,
    conversation,
    [
      "Por el momento, nuestras únicas sucursales disponibles son:",
      "📍 *San Nicolás*",
      "📍 *Monterrey Poniente*",
      "¿En cuál te gustaría agendar? 💚"
    ].join("\n\n"),
    [
      { id: "book_branch_sn", title: "📍 San Nicolás" },
      { id: "book_branch_mty_sur", title: "📍 Mty. Poniente" },
      ADVISOR_BUTTON
    ]
  );
}

function locationsMessage() {
  const sanNicolas = getBranchLocation("SN");
  const monterreySur = getBranchLocation("MTY_SUR");
  return [
    "Estas son nuestras sucursales 💚",
    `📍 San Nicolás\n${sanNicolas.address}\n🗺️ ${sanNicolas.mapsUrl}`,
    `📍 Monterrey Poniente\n${monterreySur.address}\n🗺️ ${monterreySur.mapsUrl}`,
    "Selecciona la que te resulte más conveniente."
  ].join("\n\n");
}

function serviceHoursMessage() {
  return [
    "*Horarios de atención:*",
    "*Lunes, martes, jueves y viernes:*\n9:20 a.m. a 1:20 p.m. / 3:00 p.m. a 7:00 p.m.",
    "*Sábado:*\n10:00 a.m. a 3:00 p.m.",
    "Miércoles y domingo: *cerrado*"
  ].join("\n\n");
}

function closedDayMessage() {
  return [
    "Los *miércoles y domingos permanecemos cerrados*.",
    serviceHoursMessage().replace("\n\nMiércoles y domingo: *cerrado*", ""),
    "¿Te gustaría revisar los *días y horarios disponibles*? 💚"
  ].join("\n\n");
}

function fifteenDayWindowMessage() {
  return [
    "Nuestra agenda muestra disponibilidad *solo para los próximos 15 días*.",
    "¿Qué día dentro de este periodo te gustaría venir y prefieres horario de mañana o tarde? 💚"
  ].join("\n\n");
}

function monterreyOpeningMessage() {
  return [
    "*Más Sano Monterrey Poniente* tendrá disponibilidad a partir del *lunes 3 de agosto*.",
    "¿Qué día a partir de esa fecha te gustaría venir y prefieres horario de mañana o tarde? 💚"
  ].join("\n\n");
}

function unclearDateMessage() {
  return [
    "No logramos identificar el día y horario que deseas.",
    "Puedes escribirlo, por ejemplo: *lunes por la mañana*, *jueves a las 4:00 p.m.* o *sábado a las 12:00 p.m.* 💚"
  ].join("\n\n");
}

function branchFromReply(body: string, selectionId: string) {
  if (selectionId === "book_branch_sn") return "SN" as const;
  if (selectionId === "book_branch_mty_sur") return "MTY_SUR" as const;
  const reply = normalize(body);
  if (reply.includes("san nicolas") || reply === "sn") return "SN" as const;
  if (
    reply.includes("monterrey poniente")
    || reply.includes("mty poniente")
    || reply.includes("plaza real")
    || reply.includes("alfao")
    || reply === "poniente"
    || reply.includes("monterrey sur")
    || reply.includes("mty sur")
    || reply === "sur"
  ) return "MTY_SUR" as const;
  return null;
}

function parseDateAndShift(body: string, branchCode?: BranchCode) {
  const reply = normalize(body);
  const availableDates = buildBranchAvailableDates(branchCode);
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
    if (!shift && /\bmanana\b/.test(reply)) shift = "morning";
    const matchingWeekdays = availableDates.filter(
      (item) => normalize(item.shortLabel) === normalize(weekday[1])
    );
    date = matchingWeekdays[0]?.iso;
    if (date === getMonterreyToday() && shift && !/\bhoy\b/.test(reply)) {
      const selectedShift = shift;
      const stillHasServiceTime = buildSlotsForDate(
        date,
        new Date(),
        {},
        branchCode ?? "SN"
      ).some((slot) => slot.available && matchesShift(slot.time, selectedShift));
      if (!stillHasServiceTime) date = matchingWeekdays[1]?.iso;
    }
  }

  const numericDate = reply.match(/\b(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?\b/);
  if (numericDate) {
    const today = getMonterreyToday();
    const year = numericDate[3]
      ? Number(numericDate[3]) < 100 ? 2000 + Number(numericDate[3]) : Number(numericDate[3])
      : Number(today.slice(0, 4));
    date = `${year}-${String(Number(numericDate[2])).padStart(2, "0")}-${String(Number(numericDate[1])).padStart(2, "0")}`;
  }

  const monthNumbers: Record<string, number> = {
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12
  };
  const writtenDate = reply.match(
    /\b(\d{1,2})\s+(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+(?:de\s+)?(\d{2,4}))?\b/
  );
  if (writtenDate) {
    const today = getMonterreyToday();
    const year = writtenDate[3]
      ? Number(writtenDate[3]) < 100 ? 2000 + Number(writtenDate[3]) : Number(writtenDate[3])
      : Number(today.slice(0, 4));
    const month = monthNumbers[writtenDate[2]];
    date = `${year}-${String(month).padStart(2, "0")}-${String(Number(writtenDate[1])).padStart(2, "0")}`;
  }

  const hasSpecificDate = Boolean(numericDate || writtenDate);
  const hasRecognizedDay = Boolean(weekday || hasSpecificDate);
  if (!shift && hasRecognizedDay && /\b(tarde|p\.?m\.?)\b/.test(reply)) shift = "afternoon";
  if (!shift && hasRecognizedDay && /\b(manana|temprano|a\.?m\.?)\b/.test(reply)) shift = "morning";
  return { date, shift };
}

function matchesShift(time: string, shift: Shift) {
  const minutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  return shift === "morning" ? minutes <= 13 * 60 + 20 : minutes >= 13 * 60;
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

  const base = buildSlotsForDate(date, new Date(), {}, branchCode);
  const counts = await getGoogleCalendarSlotCounts(date, base.map((slot) => slot.time), branch.calendar_email);
  const slots = buildSlotsForDate(
    date,
    new Date(),
    Object.fromEntries(counts.map((item) => [item.time, item.count])),
    branchCode
  );
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
    const otherShift: Shift = context.shift === "afternoon" ? "morning" : "afternoon";
    const otherShiftLabel = otherShift === "morning" ? "mañana" : "tarde";
    await updateAutomation(client, conversation.id, "awaiting_day_shift", {
      branchCode: context.branchCode,
      date: context.date,
      shift: otherShift,
      invalidAttempts: 0
    });
    await sendButtons(
      client,
      conversation,
      [
        `Por ahora no encontramos horarios disponibles el *${formatWhatsAppDate(context.date)} por la ${context.shift === "morning" ? "mañana" : "tarde"}*.`,
        `¿Te gustaría revisar los horarios de la ${otherShiftLabel} para ese mismo día o prefieres otro día?`,
        `Puedes responder, por ejemplo: *${formatWhatsAppDate(context.date).split(" ")[0].toLowerCase()} por la ${otherShiftLabel}* o *jueves por la tarde*.`
      ].join("\n\n"),
      [
        { id: otherShift === "morning" ? "book_shift_morning" : "book_shift_afternoon", title: `Ver ${otherShiftLabel}` },
        { id: "book_choose_other_day", title: "Elegir otro día" },
        ADVISOR_BUTTON
      ]
    );
    return;
  }

  const visible = slots.slice(offset, offset + 7);
  const hasMore = offset + visible.length < slots.length;
  const rows = visible.map((slot) => ({
    id: `book_time_${slot.time.replace(":", "_")}`,
    title: formatTime(slot.time),
    description: "Disponible"
  }));
  if (hasMore) rows.push({ id: "book_more_times", title: "Más horarios", description: "Mostrar otras opciones" });
  rows.push({ id: "book_choose_other_day", title: "Elegir otro día", description: "Revisar otra fecha" });
  rows.push({ id: "book_question", title: "Hablar con asesora", description: "Recibir ayuda personal" });

  const sanNicolasLocation = context.branchCode === "SN"
    ? getBranchLocation("SN", context.date)
    : null;
  const initialAvailabilityMessage = sanNicolasLocation
    ? `Para el ${formatWhatsAppDate(context.date)} te atenderemos en ${sanNicolasLocation.label} 💚\n\n📍 ${sanNicolasLocation.address}\n🗺️ ${sanNicolasLocation.mapsUrl}\n\nEstos son los horarios disponibles:`
    : `Para el ${formatWhatsAppDate(context.date)} tenemos estos horarios disponibles:`;
  const availabilityMessage = offset > 0
    ? [
        `También tenemos estos horarios disponibles para el *${formatWhatsAppDate(context.date)}*:`,
        "Selecciona el horario que prefieras. Si ninguno te funciona, puedes elegir otro día o solicitar ayuda 💚"
      ].join("\n\n")
    : initialAvailabilityMessage;
  const dayOfWeek = new Date(`${context.date}T12:00:00Z`).getUTCDay();
  const lastServiceTime = dayOfWeek === 6 ? "3:00 p.m." : "7:00 p.m.";
  const availabilityDetail = hasMore && offset === 0
    ? `\n\nTe mostramos los primeros horarios. Nuestro último horario ese día es a las *${lastServiceTime}*. Si buscas una hora diferente, selecciona *Más horarios* o escríbenos cuál prefieres.`
    : "";

  await updateAutomation(client, conversation.id, "awaiting_time", {
    ...context,
    slotOffset: offset,
    invalidAttempts: 0
  });
  await sendList(
    client,
    conversation,
    `${availabilityMessage}${availabilityDetail}`,
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
  await sendText(
    client,
    conversation,
    "Perfecto 💚 Una asesora continuará la conversación contigo por este medio.\n\nSi gustas, cuéntanos brevemente en qué podemos ayudarte."
  );
}

async function retryOrHandOff(
  client: SupabaseClient,
  conversation: ConversationRow,
  step: BookingStep,
  context: BookingContext,
  clarification: string,
  buttons?: Array<{ id: string; title: string }>
) {
  const attempts = Number(context.invalidAttempts ?? 0) + 1;
  if (attempts >= MAX_INVALID_ATTEMPTS) {
    await handOffToTeam(client, conversation);
    return;
  }
  await updateAutomation(client, conversation.id, step, { ...context, invalidAttempts: attempts });
  if (buttons?.length) {
    await sendButtons(client, conversation, clarification, buttons);
  } else {
    await sendText(client, conversation, clarification);
  }
}

async function sendOccupiedSlot(
  client: SupabaseClient,
  conversation: ConversationRow,
  context: BookingContext
) {
  await updateAutomation(client, conversation.id, "awaiting_time", { ...context, invalidAttempts: 0 });
  await sendButtons(
    client,
    conversation,
    "El horario que seleccionaste acaba de ocuparse.\n\nPodemos mostrarte otros horarios disponibles para ese mismo día o ayudarte personalmente 💚",
    [
      { id: "book_show_other_times", title: "Ver otros horarios" },
      ADVISOR_BUTTON
    ]
  );
}

async function sendUnexpectedError(client: SupabaseClient, conversation: ConversationRow) {
  await updateAutomation(client, conversation.id, null, {}, {
    workflow_status: "interesado",
    follow_up_at: new Date().toISOString()
  });
  await sendButtons(
    client,
    conversation,
    "Por el momento no pudimos continuar automáticamente con tu solicitud.\n\nNo te preocupes 💚 Una asesora puede ayudarte a revisar la disponibilidad y completar tu cita.",
    [ADVISOR_BUTTON]
  );
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
  const stillAvailable = await isGoogleCalendarSlotAvailable(date, time, branch.calendar_email, branchCode);
  if (!stillAvailable) return { status: "occupied" as const };

  const { firstName, lastName } = splitName(fullName);
  const today = getMonterreyToday();
  const immediatelyConfirmed = date <= addDays(today, 1);
  const offer = getAppointmentOffer(date);
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

  try {
    const googleContact = await upsertGoogleContact(appointment);
    if (googleContact.resourceName) {
      await client.from("appointments").update({ google_contact_id: googleContact.resourceName }).eq("id", appointment.id);
      await client.from("contacts").update({ google_contact_resource_name: googleContact.resourceName }).eq("whatsapp", appointment.whatsapp);
    }
  } catch (error) {
    console.warn("La cita se creó, pero Google Contacts quedó pendiente", error);
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
        `¡Listo, *${firstName}*! Tu cita en *Más Sano ${BRANCH_SHORT_NAMES[branchCode]}* quedó agendada y confirmada 📌`,
        `📅 *${formatWhatsAppDate(date)}*`,
        `🕐 *${formatTime(time)}*`,
        `💚 Sesión Integral: *$${offer.price}*`,
        ...locationLines,
        "Si necesitas realizar algún cambio, avísanos con anticipación.",
        "Será un gusto recibirte 💚"
      ].join("\n\n")
    : [
        `¡Listo, *${firstName}*! Tu cita en *Más Sano ${BRANCH_SHORT_NAMES[branchCode]}* quedó agendada 📌`,
        `📅 *${formatWhatsAppDate(date)}*`,
        `🕐 *${formatTime(time)}*`,
        `💚 Sesión Integral: *$${offer.price}*`,
        ...locationLines,
        "Antes de tu cita te enviaremos un mensaje para confirmar tu asistencia.",
        "Será un gusto recibirte 💚"
      ].join("\n\n");
  await sendText(client, conversation, confirmation);
  return { status: "created" as const };
}

async function processWhatsAppBookingAutomation(message: IncomingBookingMessage) {
  if (!isCloudWhatsAppOutboundEnabled()) return false;

  const client = createSupabaseServiceRoleClient();
  const { data } = await client
    .from("whatsapp_conversations")
    .select("id, whatsapp, contact_name, workflow_status, branch_interest, automation_step, automation_context")
    .eq("id", message.conversationId)
    .maybeSingle();
  const conversation = data as ConversationRow | null;
  if (!conversation) return false;

  const selectionId = message.selectionId ?? "";
  const campaignAction = retargetingAction(message.body, selectionId);
  const campaignBranch = branchInterestToCode(conversation.branch_interest);
  const advisorRequested = selectionId === "book_question"
    || normalize(message.body).includes("tengo una duda")
    || normalize(message.body).includes("hablar con asesora")
    || normalize(message.body).includes("hablar con una asesora");
  const campaignFreshLead = Boolean(campaignBranch && conversation.workflow_status === "nuevo");
  const campaignContinuation = Boolean(campaignBranch && conversation.automation_step);
  const canHandleCampaignReply = Boolean(campaignAction || (campaignBranch && advisorRequested) || campaignFreshLead || campaignContinuation);
  if (!canAutomate(message.whatsapp) && !canHandleCampaignReply) return false;

  if (campaignAction === "opt_out") {
    await updateAutomation(client, conversation.id, null, {}, {
      workflow_status: "no_contactar",
      follow_up_at: null
    });
    await sendText(
      client,
      conversation,
      "Listo. Registramos tu solicitud y ya no te enviaremos mensajes promocionales.\n\nÚnicamente podrás recibir información relacionada con las citas que tú agendes. Seguimos a tus órdenes 💚"
    );
    return true;
  }
  if (conversation.workflow_status === "no_contactar") return false;

  if (message.fromAd) {
    const now = new Date();
    await updateAutomation(client, conversation.id, "awaiting_branch", {}, {
      workflow_status: "interesado",
      branch_interest: "POR_CONFIRMAR",
      automation_started_at: now.toISOString(),
      follow_up_at: null
    });
    await startAdLeadFollowUpSequence(client, conversation, now);
    return true;
  }

  if (campaignAction && campaignBranch) {
    const location = getBranchLocation(campaignBranch);
    await updateAutomation(client, conversation.id, "awaiting_day_shift", {
      branchCode: campaignBranch,
      invalidAttempts: 0
    }, {
      workflow_status: "interesado",
      branch_interest: campaignBranch,
      automation_started_at: new Date().toISOString()
    });
    const openingLine = campaignBranch === "MTY_SUR"
      ? "📅 Tenemos disponibilidad a partir del *lunes 3 de agosto*."
      : "📅 Tenemos horarios disponibles dentro de los próximos 15 días.";
    const lead = campaignAction === "show_location"
      ? `Esta es la ubicación de *Más Sano ${BRANCH_SHORT_NAMES[campaignBranch]}* 💚`
      : `Perfecto 💚 Te comparto la información de *Más Sano ${BRANCH_SHORT_NAMES[campaignBranch]}*.`;
    const hours = campaignAction === "show_slots" ? `\n\n${serviceHoursMessage()}` : "";
    await sendText(
      client,
      conversation,
      `${lead}\n\n📍 ${location.address}\n🗺️ ${location.mapsUrl}\n\n${openingLine}${hours}\n\n¿Qué día te gustaría venir y prefieres horario de mañana o tarde?`
    );
    return true;
  }

  if (!conversation.automation_step && campaignFreshLead && !advisorRequested) {
    const campaignContext = { branchCode: campaignBranch as BranchCode, invalidAttempts: 0 };
    await updateAutomation(client, conversation.id, "awaiting_day_shift", campaignContext, {
      workflow_status: "interesado",
      automation_started_at: new Date().toISOString()
    });
    conversation.automation_step = "awaiting_day_shift";
    conversation.automation_context = campaignContext;
    conversation.workflow_status = "interesado";
  }

  const restartRequested = isTestStartMessage(message.body);
  const shouldStart = Boolean(message.fromAd || restartRequested);
  if (!conversation.automation_step && advisorRequested) {
    await handOffToTeam(client, conversation);
    return true;
  }
  if (!conversation.automation_step && !shouldStart) return false;
  if (!conversation.automation_step || restartRequested) {
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
  const reply = normalize(message.body);

  if (selectionId === "book_question" || reply.includes("tengo una duda") || reply.includes("hablar con asesora") || reply.includes("hablar con una asesora")) {
    await handOffToTeam(client, conversation);
    return true;
  }

  if (selectionId === "book_choose_other_day" || selectionId === "book_show_availability") {
    if (selectionId === "book_show_availability" && !context.branchCode) {
      await updateAutomation(client, conversation.id, "awaiting_branch", {
        invalidAttempts: 0
      });
      await sendAvailableBranches(client, conversation);
      return true;
    }
    await updateAutomation(client, conversation.id, "awaiting_day_shift", {
      branchCode: context.branchCode,
      invalidAttempts: 0
    });
    await sendButtons(
      client,
      conversation,
      "Claro 💚 ¿Qué otro día te gustaría venir y prefieres horario de mañana o tarde?\n\nRecuerda que nuestra agenda muestra disponibilidad solo para los próximos *15 días*.",
      [ADVISOR_BUTTON]
    );
    return true;
  }

  if (selectionId === "book_show_other_times" && context.branchCode && context.date && context.shift) {
    await showAvailableSlots(client, conversation, context, 0);
    return true;
  }

  if (conversation.automation_step === "awaiting_branch") {
    if (selectionId === "book_locations" || reply.includes("ver ubicaciones") || reply === "ubicaciones") {
      await sendText(client, conversation, locationsMessage());
      await sendBranchQuestion(client, conversation, false);
      return true;
    }
    const branchCode = branchFromReply(message.body, selectionId);
    if (!branchCode) {
      const attempts = Number(context.invalidAttempts ?? 0) + 1;
      if (attempts >= MAX_INVALID_ATTEMPTS) {
        await handOffToTeam(client, conversation);
      } else {
        await updateAutomation(client, conversation.id, "awaiting_branch", { ...context, invalidAttempts: attempts });
        await sendAvailableBranches(client, conversation);
      }
      return true;
    }
    await updateAutomation(client, conversation.id, "awaiting_day_shift", { branchCode, invalidAttempts: 0 }, {
      branch_interest: branchCode,
      workflow_status: "interesado"
    });
    const monterreySurLocation = branchCode === "MTY_SUR" ? getBranchLocation("MTY_SUR") : null;
    await sendText(
      client,
      conversation,
      monterreySurLocation
        ? `Perfecto 💚 Elegiste Más Sano ${BRANCH_SHORT_NAMES[branchCode]}.\n\n📍 ${monterreySurLocation.address}\n🗺️ ${monterreySurLocation.mapsUrl}\n\n📅 Tenemos disponibilidad a partir del lunes 3 de agosto.\n\n¿Qué día te gustaría venir y prefieres horario de mañana o tarde?`
        : `Perfecto 💚 Elegiste Más Sano ${BRANCH_SHORT_NAMES[branchCode]}.\n\n¿Qué día te gustaría venir y prefieres horario de mañana o tarde?`
    );
    return true;
  }

  if (conversation.automation_step === "awaiting_day_shift") {
    const parsed = selectionId === "book_shift_morning"
      ? { date: context.date, shift: "morning" as const }
      : selectionId === "book_shift_afternoon"
        ? { date: context.date, shift: "afternoon" as const }
        : parseDateAndShift(message.body, context.branchCode);
    const date = parsed.date ?? context.date;
    const shift = parsed.shift ?? context.shift;
    const availableDates = buildBranchAvailableDates(context.branchCode);
    const matchingDate = date ? availableDates.find((item) => item.iso === date) : null;
    if (!date) {
      await retryOrHandOff(
        client,
        conversation,
        "awaiting_day_shift",
        { ...context, shift },
        unclearDateMessage(),
        [ADVISOR_BUTTON]
      );
      return true;
    }
    if (context.branchCode === "MTY_SUR" && date < MTY_SUR_OPENING_DATE) {
      await retryOrHandOff(
        client,
        conversation,
        "awaiting_day_shift",
        { ...context, shift },
        monterreyOpeningMessage(),
        [
          { id: "book_show_availability", title: "Ver disponibilidad" },
          ADVISOR_BUTTON
        ]
      );
      return true;
    }
    if (!matchingDate) {
      await retryOrHandOff(
        client,
        conversation,
        "awaiting_day_shift",
        { ...context, shift },
        fifteenDayWindowMessage(),
        [
          { id: "book_show_availability", title: "Ver disponibilidad" },
          ADVISOR_BUTTON
        ]
      );
      return true;
    }
    if (matchingDate.closed) {
      await retryOrHandOff(
        client,
        conversation,
        "awaiting_day_shift",
        { ...context, shift },
        closedDayMessage(),
        [
          { id: "book_show_availability", title: "Ver disponibilidad" },
          ADVISOR_BUTTON
        ]
      );
      return true;
    }
    if (!shift) {
      await updateAutomation(client, conversation.id, "awaiting_day_shift", { ...context, date, invalidAttempts: 0 });
      await sendButtons(client, conversation, `¿Prefieres horario de mañana o tarde para el ${formatWhatsAppDate(date)}?`, [
        { id: "book_shift_morning", title: "🌤️ Mañana" },
        { id: "book_shift_afternoon", title: "🌙 Tarde" },
        ADVISOR_BUTTON
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
      await showAvailableSlots(client, conversation, context, Number(context.slotOffset ?? 0) + 7);
      return true;
    }
    if (!context.branchCode || !context.date || !context.shift) {
      await handOffToTeam(client, conversation);
      return true;
    }
    const selectedTime = timeFromReply(message.body, selectionId, context.shift);
    const selectedMinutes = selectedTime
      ? Number(selectedTime.slice(0, 2)) * 60 + Number(selectedTime.slice(3, 5))
      : 0;
    const requestedShift: Shift = selectionId.startsWith("book_time_")
      ? context.shift
      : selectedMinutes >= 13 * 60 ? "afternoon" : "morning";
    const slots = await getAvailableSlots(client, context.branchCode, context.date, requestedShift);
    if (!selectedTime || !slots.some((slot) => slot.time === selectedTime)) {
      if (selectedTime && selectionId.startsWith("book_time_")) {
        await sendOccupiedSlot(client, conversation, context);
      } else {
        await retryOrHandOff(
          client,
          conversation,
          "awaiting_time",
          { ...context, shift: requestedShift },
          `El horario que solicitaste no está disponible para el *${formatWhatsAppDate(context.date)}*.\n\n¿Te gustaría revisar otros horarios disponibles para ese mismo día o prefieres elegir otra fecha? 💚`,
          [
            { id: "book_show_other_times", title: "Ver otros horarios" },
            { id: "book_choose_other_day", title: "Elegir otro día" },
            ADVISOR_BUTTON
          ]
        );
      }
      return true;
    }
    await updateAutomation(client, conversation.id, "awaiting_name", {
      ...context,
      shift: requestedShift,
      time: selectedTime,
      invalidAttempts: 0
    });
    await sendButtons(
      client,
      conversation,
      "Para registrar la cita necesitamos el *nombre y apellido de la persona que asistirá*.\n\n¿Me los puedes compartir, por favor? 💚\n\nSi tienes alguna duda o necesitas ayuda, puedes hablar con una asesora.",
      [ADVISOR_BUTTON]
    );
    return true;
  }

  const fullName = cleanFullName(message.body);
  if (!isFullName(fullName)) {
    await retryOrHandOff(
      client,
      conversation,
      "awaiting_name",
      context,
      "Para registrar la cita necesitamos el *nombre y apellido de la persona que asistirá*.\n\n¿Me los puedes compartir, por favor? 💚\n\nSi tienes alguna duda o necesitas ayuda, puedes hablar con una asesora.",
      [ADVISOR_BUTTON]
    );
    return true;
  }

  try {
    const result = await createAutomaticAppointment(client, conversation, context, fullName);
    if (result.status === "occupied") {
      await sendOccupiedSlot(client, conversation, context);
    }
  } catch (error) {
    throw error;
  }
  return true;
}

export async function handleWhatsAppBookingAutomation(message: IncomingBookingMessage) {
  try {
    return await processWhatsAppBookingAutomation(message);
  } catch (error) {
    console.error("No se pudo completar el agendado automático", error);
    if (!isCloudWhatsAppOutboundEnabled() || !canAutomate(message.whatsapp)) throw error;

    const client = createSupabaseServiceRoleClient();
    const { data } = await client
      .from("whatsapp_conversations")
      .select("id, whatsapp, contact_name, workflow_status, branch_interest, automation_step, automation_context")
      .eq("id", message.conversationId)
      .maybeSingle();
    const conversation = data as ConversationRow | null;
    if (!conversation || conversation.workflow_status === "no_contactar") throw error;

    await sendUnexpectedError(client, conversation);
    return true;
  }
}
