import { NextRequest, NextResponse } from "next/server";
import { runAppointmentConfirmationCycle } from "@/services/appointment-confirmations";
import { runAdLeadFollowUpCycle } from "@/services/whatsapp-ad-followups";

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
    const [confirmations, adFollowUps] = await Promise.allSettled([
      runAppointmentConfirmationCycle(),
      runAdLeadFollowUpCycle()
    ]);
    if (confirmations.status === "rejected" && adFollowUps.status === "rejected") {
      throw confirmations.reason;
    }
    if (confirmations.status === "rejected") {
      console.error("Appointment confirmation cycle error", confirmations.reason);
    }
    if (adFollowUps.status === "rejected") {
      console.error("Ad lead follow-up cycle error", adFollowUps.reason);
    }
    return NextResponse.json({
      ok: true,
      confirmations: confirmations.status === "fulfilled" ? confirmations.value : null,
      adFollowUps: adFollowUps.status === "fulfilled" ? adFollowUps.value : null
    });
  } catch (error) {
    console.error("Appointment confirmation cron error", error);
    return NextResponse.json({ ok: false, error: "No se completó el ciclo de confirmaciones." }, { status: 500 });
  }
}
