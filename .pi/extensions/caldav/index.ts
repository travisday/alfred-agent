/**
 * CalDAV extension for Alfred — read Apple Calendar (iCloud) and other CalDAV calendars.
 *
 * Tools: get_calendar_events, get_today_events, get_upcoming
 *
 * Required env vars:
 *   CALDAV_USERNAME - Apple ID (or CalDAV username)
 *   CALDAV_APP_PASSWORD - App-specific password
 *
 * Optional:
 *   CALDAV_SERVER_URL - defaults to https://caldav.icloud.com
 *   CALDAV_TIMEZONE - IANA zone (e.g. America/Los_Angeles) for displaying times, for
 *     "today" in get_today_events, and for interpreting date-only range strings in
 *     get_calendar_events. Defaults to America/Los_Angeles.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { createDAVClient } from "tsdav";
import ICAL from "ical.js";

const DEFAULT_SERVER = "https://caldav.icloud.com";
const DEFAULT_TIMEZONE = "America/Los_Angeles";

/** Date-only YYYY-MM-DD (no time component). */
const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD for `date` in the given IANA zone. */
function calendarDateInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * First instant (UTC) of the calendar day in `timeZone` that contains `ref`
 * (local midnight in that zone).
 */
function startOfZonedCalendarDay(ref: Date, timeZone: string): Date {
  const ymd = calendarDateInZone(ref, timeZone);
  let lo = ref.getTime() - 3 * 24 * 60 * 60 * 1000;
  let hi = ref.getTime() + 3 * 24 * 60 * 60 * 1000;
  while (calendarDateInZone(new Date(lo), timeZone) >= ymd) lo -= 24 * 60 * 60 * 1000;
  while (calendarDateInZone(new Date(hi), timeZone) < ymd) hi += 24 * 60 * 60 * 1000;
  let left = lo;
  let right = hi;
  while (right - left > 1) {
    const mid = Math.floor((left + right) / 2);
    if (calendarDateInZone(new Date(mid), timeZone) < ymd) left = mid;
    else right = mid;
  }
  return new Date(right);
}

/** Gregorian YYYY-MM-DD plus one civil day (for exclusive range ends). */
function gregorianYmdPlusOne(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const u = new Date(Date.UTC(y, m - 1, d + 1));
  return `${u.getUTCFullYear()}-${String(u.getUTCMonth() + 1).padStart(2, "0")}-${String(u.getUTCDate()).padStart(2, "0")}`;
}

/** Start of civil `ymd` (YYYY-MM-DD) in `timeZone`. */
function startOfYmdInZone(ymd: string, timeZone: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  let ref = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  for (let i = 0; i < 48; i++) {
    const c = calendarDateInZone(ref, timeZone);
    if (c === ymd) return startOfZonedCalendarDay(ref, timeZone);
    if (c < ymd) ref = new Date(ref.getTime() + 60 * 60 * 1000);
    else ref = new Date(ref.getTime() - 60 * 60 * 1000);
  }
  return startOfZonedCalendarDay(ref, timeZone);
}

function parseCalendarRangeStart(s: string, timeZone: string): Date {
  const t = s.trim();
  if (ISO_DATE_ONLY.test(t)) return startOfYmdInZone(t, timeZone);
  return new Date(s);
}

/** Exclusive end: first instant after the last included calendar day (date-only). */
function parseCalendarRangeEndExclusive(s: string, timeZone: string): Date {
  const t = s.trim();
  if (ISO_DATE_ONLY.test(t)) return startOfYmdInZone(gregorianYmdPlusOne(t), timeZone);
  return new Date(s);
}

function getConfig() {
  const username = process.env.CALDAV_USERNAME;
  const password = process.env.CALDAV_APP_PASSWORD;
  return {
    serverUrl: process.env.CALDAV_SERVER_URL ?? DEFAULT_SERVER,
    username,
    password,
    timezone: process.env.CALDAV_TIMEZONE ?? process.env.TIMEZONE ?? DEFAULT_TIMEZONE,
    configured: Boolean(username && password),
  };
}

interface ParsedEvent {
  summary: string;
  start: string;
  end: string;
  location?: string;
  calendar?: string;
  isAllDay: boolean;
}

function parseIcsEvents(icsData: string, calendarName?: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  try {
    const comp = ICAL.Component.fromString(icsData);
    const vevents = comp.getAllSubcomponents("vevent");

    for (const vevent of vevents) {
      const event = new ICAL.Event(vevent);
      const summary = event.summary ?? "(No title)";
      const start = event.startDate?.toJSDate();
      const end = event.endDate?.toJSDate();
      const isAllDay = event.startDate?.isDate ?? false;

      if (start && end) {
        events.push({
          summary,
          start: start.toISOString(),
          end: end.toISOString(),
          location: event.location ?? undefined,
          calendar: calendarName,
          isAllDay,
        });
      }
    }
  } catch {
    // Skip malformed ICS
  }
  return events;
}

