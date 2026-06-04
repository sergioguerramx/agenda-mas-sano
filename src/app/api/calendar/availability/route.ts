import { NextResponse } from "next/server";
import { buildSlotsForDate } from "@/lib/schedule";
import { getGoogleCalendarSlotCounts } from "@/services/google-calendar";

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

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Fecha invalida." }, { status: 400 });
  }

  try {
    const slots = buildSlotsForDate(date, new Date()).map((slot) => slot.time);
    const counts = await getGoogleCalendarSlotCounts(date, slots);

    return NextResponse.json(
      counts.map((slot) => ({
        appointment_time: slot.time,
        active_count: slot.count
      }))
    );
  } catch (error) {
    console.error("Google Calendar availability error", getErrorDetails(error));

    return NextResponse.json(
      { error: "No se pudieron cargar los horarios reales de Google Calendar." },
      { status: 500 }
    );
  }
}
