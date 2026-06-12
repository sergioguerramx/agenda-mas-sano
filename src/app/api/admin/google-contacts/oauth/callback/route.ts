import { NextResponse } from "next/server";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const STATE_COOKIE = "google_contacts_oauth_state";

type GoogleOAuthResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

function getGoogleContactsConfig() {
  return {
    clientId: (process.env.GOOGLE_CONTACTS_CLIENT_ID ?? "").trim(),
    clientSecret: (process.env.GOOGLE_CONTACTS_CLIENT_SECRET ?? "").trim()
  };
}

function htmlPage(title: string, body: string, status = 200) {
  return new NextResponse(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f8f2e8; color: #263226; }
    main { max-width: 760px; margin: 0 auto; padding: 48px 20px; }
    section { background: white; border: 1px solid #e7ded2; border-radius: 18px; padding: 28px; box-shadow: 0 18px 50px rgba(43, 55, 43, .08); }
    h1 { margin-top: 0; font-size: 32px; }
    p { font-size: 17px; line-height: 1.55; color: #667064; }
    textarea { width: 100%; min-height: 150px; border: 1px solid #d8cec2; border-radius: 12px; padding: 14px; font-size: 14px; box-sizing: border-box; }
    .warning { color: #8b4b21; font-weight: 700; }
  </style>
</head>
<body><main><section>${body}</section></main></body>
</html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code") ?? "";
  const state = requestUrl.searchParams.get("state") ?? "";
  const cookieState = request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${STATE_COOKIE}=`))?.split("=")[1] ?? "";
  const config = getGoogleContactsConfig();

  if (!code) {
    const error = requestUrl.searchParams.get("error") ?? "No se recibio permiso de Google.";
    return htmlPage("Google Contacts", `<h1>No se pudo conectar</h1><p>${error}</p>`, 400);
  }

  if (!state || !cookieState || state !== cookieState) {
    return htmlPage("Google Contacts", "<h1>No se pudo conectar</h1><p>La solicitud vencio. Vuelve a iniciar la conexion.</p>", 400);
  }

  if (!config.clientId || !config.clientSecret) {
    return htmlPage("Google Contacts", "<h1>Falta configuracion</h1><p>Falta configurar Google Contacts en Vercel.</p>", 500);
  }

  const origin = requestUrl.origin;
  const redirectUri = `${origin}/api/admin/google-contacts/oauth/callback`;
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });
  const token = (await tokenResponse.json().catch(() => ({}))) as GoogleOAuthResponse;

  if (!tokenResponse.ok || !token.refresh_token) {
    return htmlPage(
      "Google Contacts",
      `<h1>No se pudo generar el permiso</h1><p>${token.error_description ?? token.error ?? "Google no devolvio refresh token."}</p><p class="warning">Intenta de nuevo y asegúrate de aceptar todos los permisos.</p>`,
      400
    );
  }

  return htmlPage(
    "Google Contacts conectado",
    `<h1>Permiso nuevo generado</h1><p>Este permiso debe reemplazar la variable <strong>GOOGLE_CONTACTS_REFRESH_TOKEN</strong> en Vercel.</p><p class="warning">No compartas este valor por WhatsApp ni correo.</p><textarea readonly>${token.refresh_token}</textarea><p>Después de actualizarlo en Vercel, vuelve a publicar el proyecto para que la agenda use el permiso nuevo.</p>`
  );
}
