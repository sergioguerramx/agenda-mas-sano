import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((entry) => {
    const [key, ...valueParts] = entry.replace(/^--/, "").split("=");
    return [key, valueParts.join("=") || "true"];
  })
);

const inputPath = path.resolve(args.input ?? "");
const outputDirectory = path.resolve(args.output ?? "supabase-import-output");
const branchCode = String(args.branch ?? "").trim().toUpperCase();
const patientLimit = Number(args.limit ?? 0);

if (!args.input || !branchCode) {
  console.error("Uso: node scripts/prepare-supabase-import.mjs --input=archivo.json --branch=MTY_SUR [--limit=100]");
  process.exit(1);
}

const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const selectedPatients = patientLimit > 0
  ? source.patients.slice(0, patientLimit)
  : source.patients;
const selectedPatientIds = new Set(selectedPatients.map((patient) => patient.patient_id));
const selectedAppointments = source.appointments.filter((appointment) => selectedPatientIds.has(appointment.patient_id));

function confidenceNumber(value) {
  if (typeof value === "number") return Math.max(0, Math.min(100, Math.round(value)));
  const normalized = String(value ?? "").toLowerCase();
  if (normalized.includes("alta")) return 100;
  if (normalized.includes("media")) return 75;
  if (normalized.includes("baja")) return 50;
  return 70;
}

function normalizedAnswer(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function confirmationValue(value) {
  const normalized = normalizedAnswer(value);
  if (["si", "true", "1"].includes(normalized)) return true;
  if (["no", "false", "0"].includes(normalized)) return false;
  return null;
}

function attendanceValue(value) {
  const normalized = normalizedAnswer(value);
  return ["si", "true", "1"].includes(normalized) ? true : null;
}

function isReleasedAtEight(appointment) {
  const date = new Date(appointment.start);
  if (Number.isNaN(date.getTime())) return false;
  const localHour = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Monterrey",
    hour: "2-digit",
    hourCycle: "h23"
  }).format(date);
  return localHour === "08";
}

function sequenceNumber(appointment) {
  const title = String(appointment.original_title ?? "");
  const match = title.match(/(?:^|\s)(\d{1,2})\s*(?:CTA|CITA)\b/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return parsed > 0 ? parsed : null;
}

const patients = selectedPatients.map((patient) => ({
  source_patient_key: `${branchCode}:${patient.patient_id}`,
  full_name: patient.name,
  whatsapp: patient.phone_quality === "Válido" ? patient.phone_normalized : null,
  whatsapp_status: patient.phone_quality === "Válido" ? 1 : 0,
  promotional_consent: 1
}));

const mappedAppointments = selectedAppointments.map((appointment) => {
  const releasedAtEight = isReleasedAtEight(appointment);
  const attended = releasedAtEight ? false : attendanceValue(appointment.attended);
  const cancelledByText = String(appointment.appointment_status ?? "").toLowerCase().includes("cancel");
  const patientSourceKey = `${branchCode}:${appointment.patient_id}`;
  const calendarEventId = appointment.source_event_id ?? appointment.event_id;
  return {
    source_event_key: `${branchCode}:${calendarEventId}:${patientSourceKey}`,
    calendar_event_id: calendarEventId,
    source_patient_key: patientSourceKey,
    branch_code: branchCode,
    scheduled_at: appointment.start,
    original_scheduled_at: null,
    sequence_number: sequenceNumber(appointment),
    confirmed: confirmationValue(appointment.confirmed),
    attended,
    released_at_8: releasedAtEight,
    cancelled: attended === true ? false : cancelledByText,
    source_kind: 3,
    confidence: confidenceNumber(appointment.confidence)
  };
});

const appointmentsByKey = new Map();
for (const appointment of mappedAppointments) {
  const existing = appointmentsByKey.get(appointment.source_event_key);
  if (!existing) {
    appointmentsByKey.set(appointment.source_event_key, appointment);
    continue;
  }

  appointmentsByKey.set(appointment.source_event_key, {
    ...existing,
    confirmed: existing.confirmed === true || appointment.confirmed === true
      ? true
      : (existing.confirmed === false || appointment.confirmed === false ? false : null),
    attended: existing.attended === true || appointment.attended === true
      ? true
      : (existing.attended === false || appointment.attended === false ? false : null),
    released_at_8: existing.released_at_8 || appointment.released_at_8,
    cancelled: existing.cancelled || appointment.cancelled,
    confidence: Math.max(existing.confidence, appointment.confidence)
  });
}
const appointments = [...appointmentsByKey.values()];

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(path.join(outputDirectory, `${branchCode.toLowerCase()}-patients.json`), JSON.stringify(patients));
fs.writeFileSync(path.join(outputDirectory, `${branchCode.toLowerCase()}-appointments.json`), JSON.stringify(appointments));

const estimatedBytes = Buffer.byteLength(JSON.stringify({ patients, appointments }));
const summary = {
  branch: branchCode,
  patients: patients.length,
  appointments: appointments.length,
  duplicateAppointmentsRemoved: mappedAppointments.length - appointments.length,
  validWhatsapp: patients.filter((patient) => patient.whatsapp_status === 1).length,
  missingWhatsapp: patients.filter((patient) => patient.whatsapp_status === 0).length,
  confirmedAppointments: appointments.filter((appointment) => appointment.confirmed === true).length,
  attendedAppointments: appointments.filter((appointment) => appointment.attended === true).length,
  attendanceNotProven: appointments.filter((appointment) => appointment.attended === null).length,
  releasedAtEight: appointments.filter((appointment) => appointment.released_at_8).length,
  sequenceNumbersDetected: appointments.filter((appointment) => appointment.sequence_number !== null).length,
  estimatedMegabytes: Number((estimatedBytes / 1024 / 1024).toFixed(2)),
  includesOriginalCalendarText: false,
  writesToSupabase: false
};

fs.writeFileSync(path.join(outputDirectory, `${branchCode.toLowerCase()}-summary.json`), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
