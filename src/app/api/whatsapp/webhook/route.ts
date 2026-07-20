import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";
import {
  getIncomingMessageBody,
  getIncomingMessageSelectionId,
  normalizeCloudWhatsApp,
  unixSecondsToIso,
  verifyMetaSignature
} from "@/lib/meta-whatsapp";
import { handleAppointmentConfirmationReply } from "@/services/appointment-confirmations";
import { handleWhatsAppBookingAutomation } from "@/services/whatsapp-booking-automation";

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

  if (existing) return { conversationId: existing.conversation_id, whatsapp, isNew: false };

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

  return { conversationId: conversation.id, whatsapp, isNew: true };
}

function comesFromClickToWhatsAppAd(message: MetaMessage) {
  const sourceType = message.referral?.source_type?.trim().toLowerCase();
  return Boolean(message.referral?.ctwa_clid?.trim() || sourceType === "ad");
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
        if (saved?.isNew) {
          let confirmationHandled = false;
          try {
            confirmationHandled = await handleAppointmentConfirmationReply(
              saved.whatsapp,
              getIncomingMessageBody(message),
              message.context?.id
            );
          } catch (confirmationError) {
            console.error("No se pudo procesar la respuesta de confirmación", confirmationError);
          }
          if (!confirmationHandled) {
            try {
              await handleWhatsAppBookingAutomation({
                conversationId: saved.conversationId,
                whatsapp: saved.whatsapp,
                body: getIncomingMessageBody(message),
                selectionId: getIncomingMessageSelectionId(message),
                fromAd: comesFromClickToWhatsAppAd(message)
              });
            } catch (automationError) {
              console.error("No se pudo procesar el agendado automático", automationError);
            }
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
