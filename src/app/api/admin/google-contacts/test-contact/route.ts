import { NextResponse } from "next/server";
import { isAllowedAdminEmail } from "@/lib/admin";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";
import { deleteGoogleContactsByPhone, getGoogleContactsByPhone } from "@/services/google-contacts";

const TEST_WHATSAPP = "+528114740974";

async function verifyAdmin(request: Request) {
  if (!isSupabaseConfigured()) return false;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser(token);
  const email = data.user?.email ?? "";
  return Boolean(!error && isAllowedAdminEmail(email));
}

export async function GET(request: Request) {
  if (!await verifyAdmin(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const contacts = await getGoogleContactsByPhone(TEST_WHATSAPP);
    return NextResponse.json({ whatsapp: TEST_WHATSAPP, count: contacts.length, contacts });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No se pudo revisar el contacto de prueba."
    }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!await verifyAdmin(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const deleted = await deleteGoogleContactsByPhone(TEST_WHATSAPP);
    return NextResponse.json({ success: true, whatsapp: TEST_WHATSAPP, deleted });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No se pudo borrar el contacto de prueba."
    }, { status: 500 });
  }
}
