import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedMessagingEmail } from "@/lib/admin-auth";
import { sendTestAppointmentConfirmation } from "@/services/appointment-confirmations";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!await getAuthenticatedMessagingEmail(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const payload = await request.json().catch(() => ({})) as { conversationId?: string };
  const conversationId = payload.conversationId?.trim() ?? "";
  if (!conversationId) {
    return NextResponse.json({ error: "No se encontró la conversación de prueba." }, { status: 400 });
  }

  try {
    const result = await sendTestAppointmentConfirmation(conversationId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No se pudo enviar la confirmación de prueba."
    }, { status: 409 });
  }
}
