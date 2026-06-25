import { createHmac, timingSafeEqual } from "node:crypto";

export type YoSoySanoBookingService = "sesion_online_399" | "paquete_1199";

export type YoSoySanoBookingToken = {
  clienteId: string;
  registroId: string;
  nombre: string;
  whatsapp: string;
  correo: string;
  servicio: YoSoySanoBookingService;
  origen: "yosoysano";
  exp: number;
};

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf8");
}

function getBookingSecret() {
  return (process.env.YOSOYSANO_BOOKING_TOKEN_SECRET ?? "").trim();
}

function isSafeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyYoSoySanoBookingToken(token: string) {
  const secret = getBookingSecret();
  if (!secret) return null;

  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expectedSignature = createHmac("sha256", secret).update(body).digest("base64url");
  if (!isSafeEqual(signature, expectedSignature)) return null;

  let payload: YoSoySanoBookingToken;

  try {
    payload = JSON.parse(decodeBase64Url(body)) as YoSoySanoBookingToken;
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);

  if (payload.origen !== "yosoysano") return null;
  if (!["sesion_online_399", "paquete_1199"].includes(payload.servicio)) return null;
  if (!payload.exp || payload.exp < now) return null;

  return payload;
}

export function getYoSoySanoServiceLabel(service: YoSoySanoBookingService) {
  return service === "paquete_1199" ? "Paquete 4 sesiones" : "Sesión Online $399";
}
