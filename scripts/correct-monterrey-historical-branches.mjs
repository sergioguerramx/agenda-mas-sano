import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const root = new URL("../", import.meta.url);
const envPath = process.env.HISTORICAL_BRANCH_ENV_FILE
  ?? new URL(".vercel/.env.production.local", root);
const sourcePath = process.env.HISTORICAL_BRANCH_SOURCE_FILE
  ?? new URL("../work/monterrey_sur/processed_corrected.json", root);
const applyChanges = process.argv.includes("--apply");

function parseEnv(contents) {
  const result = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator);
    let value = line.slice(separator + 1);
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value.replaceAll("\\n", "\n");
  }
  return result;
}

async function fetchAllHistoricalRows(client) {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await client
      .from("patient_appointment_history")
      .select("id,patient_id,branch_id,source_event_key,calendar_event_id")
      .like("source_event_key", "MTY_SUR:%")
      .order("id", { ascending: true })
      .range(start, start + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function updateInChunks(client, ids, branchId) {
  for (let index = 0; index < ids.length; index += 100) {
    const chunk = ids.slice(index, index + 100);
    const { error } = await client
      .from("patient_appointment_history")
      .update({ branch_id: branchId, updated_at: new Date().toISOString() })
      .in("id", chunk);
    if (error) throw error;
  }
}

async function deleteInChunks(client, table, ids) {
  for (let index = 0; index < ids.length; index += 100) {
    const chunk = ids.slice(index, index + 100);
    const { error } = await client.from(table).delete().in("id", chunk);
    if (error) throw error;
  }
}

const env = parseEnv(await readFile(envPath, "utf8"));
const supabaseUrl = (
  process.env.NEXT_PUBLIC_SUPABASE_URL
  ?? env.NEXT_PUBLIC_SUPABASE_URL
)?.trim();
const serviceRoleKey = (
  process.env.SUPABASE_SERVICE_ROLE_KEY
  ?? env.SUPABASE_SERVICE_ROLE_KEY
)?.trim();
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Falta la conexión de Supabase.");
}

const source = JSON.parse(await readFile(sourcePath, "utf8"));
const expectedByKey = new Map();
for (const appointment of source.appointments) {
  const calendarEventId = appointment.source_event_id ?? appointment.event_id;
  const sourcePatientKey = `MTY_SUR:${appointment.patient_id}`;
  const sourceEventKey = `MTY_SUR:${calendarEventId}:${sourcePatientKey}`;
  expectedByKey.set(sourceEventKey, appointment.historical_group_code);
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const { data: currentBranches, error: branchReadError } = await client
  .from("branches")
  .select("id,code,name,is_active")
  .in("code", ["SN", "GPE_CENTRO", "MTY_SUR", "MTY_LINCOLN", "MTY_MITRAS"]);
if (branchReadError) throw branchReadError;

const historicalRows = await fetchAllHistoricalRows(client);
const matched = [];
const unmatched = [];
for (const row of historicalRows) {
  const branchCode = expectedByKey.get(row.source_event_key);
  if (branchCode) matched.push({ ...row, target_branch_code: branchCode });
  else unmatched.push(row);
}

const liveKeys = new Set(historicalRows.map((row) => row.source_event_key));
const missingInDatabase = [...expectedByKey.keys()].filter((key) => !liveKeys.has(key));
const targetCounts = matched.reduce((result, row) => {
  result[row.target_branch_code] = (result[row.target_branch_code] ?? 0) + 1;
  return result;
}, {});

const dryRunSummary = {
  mode: applyChanges ? "apply" : "dry-run",
  liveHistoricalRows: historicalRows.length,
  correctedRowsExpected: expectedByKey.size,
  matchedRows: matched.length,
  rowsExcludedByCorrection: unmatched.length,
  correctedRowsMissingInDatabase: missingInDatabase.length,
  targetCounts,
  existingBranches: Object.fromEntries(
    (currentBranches ?? []).map((branch) => [
      branch.code,
      { name: branch.name, isActive: branch.is_active }
    ])
  )
};

if (!applyChanges) {
  console.log(JSON.stringify(dryRunSummary, null, 2));
  process.exit(0);
}

if (missingInDatabase.length > 0) {
  throw new Error(
    `No se aplicaron cambios: faltan ${missingInDatabase.length} citas corregidas en la base.`
  );
}

const { error: branchUpsertError } = await client.from("branches").upsert([
  {
    code: "MTY_LINCOLN",
    name: "Monterrey Lincoln / Poniente",
    calendar_email: null,
    is_active: false,
    updated_at: new Date().toISOString()
  },
  {
    code: "MTY_MITRAS",
    name: "Monterrey Mitras Centro",
    calendar_email: null,
    is_active: false,
    updated_at: new Date().toISOString()
  }
], { onConflict: "code" });
if (branchUpsertError) throw branchUpsertError;

const { data: targetBranches, error: targetBranchError } = await client
  .from("branches")
  .select("id,code")
  .in("code", ["SN", "GPE_CENTRO", "MTY_SUR", "MTY_LINCOLN", "MTY_MITRAS"]);
if (targetBranchError) throw targetBranchError;
const branchIdByCode = new Map((targetBranches ?? []).map((row) => [row.code, row.id]));

for (const code of ["SN", "GPE_CENTRO", "MTY_SUR", "MTY_LINCOLN", "MTY_MITRAS"]) {
  if (!branchIdByCode.has(code)) throw new Error(`No se encontró la sede ${code}.`);
}

const backupPath = new URL(
  `../work/monterrey_sur/supabase-branch-correction-backup-${Date.now()}.json`,
  root
);
await writeFile(
  backupPath,
  JSON.stringify({
    created_at: new Date().toISOString(),
    rows: historicalRows,
    branches: currentBranches
  }, null, 2)
);

for (const [branchCode, branchId] of branchIdByCode.entries()) {
  const ids = matched
    .filter((row) => row.target_branch_code === branchCode && row.branch_id !== branchId)
    .map((row) => row.id);
  await updateInChunks(client, ids, branchId);
}

const excludedPatientIds = [...new Set(unmatched.map((row) => row.patient_id))];
await deleteInChunks(client, "patient_appointment_history", unmatched.map((row) => row.id));

const orphanPatientIds = [];
for (const patientId of excludedPatientIds) {
  const { count, error } = await client
    .from("patient_appointment_history")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", patientId);
  if (error) throw error;
  if ((count ?? 0) === 0) orphanPatientIds.push(patientId);
}
await deleteInChunks(client, "patient_profiles", orphanPatientIds);

const verifiedRows = await fetchAllHistoricalRows(client);
const verifiedCounts = {};
for (const row of verifiedRows) {
  const branch = (targetBranches ?? []).find((candidate) => candidate.id === row.branch_id);
  const code = branch?.code ?? `ID_${row.branch_id}`;
  verifiedCounts[code] = (verifiedCounts[code] ?? 0) + 1;
}

console.log(JSON.stringify({
  ...dryRunSummary,
  backupCreated: true,
  updatedRows: matched.length,
  deletedAdministrativeRows: unmatched.length,
  deletedOrphanAdministrativeProfiles: orphanPatientIds.length,
  verifiedHistoricalRows: verifiedRows.length,
  verifiedCounts
}, null, 2));