async function fetchEvents(
  start: Date,
  end: Date,
  maxEvents?: number
): Promise<ParsedEvent[]> {
  const config = getConfig();
  if (!config.configured) {
    throw new Error(
      "CalDAV not configured. Set CALDAV_USERNAME and CALDAV_APP_PASSWORD."
    );
  }

  const padMs = 24 * 60 * 60 * 1000;
  const queryStart = new Date(start.getTime() - padMs);
  const queryEnd = new Date(end.getTime() + padMs);

  const client = await createDAVClient({
    serverUrl: config.serverUrl,
    credentials: {
      username: config.username!,
      password: config.password!,
    },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });

  const calendars = await client.fetchCalendars();
  const allEvents: ParsedEvent[] = [];

  for (const cal of calendars) {
    const baseOpts = {
      calendar: cal,
      timeRange: { start: queryStart.toISOString(), end: queryEnd.toISOString() },
      useMultiGet: false as const,
      urlFilter: () => true, // iCloud may use URLs without .ics suffix
    };
    let objects;
    try {
      objects = await client.fetchCalendarObjects({
        ...baseOpts,
        expand: true,
      });
    } catch {
      objects = await client.fetchCalendarObjects({
        ...baseOpts,
        expand: false,
      });
    }

    for (const obj of objects) {
      const data = typeof obj.data === "string" ? obj.data : String(obj.data ?? "");
      if (data) {
        const parsed = parseIcsEvents(data, cal.displayName ?? cal.url);
        allEvents.push(...parsed);
      }
    }
  }

  allEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const startMs = start.getTime();
  const endMs = end.getTime();
  const inRange = allEvents.filter((e) => {
    const t = new Date(e.start).getTime();
    return t >= startMs && t < endMs;
  });

  if (maxEvents !== undefined && maxEvents > 0) {
    return inRange.slice(0, maxEvents);
  }
  return inRange;
}

function formatEvents(events: ParsedEvent[], displayTimeZone: string): string {
  if (events.length === 0) return "No events found.";

  const localeOpts = { timeZone: displayTimeZone } as const;
  const lines = events.map((e) => {
    const startDt = new Date(e.start);
    const endDt = new Date(e.end);
    const timeStr = e.isAllDay
      ? "All day"
      : `${startDt.toLocaleTimeString("en-US", { ...localeOpts, hour: "numeric", minute: "2-digit" })} - ${endDt.toLocaleTimeString("en-US", { ...localeOpts, hour: "numeric", minute: "2-digit" })}`;
    const dateStr = startDt.toLocaleDateString("en-US", {
      ...localeOpts,
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const loc = e.location ? ` @ ${e.location}` : "";
    return `- ${dateStr} ${timeStr}: ${e.summary}${loc}`;
  });
  return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
  const config = getConfig();
  if (!config.configured) {
    pi.on("session_start", async (_event, ctx) => {
      ctx.ui.notify(
        "CalDAV extension loaded but not configured. Set CALDAV_USERNAME and CALDAV_APP_PASSWORD.",
        "warn"
      );
    });
  }

  pi.registerTool({
    name: "get_calendar_events",
    label: "Get Calendar Events",
    description:
      "Fetch calendar events for a date range. Use for any date-based calendar query.",
    promptSnippet:
      "get_calendar_events: Fetch events from Apple/CalDAV calendar for a date range",
    parameters: Type.Object({
      startDate: Type.String({
        description:
          "Start: ISO 8601 instant, or date-only YYYY-MM-DD (start of that day in CALDAV_TIMEZONE)",
      }),
      endDate: Type.String({
        description:
          "End: ISO 8601 instant (exclusive when using half-open range), or date-only YYYY-MM-DD (exclusive end is start of the next calendar day in CALDAV_TIMEZONE)",
      }),
    }),
    async execute(_toolCallId, params) {
      const tz = getConfig().timezone;
      const start = parseCalendarRangeStart(params.startDate, tz);
      const end = parseCalendarRangeEndExclusive(params.endDate, tz);
      const events = await fetchEvents(start, end);
      return {
        content: [{ type: "text", text: formatEvents(events, tz) }],
        details: { count: events.length },
      };
    },
  });

  pi.registerTool({
    name: "get_today_events",
    label: "Get Today's Events",
    description: "Fetch all calendar events for today. Shorthand for today's schedule.",
    promptSnippet:
      "get_today_events: Fetch today's events from Apple/CalDAV calendar",
    parameters: Type.Object({}),
    async execute() {
      const now = new Date();
      const tz = getConfig().timezone;
      const start = startOfZonedCalendarDay(now, tz);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      const events = await fetchEvents(start, end);
      return {
        content: [{ type: "text", text: formatEvents(events, tz) }],
        details: { count: events.length },
      };
    },
  });

  pi.registerTool({
    name: "get_upcoming",
    label: "Get Upcoming Events",
    description:
      "Fetch the next N calendar events across upcoming days. Use for 'what's coming up' queries.",
    promptSnippet:
      "get_upcoming: Fetch the next N events from Apple/CalDAV calendar",
    parameters: Type.Object({
      count: Type.Optional(
        Type.Number({
          description: "Maximum number of events to return (default 10)",
          default: 10,
        })
      ),
    }),
    async execute(_toolCallId, params) {
      const count = params.count ?? 10;
      const now = new Date();
      const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // ~30 days
      const events = await fetchEvents(now, end, count);
      const tz = getConfig().timezone;
      return {
        content: [{ type: "text", text: formatEvents(events, tz) }],
        details: { count: events.length },
      };
    },
  });
}
