export async function createGoogleCalendarEvent(appointment: unknown) {
  return { provider: "google-calendar", status: "not-connected", appointment };
}
