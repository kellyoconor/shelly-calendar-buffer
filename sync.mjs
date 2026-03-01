import { google } from "googleapis";

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
  SOURCE_CALENDAR_NAME
} = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN || !SOURCE_CALENDAR_NAME) {
  throw new Error("Missing required environment variables.");
}

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET
);

oauth2Client.setCredentials({
  refresh_token: GOOGLE_REFRESH_TOKEN
});

const calendar = google.calendar({
  version: "v3",
  auth: oauth2Client
});

function categorize(title = "") {
  const text = title.toLowerCase();

  if (text.includes("run") || text.includes("workout") || text.includes("gym")) {
    return "Workout";
  }
  if (text.includes("flight") || text.includes("travel") || text.includes("airport")) {
    return "Travel";
  }
  if (text.includes("dinner") || text.includes("drinks") || text.includes("party")) {
    return "Social";
  }
  if (text.includes("doctor") || text.includes("dentist")) {
    return "Health";
  }
  if (text.includes("meeting") || text.includes("call")) {
    return "Work";
  }

  return "Personal";
}

async function resolveSourceCalendarId() {
  const res = await calendar.calendarList.list();
  const calendars = res.data.items || [];

  const match = calendars.find(
    c => c.summary === SOURCE_CALENDAR_NAME
  );

  if (!match) {
    console.log("Calendars visible to Shelly:");
    calendars.forEach(c => console.log(`- ${c.summary} (${c.id})`));
    throw new Error(`Could not find calendar matching SOURCE_CALENDAR_NAME="${SOURCE_CALENDAR_NAME}"`);
  }

  console.log(`Resolved source calendar: ${match.summary} -> ${match.id}`);
  return match.id;
}

async function getExistingBufferEvents() {
  const res = await calendar.events.list({
    calendarId: "primary",
    maxResults: 2500,
    singleEvents: true
  });

  const events = res.data.items || [];

  const map = new Map();

  for (const ev of events) {
    if (ev.extendedProperties?.private?.sourceEventId) {
      map.set(ev.extendedProperties.private.sourceEventId, ev);
    }
  }

  return map;
}

async function sync() {
  const sourceCalendarId = await resolveSourceCalendarId();

  const sourceEventsRes = await calendar.events.list({
    calendarId: sourceCalendarId,
    maxResults: 2500,
    singleEvents: true
  });

  const sourceEvents = sourceEventsRes.data.items || [];
  const existingMap = await getExistingBufferEvents();

  let created = 0;
  let updated = 0;

  for (const src of sourceEvents) {
    if (!src.start || !src.end) continue;

    const category = categorize(src.summary || "");

    const bufferEvent = {
      summary: `[BUF] ${category}`,
      start: src.start,
      end: src.end,
      extendedProperties: {
        private: {
          sourceEventId: src.id
        }
      }
    };

    const existing = existingMap.get(src.id);

    if (existing) {
      await calendar.events.update({
        calendarId: "primary",
        eventId: existing.id,
        requestBody: bufferEvent
      });
      updated++;
    } else {
      await calendar.events.insert({
        calendarId: "primary",
        requestBody: bufferEvent
      });
      created++;
    }
  }

  console.log(`Created ${created} events.`);
  console.log(`Updated ${updated} events.`);
}

await sync();
