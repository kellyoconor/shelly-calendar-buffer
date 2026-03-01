import { google } from "googleapis";
import open from "open";
import http from "http";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

const REDIRECT_URI = "http://localhost:3000/oauth2callback";

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events"
];

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET env vars.");
    process.exit(1);
  }

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });

  console.log("Opening browser for authorization...");
  await open(authUrl);

  http
    .createServer(async (req, res) => {
      if (req.url.includes("/oauth2callback")) {
        const qs = new URL(req.url, "http://localhost:3000").searchParams;
        const code = qs.get("code");

        res.end("Authorization successful! You can close this tab.");

        const { tokens } = await oauth2Client.getToken(code);

        console.log("\n=== REFRESH TOKEN ===\n");
        console.log(tokens.refresh_token);
        console.log("\nSave this in GitHub Secrets as GOOGLE_REFRESH_TOKEN\n");

        process.exit();
      }
    })
    .listen(3000);
}

main();
