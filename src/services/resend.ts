import type { AppointmentRow } from "@/types/appointments";

type ResendResponse = {
  id?: string;
  message?: string;
  name?: string;
};

type EmailResult = {
  status: "sent" | "skipped";
  emailId?: string;
  reason?: string;
};

const INTERNAL_NOTIFICATION_EMAIL = "info.mas.sano@gmail.com";

function getResendConfig() {
  return {
    apiKey: (process.env.RESEND_API_KEY ?? "").trim(),
    fromEmail: (process.env.RESEND_FROM_EMAIL ?? "").trim(),
    toEmail: (process.env.INTERNAL_NOTIFY_EMAIL ?? INTERNAL_NOTIFICATION_EMAIL).trim()
  };
}

export function isResendConfigured() {
  const config = getResendConfig();
  return Boolean(config.apiKey && config.fromEmail && config.toEmail);
}

export async function sendInternalAppointmentEmail(appointment: AppointmentRow): Promise<EmailResult> {
  if (!isResendConfigured()) {
    return { status: "skipped", reason: "Resend no esta configurado." };
  }

  const config = getResendConfig();
  const patientName = `${appointment.first_name} ${appointment.last_name}`.trim();
  const subject = `Nueva cita pendiente - ${appointment.appointment_date} ${appointment.appointment_time.slice(0, 5)}`;
  const text = [
    "Se recibio una nueva cita en la agenda publica.",
    "",
    `Paciente: ${patientName}`,
    `WhatsApp: ${appointment.whatsapp}`,
    `Fecha: ${appointment.appointment_date}`,
    `Hora: ${appointment.appointment_time.slice(0, 5)}`,
    "Estado: pendiente"
  ].join("\n");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: config.fromEmail,
      to: config.toEmail,
      subject,
      text
    })
  });

  const body = (await response.json().catch(() => ({}))) as ResendResponse;

  if (!response.ok) {
    throw new Error(body.message ?? body.name ?? "No se pudo enviar el correo interno.");
  }

  return { status: "sent", emailId: body.id };
}
