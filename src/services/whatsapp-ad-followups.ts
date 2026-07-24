import type { SupabaseClient } from "@supabase/supabase-js";
import { getMasSanoAppointmentOffer } from "@/lib/mas-sano-pricing";
import { sendCloudWhatsAppReplyButtons } from "@/lib/meta-whatsapp";

export type AdFollowUpStage = 0 | 1 | 2 | 3 | 4;

type AdFollowUpContext = Record<string, unknown> & {
  adFollowUpStage?: AdFollowUpStage;
  adFollowUpStartedAt?: string;
  adFollowUpExpiresAt?: string;
};

type ConversationRow = {
  id: string;
  whatsapp: string;
  workflow_status: string;
  last_inbound_at: string | null;
  follow_up_at: string | null;
  automation_context: AdFollowUpContext | null;
};

const TIME_ZONE = "America/Monterrey";
const AUTOMATION_SENDER = "automatizacion";
const OPENING_DATE = "2026-08-03";
const FOLLOW_UP_HOURS: Record<1 | 2 | 3, number> = {
  1: 4,
  2: 24,
  3: 56
};

function monterreyClock(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    hour: Number(values.hour ?? 0),
    minute: Number(values.minute ?? 0)
  };
}

function isAllowedSendTime(date: Date) {
  const { hour } = monterreyClock(date);
  return hour >= 8 && hour < 20;
}

function moveIntoAllowedSendTime(date: Date) {
  const adjusted = new Date(date);
  for (let minute = 0; minute <= 24 * 60; minute += 1) {
    if (isAllowedSendTime(adjusted)) return adjusted;
    adjusted.setUTCMinutes(adjusted.getUTCMinutes() + 1);
  }
  return adjusted;
}

function followUpDue(startedAt: string, stage: 1 | 2 | 3) {
  const target = new Date(new Date(startedAt).getTime() + FOLLOW_UP_HOURS[stage] * 60 * 60 * 1000);
  return moveIntoAllowedSendTime(target);
}

function serviceHoursMessage() {
  return [
    "*Horarios de atención:*",
    "*Lunes, martes, jueves y viernes:*\n9:20 a.m. a 1:20 p.m. / 3:00 p.m. a 7:00 p.m.",
    "*Sábado:*\n10:00 a.m. a 3:00 p.m.",
    "Miércoles y domingo: *cerrado*"
  ].join("\n\n");
}

function initialMessage() {
  const { price } = getMasSanoAppointmentOffer(OPENING_DATE);
  return [
    "¡Hola! 💚 Gracias por escribir a *Más Sano Nutrición Holística*.",
    `Tenemos activa la *PROMO ÁMATE*: tu Sesión Integral tiene un costo de *$${price}*, antes $850.`,
    "Es ideal si deseas bajar tallas, sentirte más ligera, mejorar tus hábitos y comenzar con un plan realista, sin dietas imposibles.",
    [
      "Tu sesión incluye:",
      "✅ Sesión con nutrióloga",
      "✅ Plan de alimentación personalizado",
      "✅ Auriculoterapia metabólica",
      "✅ Seguimiento y asesoría por WhatsApp"
    ].join("\n"),
    "📌 Las sesiones de seguimiento son quincenales. Si mantienes continuidad cada 15 días, conservas el precio vigente de tu proceso.",
    serviceHoursMessage(),
    "¿En cuál sucursal te gustaría agendar?"
  ].join("\n\n");
}

