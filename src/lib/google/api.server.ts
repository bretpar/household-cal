/**
 * Thin Google Calendar API client that routes every call through the Lovable
 * connector gateway on behalf of the household's connected Google account.
 *
 * Server-only. The connection key and the workspace token never reach the
 * browser; callers get plain data back.
 */
import { callAsAppUser } from "@/integrations/lovable/appUserConnector";
import type { GoogleEvent } from "@/lib/google/mapping";

export const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";
export const CONNECTOR_ID = "google_calendar";
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/calendar",
];

/** Raised when Google/the gateway says the connection is no longer usable. */
export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

async function call<T>(
  connectionAPIKey: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await callAsAppUser({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectionAPIKey,
    connectorId: CONNECTOR_ID,
    path,
    init,
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new GoogleAuthError(`Google rejected the connection (${res.status}): ${text}`);
    }
    throw new Error(`Google Calendar request failed [${res.status}] ${path}: ${text}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

function json(body: unknown): RequestInit {
  return { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export interface GoogleCalendarSummary {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
}

export async function getAccountEmail(connectionAPIKey: string): Promise<string | null> {
  const cal = await call<{ id?: string }>(connectionAPIKey, "/calendar/v3/calendars/primary");
  return cal.id ?? null;
}

export async function listCalendars(connectionAPIKey: string): Promise<GoogleCalendarSummary[]> {
  const res = await call<{ items?: GoogleCalendarSummary[] }>(
    connectionAPIKey,
    "/calendar/v3/users/me/calendarList?minAccessRole=writer&maxResults=250",
  );
  return res.items ?? [];
}

export async function createCalendar(
  connectionAPIKey: string,
  summary: string,
): Promise<GoogleCalendarSummary> {
  return call<GoogleCalendarSummary>(connectionAPIKey, "/calendar/v3/calendars", {
    method: "POST",
    ...json({ summary }),
  });
}

export async function renameCalendar(
  connectionAPIKey: string,
  calendarId: string,
  summary: string,
): Promise<void> {
  await call(connectionAPIKey, `/calendar/v3/calendars/${encodeURIComponent(calendarId)}`, {
    method: "PATCH",
    ...json({ summary }),
  });
}

export async function insertEvent(
  connectionAPIKey: string,
  calendarId: string,
  body: Record<string, unknown>,
): Promise<GoogleEvent> {
  return call<GoogleEvent>(
    connectionAPIKey,
    `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: "POST", ...json(body) },
  );
}

export async function patchEvent(
  connectionAPIKey: string,
  calendarId: string,
  eventId: string,
  body: Record<string, unknown>,
): Promise<GoogleEvent> {
  return call<GoogleEvent>(
    connectionAPIKey,
    `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "PATCH", ...json(body) },
  );
}

export async function getEvent(
  connectionAPIKey: string,
  calendarId: string,
  eventId: string,
): Promise<GoogleEvent> {
  return call<GoogleEvent>(
    connectionAPIKey,
    `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
  );
}

export async function deleteEvent(
  connectionAPIKey: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const res = await callAsAppUser({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectionAPIKey,
    connectorId: CONNECTOR_ID,
    path: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    init: { method: "DELETE" },
  });
  // 404/410 means it is already gone on Google's side, which is the goal.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const text = await res.text();
    if (res.status === 401 || res.status === 403) throw new GoogleAuthError(text);
    throw new Error(`Google event delete failed [${res.status}]: ${text}`);
  }
}

export async function moveEvent(
  connectionAPIKey: string,
  fromCalendarId: string,
  eventId: string,
  toCalendarId: string,
): Promise<GoogleEvent> {
  return call<GoogleEvent>(
    connectionAPIKey,
    `/calendar/v3/calendars/${encodeURIComponent(fromCalendarId)}/events/${encodeURIComponent(eventId)}/move?destination=${encodeURIComponent(toCalendarId)}`,
    { method: "POST" },
  );
}

export interface ListEventsResult {
  items: GoogleEvent[];
  nextSyncToken?: string;
  invalidSyncToken?: boolean;
}

/**
 * Incremental list when a sync token exists, otherwise a windowed full list.
 * An expired token is reported back so the caller can fall back to a full pass.
 */
export async function listEvents(
  connectionAPIKey: string,
  calendarId: string,
  opts: { syncToken?: string | null; timeMin?: string; timeMax?: string },
): Promise<ListEventsResult> {
  const base = `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const items: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;

  do {
    const params = new URLSearchParams({ maxResults: "250", showDeleted: "true" });
    if (opts.syncToken) params.set("syncToken", opts.syncToken);
    else {
      params.set("singleEvents", "false");
      if (opts.timeMin) params.set("timeMin", opts.timeMin);
      if (opts.timeMax) params.set("timeMax", opts.timeMax);
    }
    if (pageToken) params.set("pageToken", pageToken);

    const res = await callAsAppUser({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectionAPIKey,
      connectorId: CONNECTOR_ID,
      path: `${base}?${params.toString()}`,
    });
    const text = await res.text();
    if (res.status === 410) return { items: [], invalidSyncToken: true };
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new GoogleAuthError(text);
      throw new Error(`Google event list failed [${res.status}]: ${text}`);
    }
    const body = JSON.parse(text || "{}") as {
      items?: GoogleEvent[];
      nextPageToken?: string;
      nextSyncToken?: string;
    };
    items.push(...(body.items ?? []));
    pageToken = body.nextPageToken;
    nextSyncToken = body.nextSyncToken ?? nextSyncToken;
  } while (pageToken);

  return nextSyncToken ? { items, nextSyncToken } : { items };
}

export interface WatchResult {
  id: string;
  resourceId: string;
  expiration?: string;
}

/** Registers a Google push channel so external edits arrive almost instantly. */
export async function watchCalendar(
  connectionAPIKey: string,
  calendarId: string,
  channelId: string,
  address: string,
  token: string,
): Promise<WatchResult> {
  return call<WatchResult>(
    connectionAPIKey,
    `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/watch`,
    { method: "POST", ...json({ id: channelId, type: "web_hook", address, token }) },
  );
}

export async function stopChannel(
  connectionAPIKey: string,
  channelId: string,
  resourceId: string,
): Promise<void> {
  const res = await callAsAppUser({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectionAPIKey,
    connectorId: CONNECTOR_ID,
    path: "/calendar/v3/channels/stop",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: channelId, resourceId }),
    },
  });
  if (!res.ok && res.status !== 404) {
    console.error(`Google channel stop failed [${res.status}]: ${await res.text()}`);
  }
}
