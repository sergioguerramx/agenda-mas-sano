export async function upsertGoogleContact(appointment: unknown) {
  return { provider: "google-contacts", status: "not-connected", appointment };
}