function messageForStage(stage: AdFollowUpStage) {
  if (stage === 0) {
    return {
      body: initialMessage(),
      buttons: [
        { id: "book_branch_sn", title: "📍 San Nicolás" },
        { id: "book_branch_mty_sur", title: "📍 Mty. Poniente" },
        { id: "book_question", title: "💬 Tengo una duda" }
      ]
    };
  }
  if (stage === 1) {
    return {
      body: [
        "Hola de nuevo 💚",
        "Sólo queremos asegurarnos de que hayas recibido la información.",
        "En Más Sano buscamos acompañarte de una manera cercana, con un plan realista y adaptado a tu estilo de vida.",
        "Si deseas, podemos mostrarte los horarios disponibles en la sucursal que te quede mejor."
      ].join("\n\n"),
      buttons: [
        { id: "book_branch_sn", title: "📍 San Nicolás" },
        { id: "book_branch_mty_sur", title: "📍 Mty. Poniente" },
        { id: "book_question", title: "Hablar con asesora" }
      ]
    };
  }
  if (stage === 2) {
    return {
      body: [
        "¡Hola! 💚",
        "Sabemos que a veces dar el primer paso requiere pensarlo un poco.",
        "Si tienes alguna duda sobre la Sesión Integral, las ubicaciones o cómo funciona el acompañamiento, con gusto podemos ayudarte.",
        "¿Te gustaría revisar los horarios disponibles?"
      ].join("\n\n"),
      buttons: [
        { id: "book_show_availability", title: "📅 Ver horarios" },
        { id: "book_question", title: "Resolver una duda" },
        { id: "book_opt_out", title: "No recibir mensajes" }
      ]
    };
  }
  return {
    body: [
      "¡Hola! 💚 Antes de cerrar nuestro seguimiento, queremos recordarte que seguimos disponibles para ayudarte a comenzar cuando te sientas lista.",
      "Podemos revisar contigo la sucursal y el horario que mejor se adapten a tus actividades.",
      "Si deseas conocernos un poco más:\nhttps://massanonh.com/",
      "Y si por ahora no es el momento, no pasa nada. Más adelante será un gusto recibirte 💚"
    ].join("\n\n"),
    buttons: [
      { id: "book_show_availability", title: "📅 Quiero agendar" },
      { id: "book_question", title: "Hablar con asesora" },
      { id: "book_opt_out", title: "No recibir mensajes" }
    ]
  };
}

async function saveOutbound(
  client: SupabaseClient,
  conversation: Pick<ConversationRow, "id" | "whatsapp">,
  metaMessageId: string,
  body: string
) {
  const sentAt = new Date().toISOString();
  const { error } = await client.from("whatsapp_messages").insert({
    conversation_id: conversation.id,
    meta_message_id: metaMessageId,
    direction: 2,
    message_type: "interactive",
    body,
    delivery_status: 1,
    sent_at: sentAt,
    sent_by_email: AUTOMATION_SENDER
  });
  if (error) console.error("No se guardó el seguimiento automático", error);

  await client.from("whatsapp_conversations").update({
    last_message_at: sentAt,
    last_message_preview: body.slice(0, 180),
    last_message_direction: 2,
    updated_at: sentAt
  }).eq("id", conversation.id);
}

async function sendStage(
  client: SupabaseClient,
  conversation: Pick<ConversationRow, "id" | "whatsapp">,
  stage: AdFollowUpStage
) {
  const message = messageForStage(stage);
  const metaMessageId = await sendCloudWhatsAppReplyButtons(
    conversation.whatsapp,
    message.body,
    message.buttons
  );
  await saveOutbound(client, conversation, metaMessageId, message.body);
}

export async function sendAdLeadFollowUpTestStage(
  client: SupabaseClient,
  conversation: Pick<ConversationRow, "id" | "whatsapp">,
  stage: 0 | 1 | 2 | 3
) {
  await sendStage(client, conversation, stage);
}

function contextForStage(startedAt: string, stage: AdFollowUpStage): AdFollowUpContext {
  return {
    adFollowUpStage: stage,
    adFollowUpStartedAt: startedAt,
    adFollowUpExpiresAt: new Date(new Date(startedAt).getTime() + 72 * 60 * 60 * 1000).toISOString()
  };
}

export async function startAdLeadFollowUpSequence(
  client: SupabaseClient,
  conversation: Pick<ConversationRow, "id" | "whatsapp">,
  receivedAt = new Date()
) {
  const startedAt = receivedAt.toISOString();
  if (!isAllowedSendTime(receivedAt)) {
    await client.from("whatsapp_conversations").update({
      automation_context: contextForStage(startedAt, 0),
      follow_up_at: moveIntoAllowedSendTime(receivedAt).toISOString(),
      updated_at: new Date().toISOString()
    }).eq("id", conversation.id);
    return { sent: false, queued: true };
  }

  try {
    await sendStage(client, conversation, 0);
    await client.from("whatsapp_conversations").update({
      automation_context: contextForStage(startedAt, 1),
      follow_up_at: followUpDue(startedAt, 1).toISOString(),
      updated_at: new Date().toISOString()
    }).eq("id", conversation.id);
    return { sent: true, queued: true };
  } catch (error) {
    const retryAt = moveIntoAllowedSendTime(new Date(receivedAt.getTime() + 15 * 60 * 1000));
    await client.from("whatsapp_conversations").update({
      automation_context: contextForStage(startedAt, 0),
      follow_up_at: retryAt.toISOString(),
      updated_at: new Date().toISOString()
    }).eq("id", conversation.id);
    throw error;
  }
}

