import type { AppointmentRow } from "@/types/appointments";

type GoogleOAuthResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type GooglePerson = {
  resourceName?: string;
  etag?: string;
  metadata?: {
    sources?: Array<{ type?: string; etag?: string; id?: string }>;
  };
  names?: Array<{ givenName?: string; familyName?: string }>;
  phoneNumbers?: Array<{ value?: string; type?: string }>;
  memberships?: Array<{ contactGroupMembership?: { contactGroupResourceName?: string } }>;
  userDefined?: Array<{ key?: string; value?: string }>;
};

type GooglePeopleResponse = {
  results?: Array<{ person?: GooglePerson }>;
  error?: { message?: string; code?: number; status?: string; details?: unknown[] };
};

type GoogleContactResult = {
  status: "created" | "updated" | "skipped";
  resourceName?: string;
  reason?: string;
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_PEOPLE_BASE_URL = "https://people.googleapis.com/v1";
const GOOGLE_CONTACTS_SCOPE = "https://www.googleapis.com/auth/contacts";

let tokenCache: { accessToken: string; expiresAt: number } | null = null;

class GoogleContactsApiError extends Error {
  endpoint: string;
  status: number;
  responseBody: string;

  constructor(message: string, endpoint: string, status: number, responseBody: string) {
    super(message);
    this.name = "GoogleContactsApiError";
    this.endpoint = endpoint;
    this.status = status;
    this.responseBody = responseBody;
  }
}

function getContactsConfig() {
  return {
    clientId: (process.env.GOOGLE_CONTACTS_CLIENT_ID ?? "").trim(),
    clientSecret: (process.env.GOOGLE_CONTACTS_CLIENT_SECRET ?? "").trim(),
    refreshToken: (process.env.GOOGLE_CONTACTS_REFRESH_TOKEN ?? "").trim(),
    groupId: (process.env.GOOGLE_CONTACTS_GROUP_ID ?? "").trim()
  };
}

export function isGoogleContactsConfigured() {
  const config = getContactsConfig();
  return Boolean(config.clientId && config.clientSecret && config.refreshToken);
}

function getGroupResourceName(groupId: string) {
  if (!groupId) return "";
  return groupId.startsWith("contactGroups/") ? groupId : `contactGroups/${groupId}`;
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function getGoogleContactsAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60000) {
    return tokenCache.accessToken;
  }

  const config = getContactsConfig();
  if (!isGoogleContactsConfigured()) {
    throw new Error("Google Contacts no esta configurado.");
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
      scope: GOOGLE_CONTACTS_SCOPE
    })
  });

  const body = (await response.json().catch(() => ({}))) as GoogleOAuthResponse;

  if (!response.ok || !body.access_token) {
    const message = body.error_description ?? body.error ?? "No se pudo conectar Google Contacts.";
    console.warn("Google Contacts OAuth token error", {
      endpoint: GOOGLE_TOKEN_URL,
      status: response.status,
      responseBody: safeJson(body),
      message
    });
    throw new GoogleContactsApiError(message, GOOGLE_TOKEN_URL, response.status, safeJson(body));
  }

  tokenCache = {
    accessToken: body.access_token,
    expiresAt: Date.now() + ((body.expires_in ?? 3600) * 1000)
  };

  return body.access_token;
}

async function callPeopleApi(path: string, init: RequestInit = {}) {
  const endpoint = `${GOOGLE_PEOPLE_BASE_URL}${path}`;
  const accessToken = await getGoogleContactsAccessToken();
  const response = await fetch(endpoint, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    }
  });

  const body = (await response.json().catch(() => ({}))) as GooglePeopleResponse | GooglePerson;

  if (!response.ok) {
    const message = "error" in body ? body.error?.message : "";
    const errorMessage = message || "No se pudo actualizar Google Contacts.";
    const responseBody = safeJson(body);

    console.warn("Google People API error", {
      endpoint,
      path,
      status: response.status,
      responseBody,
      message: errorMessage
    });

    throw new GoogleContactsApiError(errorMessage, endpoint, response.status, responseBody);
  }

  return body;
}

function buildContactPerson(appointment: AppointmentRow, existing?: GooglePerson): GooglePerson {
  const config = getContactsConfig();
  const groupResourceName = getGroupResourceName(config.groupId);
  const memberships = existing?.memberships ? [...existing.memberships] : [];

  if (groupResourceName && !memberships.some((membership) => membership.contactGroupMembership?.contactGroupResourceName === groupResourceName)) {
    memberships.push({ contactGroupMembership: { contactGroupResourceName: groupResourceName } });
  }

  return {
    resourceName: existing?.resourceName,
    etag: existing?.etag,
    metadata: existing?.metadata,
    names: [{
      givenName: appointment.first_name,
      familyName: appointment.last_name
    }],
    phoneNumbers: [{
      value: appointment.whatsapp,
      type: "mobile"
    }],
    ...(memberships.length > 0 ? { memberships } : {}),
    userDefined: [
      { key: "Origen", value: "Agenda Mas Sano" },
      { key: "Sucursal", value: "San Nicolás" },
      { key: "Fecha de cita", value: appointment.appointment_date },
      { key: "Hora de cita", value: appointment.appointment_time.slice(0, 5) },
      { key: "Estado", value: appointment.status }
    ]
  };
}

async function searchGoogleContactByPhone(whatsapp: string) {
  const readMask = "names,phoneNumbers,metadata,memberships,userDefined";
  await callPeopleApi(`/people:searchContacts?query=&readMask=${encodeURIComponent(readMask)}`);

  const body = await callPeopleApi(
    `/people:searchContacts?query=${encodeURIComponent(whatsapp)}&readMask=${encodeURIComponent(readMask)}`
  ) as GooglePeopleResponse;
  const targetPhone = normalizePhone(whatsapp);

  return body.results
    ?.map((result) => result.person)
    .find((person) => person?.phoneNumbers?.some((phone) => normalizePhone(phone.value ?? "") === targetPhone)) ?? null;
}

export async function upsertGoogleContact(appointment: AppointmentRow): Promise<GoogleContactResult> {
  if (!isGoogleContactsConfigured()) {
    return { status: "skipped", reason: "Google Contacts no esta configurado." };
  }

  console.info("Google Contacts service attempt started", {
    appointmentId: appointment.id,
    whatsapp: appointment.whatsapp
  });

  const existing = await searchGoogleContactByPhone(appointment.whatsapp);

  if (existing?.resourceName) {
    const person = buildContactPerson(appointment, existing);
    const updateFields = person.memberships?.length
      ? "names,phoneNumbers,userDefined,memberships"
      : "names,phoneNumbers,userDefined";
    const updated = await callPeopleApi(
      `/${existing.resourceName}:updateContact?updatePersonFields=${updateFields}&personFields=names,phoneNumbers,metadata,memberships,userDefined`,
      {
        method: "PATCH",
        body: JSON.stringify(person)
      }
    ) as GooglePerson;

    console.info("Google Contacts service result", {
      status: "updated",
      resourceName: updated.resourceName ?? existing.resourceName,
      appointmentId: appointment.id
    });

    return { status: "updated", resourceName: updated.resourceName ?? existing.resourceName };
  }

  const created = await callPeopleApi(
    "/people:createContact?personFields=names,phoneNumbers,metadata,memberships,userDefined",
    {
      method: "POST",
      body: JSON.stringify(buildContactPerson(appointment))
    }
  ) as GooglePerson;

  console.info("Google Contacts service result", {
    status: "created",
    resourceName: created.resourceName,
    appointmentId: appointment.id
  });

  return { status: "created", resourceName: created.resourceName };
}
