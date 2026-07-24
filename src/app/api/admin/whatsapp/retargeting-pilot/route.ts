import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAdminEmail } from "@/lib/admin-auth";
import { sendCloudWhatsAppTemplate } from "@/lib/meta-whatsapp";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const PILOT_SIZE = 25;
const CAMPAIGN_NAME = "Piloto Monterrey Poniente 2026-07-21 bloque 1";
const TEMPLATE_NAME = "mas_sano_reactivacion_mty_sur_449_v2";
const SOURCE_BRANCHES = ["MTY_SUR", "GPE_CENTRO", "GPE_LINDAVISTA"];
const INTERNAL_NUMBERS = new Set([
  "+528186935634",
  "+528114740974",
  "+528132469930",
  "+528125761735"
]);

type Candidate = {
  patient_id: string;
  full_name: string;
  whatsapp: string;
  branch_id: number;
  branch_code: string;
  last_attended_at: string | null;
  attended_appointments: number;
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  const adminEmail = await getAuthenticatedAdminEmail(request);
  if (!adminEmail) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const client = createSupabaseServiceRoleClient();
  const { data: branch, error: branchError } = await client
    .from("branches")
    .select("id")
    .eq("code", "MTY_SUR")
    .single();
  if (branchError || !branch) {
    return NextResponse.json({ error: "No pudimos identificar Monterrey Poniente." }, { status: 409 });
  }

  const { data: existingCampaign } = await client
    .from("retargeting_campaigns")
    .select("id")
    .eq("name", CAMPAIGN_NAME)
    .maybeSingle();

  if (existingCampaign) {
    const { data: existingMessages } = await client
      .from("retargeting_messages")
      .select("delivery_status")
      .eq("campaign_id", existingCampaign.id);
    const sent = (existingMessages ?? []).filter((row) => row.delivery_status === 1).length;
    const failed = (existingMessages ?? []).filter((row) => row.delivery_status === -1).length;
    return NextResponse.json({ ok: true, alreadyStarted: true, selected: existingMessages?.length ?? 0, sent, failed });
  }

  const { data: rawCandidates, error: candidateError } = await client
    .from("retargeting_segment_candidates")
    .select("patient_id,full_name,whatsapp,branch_id,branch_code,last_attended_at,attended_appointments")
    .in("branch_code", SOURCE_BRANCHES)
    .eq("promotion_ready", true)
    .gt("attended_appointments", 0)
    .not("last_attended_at", "is", null)
    .order("last_attended_at", { ascending: false, nullsFirst: false })
    .order("attended_appointments", { ascending: false })
    .limit(500);

  if (candidateError) {
    return NextResponse.json({ error: "No pudimos preparar el bloque de pacientes." }, { status: 500 });
  }

  const candidates = (rawCandidates ?? []) as Candidate[];
  const patientIds = candidates.map((row) => row.patient_id);
  const whatsapps = [...new Set(candidates.map((row) => row.whatsapp))];

  const [{ data: priorMessages }, { data: existingConversations }] = await Promise.all([
    patientIds.length > 0
      ? client.from("retargeting_messages").select("patient_id").in("patient_id", patientIds)
      : Promise.resolve({ data: [] as Array<{ patient_id: string }> }),
    whatsapps.length > 0
      ? client.from("whatsapp_conversations").select("whatsapp,workflow_status").in("whatsapp", whatsapps)
      : Promise.resolve({ data: [] as Array<{ whatsapp: string; workflow_status: string }> })
  ]);

  const previouslyContacted = new Set((priorMessages ?? []).map((row) => row.patient_id));
  const blockedNumbers = new Set(
    (existingConversations ?? [])
      .filter((row) => row.workflow_status === "no_contactar")
      .map((row) => row.whatsapp)
  );

  const selected: Candidate[] = [];
  const selectedPhones = new Set<string>();
  for (const candidate of candidates) {
    if (selected.length >= PILOT_SIZE) break;
    if (!candidate.whatsapp || INTERNAL_NUMBERS.has(candidate.whatsapp)) continue;
    if (selectedPhones.has(candidate.whatsapp) || blockedNumbers.has(candidate.whatsapp)) continue;
    if (previouslyContacted.has(candidate.patient_id)) continue;
    selected.push(candidate);
    selectedPhones.add(candidate.whatsapp);
  }

  if (selected.length < PILOT_SIZE) {
    return NextResponse.json({ error: `Solo encontramos ${selected.length} contactos aptos para este piloto.` }, { status: 409 });
  }

  const { data: campaign, error: campaignError } = await client
    .from("retargeting_campaigns")
    .insert({
      name: CAMPAIGN_NAME,
      branch_id: branch.id,
      segment_key: "calientes_mty_sur_piloto_1"
    })
    .select("id")
    .single();
  if (campaignError || !campaign) {
    return NextResponse.json({ error: "No pudimos registrar la campaña piloto." }, { status: 500 });
  }

  let sent = 0;
  let failed = 0;
  const appointmentCounts: number[] = [];
  const visitDates: string[] = [];

  for (const candidate of selected) {
    appointmentCounts.push(candidate.attended_appointments);
    if (candidate.last_attended_at) visitDates.push(candidate.last_attended_at);

    const { data: pending, error: pendingError } = await client
      .from("retargeting_messages")
      .insert({ campaign_id: campaign.id, patient_id: candidate.patient_id, delivery_status: 0 })
      .select("id")
      .single();
    if (pendingError || !pending) {
      failed += 1;
      continue;
    }

    try {
      const metaMessageId = await sendCloudWhatsAppTemplate(candidate.whatsapp, TEMPLATE_NAME, "es", []);
      const sentAt = new Date().toISOString();

      const { data: existingConversation } = await client
        .from("whatsapp_conversations")
        .select("id,workflow_status")
        .eq("whatsapp", candidate.whatsapp)
        .maybeSingle();

      let conversationId = existingConversation?.id ?? "";
      if (!conversationId) {
        const { data: createdConversation, error: conversationError } = await client
          .from("whatsapp_conversations")
          .insert({
            whatsapp: candidate.whatsapp,
            contact_name: candidate.full_name,
            branch_interest: "MTY_SUR",
            workflow_status: "nuevo",
            last_message_at: sentAt,
            last_message_preview: "Invitación de reactivación Monterrey Poniente",
            last_message_direction: 2,
            updated_by_email: adminEmail,
            updated_at: sentAt
          })
          .select("id")
          .single();
        if (conversationError || !createdConversation) throw conversationError ?? new Error("No se creó la conversación.");
        conversationId = createdConversation.id;
      } else {
        await client.from("whatsapp_conversations").update({
          branch_interest: "MTY_SUR",
          last_message_at: sentAt,
          last_message_preview: "Invitación de reactivación Monterrey Poniente",
          last_message_direction: 2,
          updated_by_email: adminEmail,
          updated_at: sentAt
        }).eq("id", conversationId);
      }

      const { error: messageError } = await client.from("whatsapp_messages").insert({
        conversation_id: conversationId,
        meta_message_id: metaMessageId,
        direction: 2,
        message_type: "template",
        body: "Invitación de reactivación Monterrey Poniente ($449)",
        delivery_status: 1,
        sent_at: sentAt,
        sent_by_email: adminEmail
      });
      if (messageError) throw messageError;

      await client.from("retargeting_messages").update({ delivery_status: 1, sent_at: sentAt }).eq("id", pending.id);
      sent += 1;
    } catch {
      await client.from("retargeting_messages").update({ delivery_status: -1 }).eq("id", pending.id);
      failed += 1;
    }

    await delay(200);
  }

  const averageAppointments = appointmentCounts.length > 0
    ? Math.round((appointmentCounts.reduce((sum, count) => sum + count, 0) / appointmentCounts.length) * 10) / 10
    : 0;
  visitDates.sort();

  return NextResponse.json({
    ok: failed === 0,
    selected: selected.length,
    sent,
    failed,
    averageAppointments,
    oldestLastVisit: visitDates[0]?.slice(0, 10) ?? null,
    newestLastVisit: visitDates.at(-1)?.slice(0, 10) ?? null
  });
}
