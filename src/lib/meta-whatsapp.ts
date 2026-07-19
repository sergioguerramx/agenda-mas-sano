import { createHmac, timingSafeEqual } from "node:crypto";

export function normalizeCloudWhatsApp(value: string) {
  let digits = value.replace(/\D/g, "");

  if (digits.startsWith("521") && digits.length === 13) {
    digits = `52${digits.slice(3)}`;
  } else if (digits.length === 10) {
    digits = `52${digits}`;
  }

  return /^\d{8,15}$/.test(digits) ? `+${digits}` : "";
}

export function verifyMetaSignature(rawBody: string, signature: string, appSecret: string) {
  if (!signature.startsWith("sha256=") || !appSecret) return false;

  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);

  return expectedBuffer.length === signatureBuffer.length && timingSafeEqual(expectedBuffer, signatureBuffer);
}

export function getIncomingMessageBody(message: Record<string, unknown>) {
  const type = typeof message.type === "string" ? message.type : "unknown";
  const text = message.text as { body?: string } | undefined;
  const button = message.button as { text?: string } | undefined;
  const interactive = message.interactive as
    | { button_reply?: { title?: string }; list_reply?: { title?: string } }
    | undefined;

  if (type === "text") return text?.body?.trim() || "";
  if (type === "button") return button?.text?.trim() || "Respuesta a botón";
  if (type === "interactive") {
    return interactive?.button_reply?.title?.trim()
      || interactive?.list_reply?.title?.trim()
      || "Respuesta interactiva";
  }

  const labels: Record<string, string> = {
    audio: "Audio recibido",
    document: "Documento recibido",
    image: "Imagen recibida",
    location: "Ubicación recibida",
    sticker: "Sticker recibido",
    video: "Video recibido",
    contacts: "Contacto recibido"
  };

  return labels[type] ?? "Mensaje recibido";
}

export function unixSecondsToIso(value: string | number | undefined) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : new Date().toISOString();
}

