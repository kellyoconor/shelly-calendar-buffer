import { google } from "googleapis";

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
  SOURCE_CALENDAR_NAME,
  LOOKAHEAD_DAYS = "45"
} = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN || !SOURCE_CALENDAR_NAME) {
  throw new Error("Missing required environment variables.");
}

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET
);

oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

const calendar = google.calendar({
  version: "v3",
  auth: oauth2Client
});

function minutesBetween(start, end) {
  return Math.round((new Date(end) - new Date(start)) / 60000);
}

function formatDuration(minutes, isAllDay) {
  if (isAllDay) return "All Day";
  if (minutes < 60) return `${minutes}m`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function categorize(event) {
  const title = (event.summary || "").toLowerCase();
  const start = new Date(event.start.dateTime || event.start.date);
  const end = new Date(event.end.dateTime || event.end.date);

  const isAllDay = !!event.start.date;
  const duration = minutesBetween(start, end);
  const day = start.getDay(); // 0 Sunday, 6 Saturday
  const hour = start.getHours();

  const durationLabel = ` · ${formatDuration(duration, isAllDay)}`;

  // ⚡ Workout
  if (/(run|workout|gym|yoga|pilates|spin|lift|pt)/.test(title)) {
    if (hour < 9) return `🌅 Workout${durationLabel}`;
    if (hour >= 17) return `🌙 Workout${durationLabel}`;
    return `⚡ Workout${durationLabel}`;
  }

  // ✈ Travel
  if (/(flight|airport|train|hotel|travel|uber|lyft)/.test(title)) {
    return `✈ Travel${durationLabel}`;
  }

  // 🍷 Social
  if (/(dinner|drinks|date|brunch|happy hour|party)/.test(title)) {
    if (day === 0 || day === 6) {
      return `🍷 Weekend Social${durationLabel}`;
    }
    return `🍷 Social${durationLabel}`;
  }

  // 🩺 Health
  if (/(doctor|dentist|ortho|therapy|appointment)/.test(title)) {
    return `🩺 Health${durationLabel}`;
  }

  // 🧠 Work
  if (/(meeting|call|sync|1:1|review|interview)/.test(title)) {
    return `🧠 Meetings${durationLabel}`;
  }

  if (day >= 1 && day <= 5 && duration >= 120 && hour >= 9 && hour <= 17) {
    return `🧠 Deep Work${durationLabel}`;
  }

  return `🌿 Personal${durationLabel}`;
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
    calendars.forEach((c) => console.log(`- ${c.summary} (${c.id})`));
    throw new Error(`Could not find calendar matching SOURCE_CALENDAR_NAME`);
  }

  return match.id;
}

async function getExistingBufferEvents(timeMin, timeMax) {
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
    if (sourceId) map.set(sourceId, ev);
  }
  return map;
}

function buildBufferEvent(src) {
  return {
    summary: categorize(src),
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

async function main() {
  const sourceCalendarId = await resolveSourceCalendarId();

  const timeMin = new Date().toISOString();
  const timeMax = isoDaysFromNow(parseInt(LOOKAHEAD_DAYS, 10));

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

    if (
      existing.summary !== desired.summary ||
      JSON.stringify(existing.start) !== JSON.stringify(desired.start) ||
      JSON.stringify(existing.end) !== JSON.stringify(desired.end)
    ) {
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

  console.log(`Done. created=${created} updated=${updated} unchanged=${unchanged}`);
}

await main();
