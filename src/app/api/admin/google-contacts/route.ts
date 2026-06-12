import { NextResponse } from "next/server";
import { isAllowedAdminEmail } from "@/lib/admin";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";
import { getGoogleContactsAccountInfo } from "@/services/google-contacts";

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Falta conectar Supabase." }, { status: 500 });
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return NextResponse.json({ error: "Falta iniciar sesion." }, { status: 401 });
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser(token);
  const email = data.user?.email ?? "";

  if (error || !isAllowedAdminEmail(email)) {
    return NextResponse.json({ error: "No tienes acceso a esta revision." }, { status: 403 });
  }

  try {
    const account = await getGoogleContactsAccountInfo();
    return NextResponse.json(account);
  } catch (error) {
    return NextResponse.json({
      configured: true,
      connected: false,
      reason: error instanceof Error ? error.message : "No se pudo revisar Google Contacts."
    });
  }
}
