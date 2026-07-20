import { createHmac, timingSafeEqual } from "node:crypto";

type WhatsAppTemplateParameter = {
  type: "text";
  text: string;
};

type WhatsAppTemplateComponent = {
  type: "body";
  parameters: WhatsAppTemplateParameter[];
};

type CloudMessageResponse = {
  messages?: Array<{ id?: string }>;
  error?: { message?: string; error_user_msg?: string };
};

function getCloudWhatsAppConfig() {
  return {
    accessToken: (process.env.META_WHATSAPP_ACCESS_TOKEN ?? "").trim(),
    phoneNumberId: (process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? "").trim(),
    apiVersion: (process.env.META_GRAPH_API_VERSION ?? "v25.0").trim()
  };
}

export function isCloudWhatsAppOutboundEnabled() {
  return (process.env.WHATSAPP_OUTBOUND_ENABLED ?? "false").trim().toLowerCase() === "true";
}

async function sendCloudWhatsAppPayload(payload: Record<string, unknown>) {
  if (!isCloudWhatsAppOutboundEnabled()) {
    throw new Error("Los mensajes están pausados hasta resolver el nombre de Más Sano en Meta.");
  }

  const config = getCloudWhatsAppConfig();
  if (!config.accessToken || !config.phoneNumberId) {
    throw new Error("El número de campañas todavía no está completamente conectado.");
  }

  const response = await fetch(`https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({})) as CloudMessageResponse;
  const messageId = body.messages?.[0]?.id;

  if (!response.ok || !messageId) {
    throw new Error(body.error?.error_user_msg ?? body.error?.message ?? "Meta rechazó el envío.");
  }

  return messageId;
}

export function getAppointmentTemplateNames() {
  return {
    first: (process.env.META_WHATSAPP_CONFIRMATION_TEMPLATE ?? "mas_sano_confirmacion_cita").trim(),
    second: (process.env.META_WHATSAPP_SECOND_CONFIRMATION_TEMPLATE ?? "mas_sano_segunda_confirmacion").trim(),
    released: (process.env.META_WHATSAPP_RELEASED_TEMPLATE ?? "mas_sano_cita_liberada").trim(),
    language: (process.env.META_WHATSAPP_TEMPLATE_LANGUAGE ?? "es_MX").trim()
  };
}

export async function sendCloudWhatsAppText(to: string, body: string) {
  return sendCloudWhatsAppPayload({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to.replace(/\D/g, ""),
    type: "text",
    text: { body, preview_url: false }
  });
}

export async function sendCloudWhatsAppTemplate(
  to: string,
  templateName: string,
  language: string,
  parameters: string[]
) {
  const components: WhatsAppTemplateComponent[] = [{
    type: "body",
    parameters: parameters.map((text) => ({ type: "text", text }))
  }];

  return sendCloudWhatsAppPayload({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to.replace(/\D/g, ""),
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
      components
    }
  });
}

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
