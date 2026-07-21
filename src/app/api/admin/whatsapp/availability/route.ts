import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedMessagingEmail } from "@/lib/admin-auth";
import { buildSlotsForDate } from "@/lib/schedule";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";
import { getGoogleCalendarSlotCounts } from "@/services/google-calendar";

export const runtime = "nodejs";

const BRANCH_CODES = new Set(["SN", "MTY_SUR"]);
const MTY_SUR_OPENING_DATE = "2026-08-03";

export async function GET(request: NextRequest) {
  if (!await getAuthenticatedMessagingEmail(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const date = request.nextUrl.searchParams.get("date") ?? "";
  const branchCode = request.nextUrl.searchParams.get("branch") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !BRANCH_CODES.has(branchCode)) {
    return NextResponse.json({ error: "Elige una sucursal y fecha válidas." }, { status: 400 });
  }
  if (branchCode === "MTY_SUR" && date < MTY_SUR_OPENING_DATE) {
    return NextResponse.json({ error: "Monterrey Sur abre agenda a partir del 3 de agosto." }, { status: 409 });
  }

  const client = createSupabaseServiceRoleClient();
  const { data: branch, error: branchError } = await client
    .from("branches")
    .select("code, name, calendar_email")
    .eq("code", branchCode)
    .eq("is_active", true)
    .maybeSingle();

  if (branchError || !branch?.calendar_email) {
    return NextResponse.json({ error: "Esta sucursal todavía no tiene agenda conectada." }, { status: 409 });
  }

  try {
    const baseSlots = buildSlotsForDate(date, new Date(), {}, branchCode as "SN" | "MTY_SUR");
    const counts = await getGoogleCalendarSlotCounts(
      date,
      baseSlots.map((slot) => slot.time),
      branch.calendar_email
    );
    const countByTime = new Map(counts.map((item) => [item.time, item.count]));
    const slots = buildSlotsForDate(
      date,
      new Date(),
      Object.fromEntries(counts.map((item) => [item.time, item.count])),
      branchCode as "SN" | "MTY_SUR"
    );

    return NextResponse.json({
      branch: { code: branch.code, name: branch.name },
      slots: slots.map((slot) => ({
        ...slot,
        occupied: countByTime.get(slot.time) ?? 0
      }))
    });
  } catch (error) {
    console.error("Admin branch availability error", { branchCode, date, error });
    return NextResponse.json(
      { error: `No pudimos leer la agenda de ${branch.name}. Revisa que esté compartida con el sistema.` },
      { status: 502 }
    );
  }
}
