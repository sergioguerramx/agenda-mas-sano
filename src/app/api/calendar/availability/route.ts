import { NextResponse } from "next/server";
import { BRANCH_OPENING_DATES, type ActiveBranchCode } from "@/lib/branch-locations";
import { buildSlotsForDate } from "@/lib/schedule";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";
import { getGoogleCalendarSlotCounts } from "@/services/google-calendar";

const BRANCH_CODES = new Set<ActiveBranchCode>(["SN", "MTY_SUR"]);

function getErrorDetails(error: unknown) {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }

  return {
    message: error instanceof Error ? error.message : (error as { message?: string }).message,
    name: error instanceof Error ? error.name : (error as { name?: string }).name,
    status: (error as { status?: number }).status,
    responseBody: (error as { responseBody?: string }).responseBody,
    requestInfo: (error as { requestInfo?: Record<string, string> }).requestInfo
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? "";
  const branchCode = (searchParams.get("branch") ?? "SN") as ActiveBranchCode;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !BRANCH_CODES.has(branchCode)) {
    return NextResponse.json({ error: "Elige una sucursal y fecha válidas." }, { status: 400 });
  }

  const openingDate = BRANCH_OPENING_DATES[branchCode];
  if (openingDate && date < openingDate) {
    return NextResponse.json({ error: "Monterrey Sur abre agenda a partir del 3 de agosto." }, { status: 409 });
  }

  try {
    const client = createSupabaseServiceRoleClient();
    const { data: branch, error: branchError } = await client
      .from("branches")
      .select("code, calendar_email")
      .eq("code", branchCode)
      .eq("is_active", true)
      .maybeSingle();

    if (branchError || !branch?.calendar_email) {
      return NextResponse.json({ error: "Esta sucursal todavía no tiene agenda conectada." }, { status: 409 });
    }

    const slots = buildSlotsForDate(date, new Date(), {}, branchCode).map((slot) => slot.time);
    const counts = await getGoogleCalendarSlotCounts(date, slots, branch.calendar_email);

    return NextResponse.json(
      counts.map((slot) => ({
        appointment_time: slot.time,
        active_count: slot.count
      }))
    );
  } catch (error) {
    console.error("Google Calendar availability error", { branchCode, ...getErrorDetails(error) });

    return NextResponse.json(
      { error: "No se pudieron cargar los horarios reales de Google Calendar." },
      { status: 500 }
    );
  }
}
