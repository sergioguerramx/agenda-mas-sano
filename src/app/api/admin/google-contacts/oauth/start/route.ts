import { NextResponse } from "next/server";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_CONTACTS_SCOPE = "https://www.googleapis.com/auth/contacts https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile";
const STATE_COOKIE = "google_contacts_oauth_state";

function getGoogleContactsClientId() {
  return (process.env.GOOGLE_CONTACTS_CLIENT_ID ?? "").trim();
}

export async function GET(request: Request) {
  const clientId = getGoogleContactsClientId();

  if (!clientId) {
    return NextResponse.json({ error: "Falta configurar Google Contacts." }, { status: 500 });
  }

  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/admin/google-contacts/oauth/callback`;
  const state = crypto.randomUUID();
  const authUrl = new URL(GOOGLE_AUTH_URL);

  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GOOGLE_CONTACTS_SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    maxAge: 10 * 60,
    path: "/api/admin/google-contacts/oauth",
    sameSite: "lax",
    secure: true
  });

  return response;
}
