import type { SupabaseClient } from "@supabase/supabase-js";

type ContactSyncResult = {
  status: "synced" | "skipped";
  reason?: string;
};

export async function syncContactFromAppointment(
  supabase: SupabaseClient,
  appointmentId?: string | null
): Promise<ContactSyncResult> {
  if (!appointmentId) {
    return { status: "skipped", reason: "No hay cita para sincronizar contacto." };
  }

  const { error } = await supabase.rpc("sync_contact_from_appointment", {
    p_appointment_id: appointmentId
  });

  if (error) throw error;

  return { status: "synced" };
}
