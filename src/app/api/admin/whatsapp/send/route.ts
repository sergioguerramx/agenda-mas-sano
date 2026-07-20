import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAdminEmail } from "@/lib/admin-auth";
import { isCloudWhatsAppOutboundEnabled } from "@/lib/meta-whatsapp";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!await getAuthenticatedAdminEmail(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  if (!isCloudWhatsAppOutboundEnabled()) {
    return NextResponse.json({
      error: "Los mensajes están pausados hasta resolver el nombre de Más Sano en Meta."
    }, { status: 423 });
  }

  const payload = await request.json().catch(() => ({})) as { conversationId?: string; body?: string };
  const conversationId = payload.conversationId?.trim() ?? "";
  const body = payload.body?.trim() ?? "";

  if (!conversationId || !body || body.length > 4096) {
    return NextResponse.json({ error: "Revisa el mensaje antes de enviarlo." }, { status: 400 });
  }

  const accessToken = (process.env.META_WHATSAPP_ACCESS_TOKEN ?? "").trim();
  const phoneNumberId = (process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? "").trim();
  const apiVersion = (process.env.META_GRAPH_API_VERSION ?? "v25.0").trim();
  if (!accessToken || !phoneNumberId) {
    return NextResponse.json({ error: "El número de campañas todavía no está completamente conectado." }, { status: 503 });
  }

  const client = createSupabaseServiceRoleClient();
  const { data: conversation } = await client
    .from("whatsapp_conversations")
    .select("id, whatsapp, last_inbound_at")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conversation) {
    return NextResponse.json({ error: "No se encontró la conversación." }, { status: 404 });
  }

  const graphResponse = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: conversation.whatsapp.replace(/\D/g, ""),
      type: "text",
      text: { body, preview_url: false }
    })
  });

  const graphData = await graphResponse.json().catch(() => ({})) as {
    messages?: Array<{ id?: string }>;
    error?: { message?: string; error_user_msg?: string };
  };

  if (!graphResponse.ok || !graphData.messages?.[0]?.id) {
    const metaMessage = graphData.error?.error_user_msg ?? graphData.error?.message ?? "Meta rechazó el envío.";
    const friendlyMessage = /24|window|outside|re-engage/i.test(metaMessage)
      ? "La última respuesta fue hace más de 24 horas. Para iniciar de nuevo se necesita una plantilla aprobada."
      : "No se pudo enviar el mensaje. Revisa la conexión del número de campañas.";
    return NextResponse.json({ error: friendlyMessage }, { status: 502 });
  }

  const sentAt = new Date().toISOString();
  const metaMessageId = graphData.messages[0].id;
  const { data: savedMessage, error: saveError } = await client
    .from("whatsapp_messages")
    .insert({
      conversation_id: conversation.id,
      meta_message_id: metaMessageId,
      direction: 2,
      message_type: "text",
      body,
      delivery_status: 1,
      sent_at: sentAt
    })
    .select("id, meta_message_id, direction, message_type, body, delivery_status, sent_at, delivered_at, read_at")
    .single();

  if (saveError) {
    return NextResponse.json({ error: "El mensaje salió, pero no pudo guardarse en la bandeja." }, { status: 500 });
  }

  await client.from("whatsapp_conversations").update({
    last_message_at: sentAt,
    last_message_preview: body.slice(0, 180),
    last_message_direction: 2,
    updated_at: sentAt
  }).eq("id", conversation.id);

  return NextResponse.json({ message: savedMessage });
}
