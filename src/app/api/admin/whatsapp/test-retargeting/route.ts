import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedMessagingEmail } from "@/lib/admin-auth";
import { sendCloudWhatsAppTemplate } from "@/lib/meta-whatsapp";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const FALLBACK_TEST_NUMBERS = new Set(["+528114740974"]);

function getAllowedTestNumbers() {
  const configured = (process.env.WHATSAPP_RETARGETING_TEST_NUMBERS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.length > 0 ? new Set(configured) : FALLBACK_TEST_NUMBERS;
}

export async function POST(request: NextRequest) {
  const operatorEmail = await getAuthenticatedMessagingEmail(request);
  if (!operatorEmail) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const payload = await request.json().catch(() => ({})) as {
    conversationId?: string;
    branchCode?: "SN" | "MTY_SUR";
  };
  const conversationId = payload.conversationId?.trim() ?? "";
  const branchCode = payload.branchCode ?? "MTY_SUR";
  if (!conversationId || !["SN", "MTY_SUR"].includes(branchCode)) {
    return NextResponse.json({ error: "La prueba solicitada no es válida." }, { status: 400 });
  }

  const client = createSupabaseServiceRoleClient();
  const { data: conversation } = await client
    .from("whatsapp_conversations")
    .select("id, whatsapp")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conversation || !getAllowedTestNumbers().has(conversation.whatsapp)) {
    return NextResponse.json({ error: "Este número no está autorizado para pruebas." }, { status: 403 });
  }

  const templateName = branchCode === "MTY_SUR"
    ? "mas_sano_reactivacion_mty_sur_449_v2"
    : "mas_sano_reactivacion_san_nicolas_449_v2";

  try {
    const metaMessageId = await sendCloudWhatsAppTemplate(conversation.whatsapp, templateName, "es", []);
    const sentAt = new Date().toISOString();
    const branchName = branchCode === "MTY_SUR" ? "Monterrey Poniente" : "San Nicolás";
    const body = `Plantilla de prueba: reactivación ${branchName} ($449)`;

    const { error: messageError } = await client.from("whatsapp_messages").insert({
      conversation_id: conversation.id,
      meta_message_id: metaMessageId,
      direction: 2,
      message_type: "template",
      body,
      delivery_status: 1,
      sent_at: sentAt,
      sent_by_email: "prueba_retargeting"
    });
    if (messageError) {
      return NextResponse.json({ error: "El mensaje salió, pero no pudo guardarse en el panel." }, { status: 500 });
    }

    await client.from("whatsapp_conversations").update({
      branch_interest: branchCode,
      last_message_at: sentAt,
      last_message_preview: body,
      last_message_direction: 2,
      updated_at: sentAt
    }).eq("id", conversation.id);

    return NextResponse.json({ ok: true, templateName });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No se pudo enviar la prueba de reactivación."
    }, { status: 409 });
  }
}
