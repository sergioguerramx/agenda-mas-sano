import { NextResponse } from "next/server";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";

type RequestPayload = {
  firstName?: string;
  lastName?: string;
  whatsapp?: string;
  date?: string;
  time?: string;
};

type SupabaseSafeError = { message?: string; code?: string; details?: string; hint?: string };

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Falta conectar Supabase." }, { status: 500 });
  }

  let payload: RequestPayload;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "No se pudieron leer los datos de la cita." }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("request_public_appointment", {
      p_first_name: payload.firstName,
      p_last_name: payload.lastName,
      p_whatsapp: payload.whatsapp,
      p_appointment_date: payload.date,
      p_appointment_time: payload.time
    });

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    const safeError = error as SupabaseSafeError;
    console.error("Supabase request_public_appointment server error", {
      message: safeError.message,
      code: safeError.code,
      details: safeError.details,
      hint: safeError.hint
    });

    return NextResponse.json(
      { error: safeError.message ?? "No se pudo guardar la cita." },
      { status: 500 }
    );
  }
}
