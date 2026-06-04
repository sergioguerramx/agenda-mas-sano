import { createSign } from "node:crypto";
import type { AppointmentRow, AppointmentStatus } from "@/types/appointments";

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type GoogleCalendarEventResponse = {
  id?: string;
  error?: {
    message?: string;
  };
};

type GoogleCalendarEvent = {
  id?: string;
  status?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

type GoogleCalendarEventsResponse = {
  items?: GoogleCalendarEvent[];
  error?: {
    message?: string;
  };
};

type CalendarResult = {
  status: "created" | "updated" | "deleted" | "skipped";
  eventId?: string;
  reason?: string;
};

type LocalDateTime = {
  date: string;
  minutes: number;
};

export type CalendarSlotCount = {
  time: string;
  count: number;
};

let tokenCache: { accessToken: string; expiresAt: number } | null = null;

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const DEFAULT_TIME_ZONE = "America/Monterrey";
const DEFAULT_DURATION_MINUTES = 20;
const MAX_EVENTS_PER_SLOT = 2;

function getCalendarConfig() {
  return {
    calendarId: (process.env.GOOGLE_CALENDAR_ID ?? "").trim(),
    serviceAccountEmail: (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "").trim(),
    privateKey: (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim(),
    timeZone: (process.env.GOOGLE_CALENDAR_TIME_ZONE ?? DEFAULT_TIME_ZONE).trim(),
    durationMinutes: Number(process.env.GOOGLE_CALENDAR_EVENT_DURATION_MINUTES ?? DEFAULT_DURATION_MINUTES)
  };
}

export function isGoogleCalendarConfigured() {
  const config = getCalendarConfig();
  return Boolean(config.calendarId && config.serviceAccountEmail && config.privateKey);
}

function base64Url(value: string) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function getGoogleAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60000) {
    return tokenCache.accessToken;
  }

  const config = getCalendarConfig();
  if (!isGoogleCalendarConfigured()) {
    throw new Error("Falta configurar Google Calendar.");
  }

  const now = Math.floor(Date.now() / 1000);
  const unsignedJwt = [
    base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    base64Url(JSON.stringify({
      iss: config.serviceAccountEmail,
      scope: GOOGLE_CALENDAR_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      exp: now + 3600,
      iat: now
    }))
  ].join(".");

  const signature = createSign("RSA-SHA256").update(unsignedJwt).sign(config.privateKey, "base64url");
  const assertion = `${unsignedJwt}.${signature}`;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  const body = (await response.json().catch(() => ({}))) as GoogleTokenResponse;

  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description ?? body.error ?? "No se pudo conectar Google Calendar.");
  }

  tokenCache = {
    accessToken: body.access_token,
    expiresAt: Date.now() + ((body.expires_in ?? 3600) * 1000)
  };

  return body.access_token;
}

function toMinutes(time: string) {
  const [hour = 0, minute = 0] = time.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

function fromMinutes(total: number) {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function addMinutes(date: string, time: string, minutes: number) {
  const total = toMinutes(time) + minutes;
  return `${date}T${fromMinutes(total)}:00`;
}

function getStatusLabel(status: AppointmentStatus) {
  return status === "confirmed"
    ? "Confirmada"
    : status === "cancelled"
      ? "Cancelada"
      : status === "completed"
        ? "Completada"
        : "Agendada";
}

function getPatientName(appointment: AppointmentRow) {
  return `${appointment.first_name} ${appointment.last_name}`.replace(/\s+/g, " ").trim();
}

function getEventBody(appointment: AppointmentRow, status: AppointmentStatus = appointment.status) {
  const config = getCalendarConfig();
  const patientName = getPatientName(appointment);
  const statusLabel = getStatusLabel(status);

  return {
    summary: `PX $399 - ${patientName}`,
    description: [
      `Paciente: ${patientName}`,
      `WhatsApp: ${appointment.whatsapp}`,
      `Estado interno: ${statusLabel}`,
      "Origen: Agenda Mas Sano"
    ].join("\n"),
    start: {
      dateTime: `${appointment.appointment_date}T${appointment.appointment_time.slice(0, 5)}:00`,
      timeZone: config.timeZone
    },
    end: {
      dateTime: addMinutes(appointment.appointment_date, appointment.appointment_time, config.durationMinutes),
      timeZone: config.timeZone
    }
  };
}

async function callGoogleCalendar(path: string, init: RequestInit) {
  const config = getCalendarConfig();
  const accessToken = await getGoogleAccessToken();
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.calendarId)}${path}`;

  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    }
  });

  const body = (await response.json().catch(() => ({}))) as GoogleCalendarEventResponse | GoogleCalendarEventsResponse;

  if (!response.ok) {
    throw new Error(body.error?.message ?? "No se pudo actualizar Google Calendar.");
  }

  return body;
}

function localDateTimeFromGoogleDateTime(value: string, timeZone: string): LocalDateTime {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value));
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${lookup.year}-${lookup.month}-${lookup.day}`,
    minutes: Number(lookup.hour ?? 0) * 60 + Number(lookup.minute ?? 0)
  };
}

