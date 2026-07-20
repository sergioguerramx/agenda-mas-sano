import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";
import {
  getIncomingMessageBody,
  normalizeCloudWhatsApp,
  unixSecondsToIso,
  verifyMetaSignature
} from "@/lib/meta-whatsapp";
import { handleAppointmentConfirmationReply } from "@/services/appointment-confirmations";

export const runtime = "nodejs";

type MetaMessage = Record<string, unknown> & {
  context?: { id?: string };
  from?: string;
  id?: string;
  referral?: {
    ctwa_clid?: string;
    source_type?: string;
  };
  timestamp?: string;
  type?: string;
};

type MetaStatus = {
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: Array<{ title?: string; message?: string }>;
};

type MetaValue = {
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
  messages?: MetaMessage[];
  statuses?: MetaStatus[];
};

const META_AD_WELCOME_MESSAGE = [
  "¡Hola! 👋 Gracias por comunicarte con Más Sano.",
  "Nuestra consulta integral tiene un costo de $399.",
  "¿En qué sucursal deseas atenderte: San Nicolás o Monterrey Sur?"
].join("\n\n");

function getValues(payload: unknown) {
  const body = payload as {
    entry?: Array<{ changes?: Array<{ value?: MetaValue }> }>;
  };

  return (body.entry ?? [])
    .flatMap((entry) => entry.changes ?? [])
    .map((change) => change.value)
    .filter((value): value is MetaValue => Boolean(value));
}

async function saveIncomingMessage(value: MetaValue, message: MetaMessage) {
  if (!message.id || !message.from) return null;

  const whatsapp = normalizeCloudWhatsApp(message.from);
  if (!whatsapp) return null;

  const client = createSupabaseServiceRoleClient();
  const sentAt = unixSecondsToIso(message.timestamp);
  const body = getIncomingMessageBody(message);
  const contactName = value.contacts?.[0]?.profile?.name?.trim() || null;

  const { data: existing } = await client
    .from("whatsapp_messages")
    .select("id, conversation_id")
    .eq("meta_message_id", message.id)
    .maybeSingle();

  if (existing) return { conversationId: existing.conversation_id, whatsapp };

  const { data: conversation, error: conversationError } = await client
    .from("whatsapp_conversations")
    .upsert({
      whatsapp,
      contact_name: contactName,
      status: 1,
      last_inbound_at: sentAt,
      last_message_at: sentAt,
      last_message_preview: body.slice(0, 180),
      last_message_direction: 1,
      updated_at: new Date().toISOString()
    }, { onConflict: "whatsapp" })
    .select("id, unread_count")
    .single();

  if (conversationError || !conversation) throw conversationError ?? new Error("No se creó la conversación");

  const { error: messageError } = await client.from("whatsapp_messages").insert({
    conversation_id: conversation.id,
    meta_message_id: message.id,
    direction: 1,
    message_type: message.type ?? "unknown",
    body,
    delivery_status: 2,
    sent_at: sentAt,
    delivered_at: sentAt
  });

  if (messageError) throw messageError;

  await client
    .from("whatsapp_conversations")
    .update({ unread_count: Number(conversation.unread_count ?? 0) + 1 })
    .eq("id", conversation.id);

  return { conversationId: conversation.id, whatsapp };
}

function comesFromClickToWhatsAppAd(message: MetaMessage) {
  const sourceType = message.referral?.source_type?.trim().toLowerCase();
  return Boolean(message.referral?.ctwa_clid?.trim() || sourceType === "ad");
}

