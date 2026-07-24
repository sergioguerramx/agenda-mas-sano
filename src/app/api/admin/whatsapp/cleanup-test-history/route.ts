import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAdminEmail } from "@/lib/admin-auth";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";
import { syncGoogleCalendarEventStatus } from "@/services/google-calendar";
import { deleteGoogleContactsByPhone } from "@/services/google-contacts";
import type { AppointmentRow } from "@/types/appointments";

export const runtime = "nodejs";

const TEST_WHATSAPP = "+528114740974";

type BranchRow = {
  code: string;
  calendar_email: string | null;
};

type TestAppointment = AppointmentRow & {
  branch_code?: string | null;
};

async function getTestRecords() {
  const client = createSupabaseServiceRoleClient();
  const [conversationResult, appointmentsResult, contactsResult, patientsResult, branchesResult] = await Promise.all([
    client
      .from("whatsapp_conversations")
      .select("id, whatsapp, contact_name, created_at, last_message_at")
      .eq("whatsapp", TEST_WHATSAPP)
      .maybeSingle(),
    client
      .from("appointments")
      .select("id, first_name, last_name, whatsapp, appointment_date, appointment_time, status, google_calendar_event_id, google_contact_id, brand, modality, service, origin, branch_code, created_at")
      .eq("whatsapp", TEST_WHATSAPP)
      .order("appointment_date", { ascending: true }),
    client
      .from("contacts")
      .select("id, first_name, last_name, whatsapp, total_appointments, google_contact_resource_name")
      .eq("whatsapp", TEST_WHATSAPP),
    client
      .from("patient_profiles")
      .select("id, full_name, whatsapp, source_patient_key, created_at")
      .eq("whatsapp", TEST_WHATSAPP),
    client
      .from("branches")
      .select("code, calendar_email")
      .in("code", ["SN", "MTY_SUR"])
  ]);

  const firstError = [conversationResult.error, appointmentsResult.error, contactsResult.error, patientsResult.error, branchesResult.error]
    .find(Boolean);
  if (firstError) throw firstError;

  const conversation = conversationResult.data;
  let messageCount = 0;
  if (conversation?.id) {
    const { count, error } = await client
      .from("whatsapp_messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversation.id);
    if (error) throw error;
    messageCount = count ?? 0;
  }

  const patientIds = (patientsResult.data ?? []).map((patient) => patient.id);
  let patientHistories: Array<{ patient_id: string; source_event_key: string | null }> = [];
  if (patientIds.length > 0) {
    const { data, error } = await client
      .from("patient_appointment_history")
      .select("patient_id, source_event_key")
      .in("patient_id", patientIds);
    if (error) throw error;
    patientHistories = data ?? [];
  }

  const testPatients = (patientsResult.data ?? []).filter((patient) => {
    if (patient.source_patient_key) return false;
    const histories = patientHistories.filter((history) => history.patient_id === patient.id);
    return histories.every((history) => history.source_event_key?.startsWith("current:") ?? false);
  });

  return {
    client,
    conversation,
    messageCount,
    appointments: (appointmentsResult.data ?? []) as TestAppointment[],
    contacts: contactsResult.data ?? [],
    patients: patientsResult.data ?? [],
    testPatients,
    branches: (branchesResult.data ?? []) as BranchRow[]
  };
}

export async function GET(request: NextRequest) {
  const adminEmail = await getAuthenticatedAdminEmail(request);
  if (!adminEmail) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const records = await getTestRecords();
    return NextResponse.json({
      whatsapp: TEST_WHATSAPP,
      conversation: records.conversation ? 1 : 0,
      messages: records.messageCount,
      appointments: records.appointments.map((appointment) => ({
        id: appointment.id,
        patient: `${appointment.first_name} ${appointment.last_name}`.trim(),
        date: appointment.appointment_date,
        time: appointment.appointment_time,
        branch: appointment.branch_code ?? "SN",
        calendarEvent: Boolean(appointment.google_calendar_event_id)
      })),
      contacts: records.contacts.length,
      patientProfiles: records.testPatients.length,
      historicalProfilesPreserved: records.patients.length - records.testPatients.length
    });
  } catch (error) {
    console.error("Test history preview failed", { error });
    return NextResponse.json({ error: "No se pudo revisar el historial de prueba." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const adminEmail = await getAuthenticatedAdminEmail(request);
  if (!adminEmail) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  let cleanupStage = "revisión";
  try {
    const records = await getTestRecords();
    const calendarByBranch = new Map(records.branches.map((branch) => [branch.code, branch.calendar_email]));
    let calendarEventsDeleted = 0;
    let googleContactsDeleted = 0;

    for (const appointment of records.appointments) {
      if (!appointment.google_calendar_event_id) continue;
      const branchCode = appointment.branch_code ?? "SN";
      const calendarEmail = calendarByBranch.get(branchCode) ?? calendarByBranch.get("SN") ?? undefined;
      try {
        cleanupStage = "Google Calendar";
        await syncGoogleCalendarEventStatus(appointment, "cancelled", calendarEmail ?? undefined);
        calendarEventsDeleted += 1;
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status === 404 || status === 410) continue;
        throw error;
      }
    }

    const appointmentIds = records.appointments.map((appointment) => appointment.id);
    if (appointmentIds.length > 0) {
      cleanupStage = "historial de citas";
      const { error: historyError } = await records.client
        .from("patient_appointment_history")
        .delete()
        .in("legacy_appointment_id", appointmentIds);
      if (historyError) throw historyError;
    }

    const testPatientIds = records.testPatients.map((patient) => patient.id);
    if (testPatientIds.length > 0) {
      cleanupStage = "fichas de prueba";
      const { error: patientError } = await records.client
        .from("patient_profiles")
        .delete()
        .in("id", testPatientIds);
      if (patientError) throw patientError;
    }

    cleanupStage = "citas de prueba";
    const { error: appointmentError } = await records.client
      .from("appointments")
      .delete()
      .eq("whatsapp", TEST_WHATSAPP);
    if (appointmentError) throw appointmentError;

    cleanupStage = "contacto de prueba";
    const { error: contactError } = await records.client
      .from("contacts")
      .delete()
      .eq("whatsapp", TEST_WHATSAPP);
    if (contactError) throw contactError;

    cleanupStage = "Google Contacts";
    googleContactsDeleted = await deleteGoogleContactsByPhone(TEST_WHATSAPP);

    cleanupStage = "conversación de prueba";
    const { error: conversationError } = await records.client
      .from("whatsapp_conversations")
      .delete()
      .eq("whatsapp", TEST_WHATSAPP);
    if (conversationError) throw conversationError;

    return NextResponse.json({
      ok: true,
      whatsapp: TEST_WHATSAPP,
      removed: {
        conversations: records.conversation ? 1 : 0,
        messages: records.messageCount,
        appointments: records.appointments.length,
        calendarEvents: calendarEventsDeleted,
        contacts: records.contacts.length,
        googleContacts: googleContactsDeleted,
        patientProfiles: records.testPatients.length,
        historicalProfilesPreserved: records.patients.length - records.testPatients.length
      }
    });
  } catch (error) {
    console.error("Test history cleanup failed", { cleanupStage, error });
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      error: `No se pudo completar la limpieza en: ${cleanupStage}.`,
      detail
    }, { status: 500 });
  }
}
