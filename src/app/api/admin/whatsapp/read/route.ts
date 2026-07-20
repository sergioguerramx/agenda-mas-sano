import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedMessagingEmail } from "@/lib/admin-auth";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!await getAuthenticatedMessagingEmail(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const payload = await request.json().catch(() => ({})) as { conversationId?: string };
  const conversationId = payload.conversationId?.trim() ?? "";
  if (!conversationId) {
    return NextResponse.json({ error: "Falta elegir la conversación." }, { status: 400 });
  }

  const client = createSupabaseServiceRoleClient();
  const { data, error } = await client
    .from("whatsapp_conversations")
    .update({ unread_count: 0, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "No se encontró la conversación." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
