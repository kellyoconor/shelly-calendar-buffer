import { google } from "googleapis";

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
  SOURCE_CALENDAR_ID,
  SOURCE_CALENDAR_NAME,
  LOOKAHEAD_DAYS = "30",
  SYNC_WINDOW_DAYS_PAST = "7",
  SANITIZE_MODE = "busy",
} = process.env;

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing required env var: ${name}`);
}

function isoDaysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function sanitizeTitle(srcEvent) {
  if (SANITIZE_MODE === "busy") return "Busy";
  const text = `${srcEvent.summary || ""} ${srcEvent.description || ""}`.toLowerCase();
  if (/(run|workout|gym|yoga|pilates|spin)/.test(text)) return "Workout";
  if (/(flight|airport|train|hotel|travel)/.test(text)) return "Travel";
  if (/(dinner|date|drinks|brunch|party)/.test(text)) return "Social";
  if (/(dentist|doctor|pt|therapy|appointment)/.test(text)) return "Health";
  if (/(work|meeting|sync|review|interview)/.test(text)) return "Work";
  return "Personal";
}

function sanitizedEventBody(srcEvent) {
  return {
    summary: `[BUF] ${sanitizeTitle(srcEvent)}`,
    start: srcEvent.start,
    end: srcEvent.end,
    visibility: "private",
    description: "",
    location: "",
    attendees: [],
    reminders: { useDefault: false },
    extendedProperties: {
      private: { sourceEventId: srcEvent.id }
    }
  };
}

async function getAuthClient() {
  requireEnv("GOOGLE_CLIENT_ID", GOOGLE_CLIENT_ID);
  requireEnv("GOOGLE_CLIENT_SECRET", GOOGLE_CLIENT_SECRET);
  requireEnv("GOOGLE_REFRESH_TOKEN", GOOGLE_REFRESH_TOKEN);

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return oauth2Client;
}

async function resolveSourceCalendarId(calendar) {
  if (SOURCE_CALENDAR_ID) return SOURCE_CALENDAR_ID;
  requireEnv("SOURCE_CALENDAR_NAME", SOURCE_CALENDAR_NAME);

  const list = await calendar.calendarList.list({ maxResults: 250 });
  const match = (list.data.items || []).find((c) =>
    (c.summary || "").toLowerCase().includes(SOURCE_CALENDAR_NAME.toLowerCase())
  );

  if (!match?.id) {
    const summaries = (list.data.items || [])
      .map((c) => `- ${c.summary} (${c.id})`)
      .join("\n");
    throw new Error(
      `Could not find calendar matching SOURCE_CALENDAR_NAME="${SOURCE_CALENDAR_NAME}".\n` +
      `Calendars visible to Shelly:\n${summaries}`
    );
  }

  console.log(`Resolved source calendar: ${match.summary} -> ${match.id}`);
  return match.id;
}

async function main() {
  const auth = await getAuthClient();
  const calendar = google.calendar({ version: "v3", auth });

  const timeMin = isoDaysFromNow(-parseInt(SYNC_WINDOW_DAYS_PAST, 10));
  const timeMax = isoDaysFromNow(parseInt(LOOKAHEAD_DAYS, 10));

  const sourceCalId = await resolveSourceCalendarId(calendar);

  const resp = await calendar.events.list({
    calendarId: sourceCalId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 2500
  });

  const sourceEvents = (resp.data.items || []).filter(e => e.status !== "cancelled");

  for (const e of sourceEvents) {
    if (!e.start || !e.end) continue;

    await calendar.events.insert({
      calendarId: "primary",
      requestBody: sanitizedEventBody(e)
    });
  }

  console.log(`Synced ${sourceEvents.length} events.`);
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
