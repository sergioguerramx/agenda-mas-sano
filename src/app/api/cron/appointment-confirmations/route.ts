import { NextRequest, NextResponse } from "next/server";
import { runAppointmentConfirmationCycle } from "@/services/appointment-confirmations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const cronSecret = (process.env.CRON_SECRET ?? "").trim();
  const authorization = request.headers.get("authorization") ?? "";

  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const result = await runAppointmentConfirmationCycle();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Appointment confirmation cron error", error);
    return NextResponse.json({ ok: false, error: "No se completó el ciclo de confirmaciones." }, { status: 500 });
  }
}

