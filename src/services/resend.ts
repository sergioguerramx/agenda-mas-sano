export async function sendAppointmentEmail(appointment: unknown) {
  return { provider: "resend", status: "not-connected", appointment };
}
