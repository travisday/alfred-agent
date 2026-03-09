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
 *   CALDAV_TIMEZONE - defaults to America/Los_Angeles
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { createDAVClient } from "tsdav";
import ICAL from "ical.js";

const DEFAULT_SERVER = "https://caldav.icloud.com";
const DEFAULT_TIMEZONE = "America/Los_Angeles";

function getConfig() {
  const username = process.env.CALDAV_USERNAME;
  const password = process.env.CALDAV_APP_PASSWORD;
  return {
    serverUrl: process.env.CALDAV_SERVER_URL ?? DEFAULT_SERVER,
    username,
    password,
    timezone: process.env.CALDAV_TIMEZONE ?? DEFAULT_TIMEZONE,
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
    const objects = await client.fetchCalendarObjects({
      calendar: cal,
      timeRange: { start: start.toISOString(), end: end.toISOString() },
      useMultiGet: false,
      urlFilter: () => true, // iCloud may use URLs without .ics suffix
    });

    for (const obj of objects) {
      const data = typeof obj.data === "string" ? obj.data : String(obj.data ?? "");
      if (data) {
        const parsed = parseIcsEvents(data, cal.displayName ?? cal.url);
        allEvents.push(...parsed);
      }
    }
  }

  allEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  if (maxEvents !== undefined && maxEvents > 0) {
    return allEvents.slice(0, maxEvents);
  }
  return allEvents;
}

function formatEvents(events: ParsedEvent[]): string {
  if (events.length === 0) return "No events found.";

  const lines = events.map((e) => {
    const startDt = new Date(e.start);
    const endDt = new Date(e.end);
    const timeStr = e.isAllDay
      ? "All day"
      : `${startDt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} - ${endDt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
    const dateStr = startDt.toLocaleDateString("en-US", {
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
        description: "Start date in ISO 8601 format (e.g. 2025-03-08)",
      }),
      endDate: Type.String({
        description: "End date in ISO 8601 format (e.g. 2025-03-15)",
      }),
    }),
    async execute(_toolCallId, params) {
      const start = new Date(params.startDate);
      const end = new Date(params.endDate);
      const events = await fetchEvents(start, end);
      return {
        content: [{ type: "text", text: formatEvents(events) }],
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
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      const events = await fetchEvents(start, end);
      return {
        content: [{ type: "text", text: formatEvents(events) }],
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
      return {
        content: [{ type: "text", text: formatEvents(events) }],
        details: { count: events.length },
      };
    },
  });
}
