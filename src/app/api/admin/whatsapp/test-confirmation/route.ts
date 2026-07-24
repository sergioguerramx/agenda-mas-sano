import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedMessagingEmail } from "@/lib/admin-auth";
import {
  sendTestAppointmentConfirmation,
  type TestConfirmationStage
} from "@/services/appointment-confirmations";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!await getAuthenticatedMessagingEmail(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const payload = await request.json().catch(() => ({})) as {
    conversationId?: string;
    stage?: TestConfirmationStage;
  };
  const conversationId = payload.conversationId?.trim() ?? "";
  const stage = payload.stage ?? "first";
  if (!conversationId) {
    return NextResponse.json({ error: "No se encontró la conversación de prueba." }, { status: 400 });
  }
  if (!["first", "second", "released"].includes(stage)) {
    return NextResponse.json({ error: "La etapa de prueba no es válida." }, { status: 400 });
  }

  try {
    const result = await sendTestAppointmentConfirmation(conversationId, stage);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No se pudo enviar la confirmación de prueba."
    }, { status: 409 });
  }
}