function compareDate(a: string, b: string) {
  return a.localeCompare(b);
}

function getEventWindowForDate(event: GoogleCalendarEvent, date: string, timeZone: string) {
  if (event.start?.date || event.end?.date) {
    const startDate = event.start?.date ?? date;
    const endDate = event.end?.date ?? date;
    if (compareDate(startDate, date) <= 0 && compareDate(date, endDate) < 0) {
      return { start: 0, end: 24 * 60 };
    }
    return null;
  }

  if (!event.start?.dateTime || !event.end?.dateTime) return null;

  const start = localDateTimeFromGoogleDateTime(event.start.dateTime, timeZone);
  const end = localDateTimeFromGoogleDateTime(event.end.dateTime, timeZone);

  if (compareDate(start.date, date) > 0 || compareDate(end.date, date) < 0) return null;
  if (compareDate(end.date, date) === 0 && end.minutes === 0 && compareDate(start.date, date) < 0) {
    return null;
  }

  const startMinutes = compareDate(start.date, date) < 0 ? 0 : start.minutes;
  const endMinutes = compareDate(end.date, date) > 0 ? 24 * 60 : end.minutes;

  if (endMinutes <= startMinutes) return null;
  return { start: startMinutes, end: endMinutes };
}

async function listGoogleCalendarEvents(date: string) {
  if (!isGoogleCalendarConfigured()) {
    throw new Error("Google Calendar no esta configurado.");
  }

  const config = getCalendarConfig();
  const params = new URLSearchParams({
    timeMin: `${date}T00:00:00`,
    timeMax: `${date}T23:59:59`,
    timeZone: config.timeZone,
    singleEvents: "true",
    showDeleted: "false",
    orderBy: "startTime"
  });

  const body = await callGoogleCalendar(`/events?${params.toString()}`, { method: "GET" }) as GoogleCalendarEventsResponse;
  return (body.items ?? []).filter((event) => event.status !== "cancelled");
}

export async function getGoogleCalendarSlotCounts(date: string, slotTimes: string[]): Promise<CalendarSlotCount[]> {
  const config = getCalendarConfig();
  const events = await listGoogleCalendarEvents(date);
  const windows = events
    .map((event) => getEventWindowForDate(event, date, config.timeZone))
    .filter((window): window is { start: number; end: number } => Boolean(window));

  return slotTimes.map((time) => {
    const slotStart = toMinutes(time);
    const slotEnd = slotStart + config.durationMinutes;
    const count = windows.filter((event) => event.start < slotEnd && event.end > slotStart).length;
    return { time, count };
  });
}

export async function isGoogleCalendarSlotAvailable(date: string, time: string) {
  const [slot] = await getGoogleCalendarSlotCounts(date, [time.slice(0, 5)]);
  return (slot?.count ?? 0) < MAX_EVENTS_PER_SLOT;
}

export async function createGoogleCalendarEvent(appointment: AppointmentRow): Promise<CalendarResult> {
  if (!isGoogleCalendarConfigured()) {
    return { status: "skipped", reason: "Google Calendar no esta configurado." };
  }

  const body = await callGoogleCalendar("/events", {
    method: "POST",
    body: JSON.stringify(getEventBody(appointment, "pending"))
  }) as GoogleCalendarEventResponse;

  return { status: "created", eventId: body.id };
}

export async function syncGoogleCalendarEventStatus(appointment: AppointmentRow, status: AppointmentStatus): Promise<CalendarResult> {
  if (!isGoogleCalendarConfigured()) {
    return { status: "skipped", reason: "Google Calendar no esta configurado." };
  }

  if (status === "cancelled" && appointment.google_calendar_event_id) {
    await callGoogleCalendar(`/events/${encodeURIComponent(appointment.google_calendar_event_id)}`, {
      method: "DELETE"
    });
    return { status: "deleted" };
  }

  if (!appointment.google_calendar_event_id) {
    return createGoogleCalendarEvent({ ...appointment, status });
  }

  const body = await callGoogleCalendar(`/events/${encodeURIComponent(appointment.google_calendar_event_id)}`, {
    method: "PATCH",
    body: JSON.stringify(getEventBody(appointment, status))
  }) as GoogleCalendarEventResponse;

  return { status: "updated", eventId: body.id ?? appointment.google_calendar_event_id };
}
