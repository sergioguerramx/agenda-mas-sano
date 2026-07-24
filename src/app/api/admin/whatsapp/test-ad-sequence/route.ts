import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAdminEmail } from "@/lib/admin-auth";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";
import { sendAdLeadFollowUpTestStage } from "@/services/whatsapp-ad-followups";

export const runtime = "nodejs";
export const maxDuration = 60;

const TEST_WHATSAPP = "+528114740974";

export async function POST(request: NextRequest) {
  const adminEmail = await getAuthenticatedAdminEmail(request);
  if (!adminEmail) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const payload = await request.json().catch(() => ({})) as {
    conversationId?: string;
    stage?: number;
  };
  const conversationId = payload.conversationId?.trim() ?? "";
  const stage = payload.stage;
  if (!conversationId || stage === undefined || ![0, 1, 2, 3].includes(stage)) {
    return NextResponse.json({ error: "La prueba solicitada no es válida." }, { status: 400 });
  }

  const client = createSupabaseServiceRoleClient();
  const { data: conversation } = await client
    .from("whatsapp_conversations")
    .select("id, whatsapp")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation || conversation.whatsapp !== TEST_WHATSAPP) {
    return NextResponse.json({ error: "Este número no está autorizado para la prueba." }, { status: 403 });
  }

  try {
    await sendAdLeadFollowUpTestStage(client, conversation, stage as 0 | 1 | 2 | 3);
    await client.from("whatsapp_conversations").update({
      follow_up_at: null,
      updated_by_email: adminEmail,
      updated_at: new Date().toISOString()
    }).eq("id", conversation.id);
    return NextResponse.json({ ok: true, stage });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No se pudo enviar la prueba."
    }, { status: 409 });
  }
}
