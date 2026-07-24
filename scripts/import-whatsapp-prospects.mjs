import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const root = new URL("../", import.meta.url);
const envPath = process.env.PROSPECT_IMPORT_ENV_FILE
  ?? new URL(".vercel/.env.production.local", root);
const csvPath = new URL(
  "docs/auditoria-whatsapp-anterior/prospectos-recientes-bloque-01.csv",
  root
);

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

function parseCsv(contents) {
  const lines = contents.trim().split(/\r?\n/);
  return lines.slice(1).map((line) => {
    const columns = line
      .split(",")
      .map((value) => value.replace(/^"|"$/g, "").replaceAll('""', '"'));
    return {
      whatsapp: columns[0],
      last_contact_date: columns[1] || null,
      heat_level: columns[2],
      contact_reason: columns[3],
      source: "whatsapp_anterior",
      source_batch: "2026-07-23-bloque-01",
      branch_interest: "POR_CONFIRMAR",
      status: "nuevo",
      can_contact: true,
      updated_at: new Date().toISOString()
    };
  });
}

const env = parseEnv(await readFile(envPath, "utf8"));
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Falta la conexión de Supabase.");
}

const prospects = parseCsv(await readFile(csvPath, "utf8"));
const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const phones = prospects.map((row) => row.whatsapp);
const { data: existing, error: existingError } = await client
  .from("marketing_prospects")
  .select("whatsapp")
  .in("whatsapp", phones);

if (existingError) throw existingError;

const existingPhones = new Set((existing ?? []).map((row) => row.whatsapp));

for (let index = 0; index < prospects.length; index += 100) {
  const chunk = prospects.slice(index, index + 100);
  const { error } = await client
    .from("marketing_prospects")
    .upsert(chunk, { onConflict: "whatsapp" });
  if (error) throw error;
}

const { data: imported, error: importedError } = await client
  .from("marketing_prospects")
  .select("whatsapp,heat_level,source_batch")
  .eq("source_batch", "2026-07-23-bloque-01");

if (importedError) throw importedError;

const counts = (imported ?? []).reduce((result, row) => {
  result[row.heat_level] = (result[row.heat_level] ?? 0) + 1;
  return result;
}, {});

console.log(JSON.stringify({
  prepared: prospects.length,
  previouslyPresent: existingPhones.size,
  insertedOrUpdated: imported?.length ?? 0,
  counts
}, null, 2));