async function sendAutomaticMetaAdWelcome(
  message: MetaMessage,
  saved: { conversationId: string; whatsapp: string }
) {
  if (!message.id || !comesFromClickToWhatsAppAd(message)) return;

  const client = createSupabaseServiceRoleClient();
  const { count, error: countError } = await client
    .from("whatsapp_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", saved.conversationId);

  if (countError) throw countError;
  if (count !== 1) return;

  const sentAt = new Date().toISOString();
  const pendingMessageId = `auto-welcome:${message.id}`;
  const { error: claimError } = await client.from("whatsapp_messages").insert({
    conversation_id: saved.conversationId,
    meta_message_id: pendingMessageId,
    direction: 2,
    message_type: "text",
    body: META_AD_WELCOME_MESSAGE,
    delivery_status: 0,
    sent_at: sentAt
  });

  if (claimError?.code === "23505") return;
  if (claimError) throw claimError;

  try {
    const accessToken = (process.env.META_WHATSAPP_ACCESS_TOKEN ?? "").trim();
    const phoneNumberId = (process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? "").trim();
    const apiVersion = (process.env.META_GRAPH_API_VERSION ?? "v25.0").trim();
    if (!accessToken || !phoneNumberId) throw new Error("Falta completar la conexión de WhatsApp");

    const graphResponse = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: saved.whatsapp.replace(/\D/g, ""),
        type: "text",
        text: { body: META_AD_WELCOME_MESSAGE, preview_url: false }
      })
    });

    const graphData = await graphResponse.json().catch(() => ({})) as {
      messages?: Array<{ id?: string }>;
      error?: { message?: string; error_user_msg?: string };
    };
    const metaMessageId = graphData.messages?.[0]?.id;

    if (!graphResponse.ok || !metaMessageId) {
      throw new Error(graphData.error?.error_user_msg ?? graphData.error?.message ?? "Meta rechazó la bienvenida");
    }

    const { error: updateMessageError } = await client
      .from("whatsapp_messages")
      .update({ meta_message_id: metaMessageId, delivery_status: 1 })
      .eq("meta_message_id", pendingMessageId);

    if (updateMessageError) throw updateMessageError;

    await client.from("whatsapp_conversations").update({
      last_message_at: sentAt,
      last_message_preview: META_AD_WELCOME_MESSAGE.slice(0, 180),
      last_message_direction: 2,
      updated_at: sentAt
    }).eq("id", saved.conversationId);
  } catch (error) {
    await client.from("whatsapp_messages").delete().eq("meta_message_id", pendingMessageId);
    throw error;
  }
}

async function saveDeliveryStatus(status: MetaStatus) {
  if (!status.id || !status.status) return;

  const client = createSupabaseServiceRoleClient();
  const timestamp = unixSecondsToIso(status.timestamp);
  const statusValues: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: -1 };
  const deliveryStatus = statusValues[status.status];
  if (deliveryStatus === undefined) return;

  const update: Record<string, string | number | null> = { delivery_status: deliveryStatus };
  if (status.status === "delivered") update.delivered_at = timestamp;
  if (status.status === "read") update.read_at = timestamp;
  if (status.status === "failed") {
    update.error_message = status.errors?.[0]?.title ?? status.errors?.[0]?.message ?? "No se pudo entregar";
  }

  await client.from("whatsapp_messages").update(update).eq("meta_message_id", status.id);
}

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token && token === process.env.META_WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }

  return new NextResponse("No autorizado", { status: 403 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  const appSecret = (process.env.META_APP_SECRET ?? "").trim();

  if (!verifyMetaSignature(rawBody, signature, appSecret)) {
    return new NextResponse("Firma inválida", { status: 401 });
  }

  try {
    const payload = JSON.parse(rawBody) as unknown;
    for (const value of getValues(payload)) {
      for (const message of value.messages ?? []) {
        const saved = await saveIncomingMessage(value, message);
        if (saved) {
          try {
            await handleAppointmentConfirmationReply(
              saved.whatsapp,
              getIncomingMessageBody(message),
              message.context?.id
            );
          } catch (confirmationError) {
            console.error("No se pudo procesar la respuesta de confirmación", confirmationError);
          }
          try {
            await sendAutomaticMetaAdWelcome(message, saved);
          } catch (welcomeError) {
            console.error("No se pudo enviar la bienvenida automática de Meta Ads", welcomeError);
          }
        }
      }
      for (const status of value.statuses ?? []) await saveDeliveryStatus(status);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("No se pudo procesar el mensaje de WhatsApp", error);
    return NextResponse.json({ received: false }, { status: 500 });
  }
}