export async function runAdLeadFollowUpCycle(now = new Date()) {
  const { createSupabaseServiceRoleClient } = await import("@/lib/supabase");
  const client = createSupabaseServiceRoleClient();
  const { data, error } = await client
    .from("whatsapp_conversations")
    .select("id, whatsapp, workflow_status, last_inbound_at, follow_up_at, automation_context")
    .not("follow_up_at", "is", null)
    .lte("follow_up_at", now.toISOString())
    .order("follow_up_at", { ascending: true })
    .limit(50);
  if (error) throw error;

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of data ?? []) {
    const conversation = item as ConversationRow;
    const context = conversation.automation_context ?? {};
    const stage = context.adFollowUpStage;
    const startedAt = context.adFollowUpStartedAt;
    const expiresAt = context.adFollowUpExpiresAt;
    if (stage === undefined || !startedAt || !expiresAt || stage >= 4) {
      skipped += 1;
      continue;
    }

    const userRepliedAfterStart = conversation.last_inbound_at
      ? new Date(conversation.last_inbound_at).getTime() > new Date(startedAt).getTime() + 1000
      : false;
    const cannotContinue = !["nuevo", "interesado"].includes(conversation.workflow_status)
      || userRepliedAfterStart
      || now.getTime() >= new Date(expiresAt).getTime();
    if (cannotContinue) {
      await client.from("whatsapp_conversations").update({ follow_up_at: null }).eq("id", conversation.id);
      skipped += 1;
      continue;
    }

    if (!isAllowedSendTime(now)) {
      const nextAllowed = moveIntoAllowedSendTime(now);
      if (nextAllowed.getTime() < new Date(expiresAt).getTime()) {
        await client.from("whatsapp_conversations").update({ follow_up_at: nextAllowed.toISOString() }).eq("id", conversation.id);
      } else {
        await client.from("whatsapp_conversations").update({ follow_up_at: null }).eq("id", conversation.id);
      }
      skipped += 1;
      continue;
    }

    const claimedDue = conversation.follow_up_at;
    const { data: claimed } = await client
      .from("whatsapp_conversations")
      .update({ follow_up_at: null })
      .eq("id", conversation.id)
      .eq("follow_up_at", claimedDue)
      .select("id")
      .maybeSingle();
    if (!claimed) {
      skipped += 1;
      continue;
    }

    try {
      await sendStage(client, conversation, stage);
      const nextStage = (stage + 1) as AdFollowUpStage;
      const nextDue = nextStage <= 3
        ? followUpDue(startedAt, nextStage as 1 | 2 | 3)
        : null;
      await client.from("whatsapp_conversations").update({
        automation_context: contextForStage(startedAt, nextStage),
        follow_up_at: nextDue && nextDue.getTime() < new Date(expiresAt).getTime()
          ? nextDue.toISOString()
          : null,
        updated_at: new Date().toISOString()
      }).eq("id", conversation.id);
      sent += 1;
    } catch (sendError) {
      console.error("No se pudo enviar el seguimiento de anuncio", {
        conversationId: conversation.id,
        stage,
        sendError
      });
      const retryAt = moveIntoAllowedSendTime(new Date(now.getTime() + 15 * 60 * 1000));
      await client.from("whatsapp_conversations").update({
        follow_up_at: retryAt.getTime() < new Date(expiresAt).getTime() ? retryAt.toISOString() : null,
        updated_at: new Date().toISOString()
      }).eq("id", conversation.id);
      failed += 1;
    }
  }

  return { reviewed: data?.length ?? 0, sent, skipped, failed };
}
