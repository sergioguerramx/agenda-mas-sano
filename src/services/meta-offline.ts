import { createHash } from "node:crypto";
import type { AppointmentRow } from "@/types/appointments";

type MetaEventResponse = {
  events_received?: number;
  messages?: unknown[];
  fbtrace_id?: string;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

type MetaPurchasePayload = {
  data: Array<{
    event_name: "Purchase";
    event_time: number;
    event_id: string;
    action_source: "physical_store";
    user_data: Record<string, string[]>;
    custom_data: {
      value: 399;
      currency: "MXN";
      content_name: "Sesión 399";
      content_category: "servicio_local";
      order_id: string;
      source: "agenda_mas_sano";
      ad_source?: string;
    };
  }>;
  test_event_code?: string;
};

const META_API_VERSION = "v20.0";
const PURCHASE_VALUE = 399;
const PURCHASE_CURRENCY = "MXN";

function getMetaConfig() {
  return {
    eventSetId: (process.env.MAS_SANO_META_OFFLINE_EVENT_SET_ID ?? "").trim(),
    accessToken: (process.env.MAS_SANO_META_OFFLINE_ACCESS_TOKEN ?? "").trim(),
    testEventCode: (process.env.MAS_SANO_META_TEST_EVENT_CODE ?? "").trim()
  };
}

function isMetaConfigured() {
  const config = getMetaConfig();
  return Boolean(config.eventSetId && config.accessToken);
}

export function normalizePhone(value?: string | null) {
  return (value ?? "").replace(/\D/g, "");
}

export function normalizeEmail(value?: string | null) {
  return (value ?? "").trim().toLowerCase();
}

export function normalizeName(value?: string | null) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function hashForMeta(value?: string | null) {
  const normalized = (value ?? "").trim();
  if (!normalized) return "";
  return createHash("sha256").update(normalized).digest("hex");
}

function getSafeError(error: unknown) {
  if (error instanceof Error) return { message: error.message, name: error.name };
  return { message: String(error) };
}

function addUserData(userData: Record<string, string[]>, key: string, value: string) {
  const hashed = hashForMeta(value);
  if (hashed) userData[key] = [hashed];
}

export function buildMasSanoMetaPurchasePayload(appointment: AppointmentRow, eventTime = Math.floor(Date.now() / 1000)): MetaPurchasePayload {
  const config = getMetaConfig();
  const appointmentId = appointment.id;
  const userData: Record<string, string[]> = {};

  addUserData(userData, "external_id", appointmentId);
  addUserData(userData, "ph", normalizePhone(appointment.whatsapp));
  addUserData(userData, "em", normalizeEmail(appointment.correo));
  addUserData(userData, "fn", normalizeName(appointment.first_name));
  addUserData(userData, "ln", normalizeName(appointment.last_name));

  const customData: MetaPurchasePayload["data"][number]["custom_data"] = {
    value: PURCHASE_VALUE,
    currency: PURCHASE_CURRENCY,
    content_name: "Sesión 399",
    content_category: "servicio_local",
    order_id: appointmentId,
    source: "agenda_mas_sano"
  };

  if (appointment.origin) customData.ad_source = appointment.origin;

  const payload: MetaPurchasePayload = {
    data: [
      {
        event_name: "Purchase",
        event_time: eventTime,
        event_id: appointmentId,
        action_source: "physical_store",
        user_data: userData,
        custom_data: customData
      }
    ]
  };

  if (config.testEventCode) payload.test_event_code = config.testEventCode;

  return payload;
}

export async function sendMasSanoPurchaseToMeta(appointment: AppointmentRow) {
  if (!isMetaConfigured()) {
    return { status: "skipped", reason: "Meta environment variables are not configured." };
  }

  const config = getMetaConfig();
  const payload = buildMasSanoMetaPurchasePayload(appointment);
  const url = `https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(config.eventSetId)}/events`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        access_token: config.accessToken
      })
    });
    const body = (await response.json().catch(() => ({}))) as MetaEventResponse;

    if (!response.ok || body.error || body.events_received !== 1) {
      console.warn("Meta purchase event warning", {
        appointmentId: appointment.id,
        status: response.status,
        eventsReceived: body.events_received,
        messages: body.messages,
        error: body.error ? {
          message: body.error.message,
          type: body.error.type,
          code: body.error.code,
          errorSubcode: body.error.error_subcode,
          fbtraceId: body.error.fbtrace_id
        } : undefined,
        fbtraceId: body.fbtrace_id
      });
      return { status: "failed", response: body };
    }

    console.info("Meta purchase event sent", {
      appointmentId: appointment.id,
      eventsReceived: body.events_received,
      fbtraceId: body.fbtrace_id
    });

    return { status: "sent", response: body };
  } catch (error) {
    console.warn("Meta purchase event failed", {
      appointmentId: appointment.id,
      error: getSafeError(error)
    });
    return { status: "failed", error: getSafeError(error) };
  }
}
