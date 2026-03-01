import { google } from "googleapis";

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
  SOURCE_CALENDAR_NAME,
  LOOKAHEAD_DAYS = "45"
} = process.env;

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
}

requireEnv("GOOGLE_CLIENT_ID", GOOGLE_CLIENT_ID);
requireEnv("GOOGLE_CLIENT_SECRET", GOOGLE_CLIENT_SECRET);
requireEnv("GOOGLE_REFRESH_TOKEN", GOOGLE_REFRESH_TOKEN);
requireEnv("SOURCE_CALENDAR_NAME", SOURCE_CALENDAR_NAME);

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET
);
oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

const calendar = google.calendar({ version: "v3", auth: oauth2Client });

function categorize(title = "") {
  const t = title.toLowerCase();

  if (/(run|workout|gym|yoga|pilates|spin|lift|pt)/.test(t)) return "Workout";
  if (/(flight|airport|train|hotel|travel|uber|lyft)/.test(t)) return "Travel";
  if (/(dinner|drinks|date|brunch|happy hour|party)/.test(t)) return "Social";
  if (/(doctor|dentist|ortho|therapy|appointment)/.test(t)) return "Health";
  if (/(meeting|call|sync|1:1|review|interview|work)/.test(t)) return "Work";

  return "Personal";
}

function isoDaysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

async function resolveSourceCalendarId() {
  const res = await calendar.calendarList.list({ maxResults: 250 });
  const calendars = res.data.items || [];

  const match = calendars.find(
    (c) => (c.summary || "").toLowerCase() === SOURCE_CALENDAR_NAME.toLowerCase()
  );

  if (!match) {
    console.log("Calendars visible to Shelly:");
    calendars.forEach((c) => console.log(`- ${c.summary} (${c.id})`));
    throw new Error(
      `Could not find calendar matching SOURCE_CALENDAR_NAME="${SOURCE_CALENDAR_NAME}"`
    );
  }

  console.log(`Resolved source calendar: ${match.summary} -> ${match.id}`);
  return match.id;
}

async function getExistingBufferEvents(timeMin, timeMax) {
  // Only fetch existing buffer events in the window (fast)
  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 2500
  });

  const map = new Map();
  for (const ev of res.data.items || []) {
    const sourceId = ev.extendedProperties?.private?.sourceEventId;
    const summary = ev.summary || "";
    if (sourceId && summary.startsWith("[BUF]")) {
      map.set(sourceId, ev);
    }
  }
  return map;
}

function buildBufferEvent(src) {
  const category = categorize(src.summary || "");

  return {
    summary: `[BUF] ${category}`,
    start: src.start,
    end: src.end,
    visibility: "private",
    description: "",
    location: "",
    attendees: [],
    reminders: { useDefault: false },
    extendedProperties: {
      private: { sourceEventId: src.id }
    }
  };
}

function needsUpdate(existing, desired) {
  // Compare only what we control
  const a = {
    summary: existing.summary || "",
    start: JSON.stringify(existing.start || {}),
    end: JSON.stringify(existing.end || {}),
    visibility: existing.visibility || "",
    sourceEventId: existing.extendedProperties?.private?.sourceEventId || ""
  };

  const b = {
    summary: desired.summary || "",
    start: JSON.stringify(desired.start || {}),
    end: JSON.stringify(desired.end || {}),
    visibility: desired.visibility || "",
    sourceEventId: desired.extendedProperties?.private?.sourceEventId || ""
  };

  return (
    a.summary !== b.summary ||
    a.start !== b.start ||
    a.end !== b.end ||
    a.visibility !== b.visibility ||
    a.sourceEventId !== b.sourceEventId
  );
}

async function main() {
  const sourceCalendarId = await resolveSourceCalendarId();

  const timeMin = new Date().toISOString();
  const timeMax = isoDaysFromNow(parseInt(LOOKAHEAD_DAYS, 10));

  // Pull source events ONLY in the window
  const sourceRes = await calendar.events.list({
    calendarId: sourceCalendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 2500
  });

  const sourceEvents = (sourceRes.data.items || []).filter(
    (e) => e.status !== "cancelled" && e.start && e.end
  );

  const existingMap = await getExistingBufferEvents(timeMin, timeMax);

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const src of sourceEvents) {
    const desired = buildBufferEvent(src);
    const existing = existingMap.get(src.id);

    if (!existing) {
      await calendar.events.insert({
        calendarId: "primary",
        requestBody: desired
      });
      created++;
      continue;
    }

    if (needsUpdate(existing, desired)) {
      await calendar.events.patch({
        calendarId: "primary",
        eventId: existing.id,
        requestBody: desired
      });
      updated++;
    } else {
      unchanged++;
    }
  }

  console.log(
    `Done. window=${LOOKAHEAD_DAYS}d created=${created} updated=${updated} unchanged=${unchanged} source=${sourceEvents.length}`
  );
}

await main();
