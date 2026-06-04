import { NextResponse } from "next/server";
import { buildSlotsForDate } from "@/lib/schedule";
import { getGoogleCalendarSlotCounts } from "@/services/google-calendar";

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
    console.error("Google Calendar availability error", {
      message: error instanceof Error ? error.message : "No se pudo leer Google Calendar."
    });

    return NextResponse.json(
      { error: "No se pudieron cargar los horarios reales de Google Calendar." },
      { status: 500 }
    );
  }
}
