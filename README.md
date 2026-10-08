# Squadron

Squadron (squadron.tel) builds a customer-service team from a business's website, App Store listing, or documents, lets the owner test it by chat, voice and phone, and deploys it to phone and chat with honest per-channel status. Everything the team says comes from the Business Profile, with a source on every field.

## Layout

- `index.html` — homepage. `start.html`, `team.html`, `test.html`, `deploy.html`, `hq.html` — the onboarding flow and Squadron HQ. `onboard.css` — shared styles. `widget.js` — the public chat widget.
- `api/` — Vercel functions. `api/_lib/` holds shared code (database, crawling, profile extraction, team generation, the grounded answering engine, voice session builder, auth, usage).
- `api/bridge/` — endpoints the phone bridge calls (number lookup, session, tool events, call storage, recording callback).
- `bridge/` — the phone bridge service (Twilio Media Streams to OpenAI Realtime). It runs on an always-on host, not on Vercel, and is excluded from the Vercel deploy by `.vercelignore`.

## Environment (Vercel project `squadron-tel`)

`OPENAI_API_KEY`, `DATABASE_URL` (Neon), `SESSION_SECRET`, `BRIDGE_SECRET`, `BLOB_READ_WRITE_TOKEN`, and for phone: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`. Optional: `PROFILE_MODEL`, `CHAT_MODEL`, `REALTIME_MODEL`, `PUBLIC_ORIGIN`.

## Phone bridge

Deploy `bridge/` as a Node service with these variables: `OPENAI_API_KEY`, `BRIDGE_SECRET` (same value as Vercel), `SQUADRON_ORIGIN=https://squadron.tel`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `PUBLIC_HOST` (the service's public hostname). Point each Twilio number's voice webhook at `https://<PUBLIC_HOST>/twilio/voice` (POST). Pool numbers for demos go into the `demo_numbers` table (`INSERT INTO demo_numbers (number) VALUES ('+1...')`).

### Cloudflare Workers (free plan)

`bridge/worker.js` and `bridge/wrangler.toml` run the same bridge on Workers with a Durable Object per call. From `bridge/`: `npx wrangler deploy`, then `npx wrangler secret put` for `BRIDGE_SECRET`, `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`. The worker does not need `OPENAI_API_KEY`, because Squadron issues a short-lived OpenAI key for each call. The voice webhook is `https://squadron-bridge.<account>.workers.dev/twilio/voice`.

## Compliance defaults

The AI identifies itself at the start of every conversation, every call starts with an audible recording notice, and Squadron answers inbound conversations only.

## Frontdesk and Switchboard

Squadron sells two editions on one engine, one database and one set of plans:

- **Frontdesk**: an AI receptionist. Calls that need a person go to one on-call number (`settings.on_call_phone`).
- **Switchboard**: an AI operator. `settings.directory` lists departments and people (name, what they handle, phone, email); the team routes each caller to an entry (`transfer_to` in the reply schema), phone calls dial that entry's number, and messages are emailed to it. Numbers and emails are never given to the model. See `api/_lib/directory.js`.

`settings.edition` records which one a business uses (setup suggests Switchboard for hotels; owners can switch), and `settings.brand` records which product they signed up through.

### Running them as separate websites

`brands.js` decides the brand a visitor sees (name, accent colour, wording) from the domain, then `?brand=`, then the landing page (`/frontdesk`, `/switchboard`). Setup, HQ and the chat widget footer use it. To give Frontdesk or Switchboard its own domain:

1. Add the domain to the brand's `domains` list in `brands.js`.
2. Add the domain to the Vercel project.
3. Add a route so the domain's home page is the landing page, for example in `vercel.json` routes, before `"/"`: `{ "src": "/", "has": [{ "type": "host", "value": "switchboard.example" }], "dest": "/switchboard.html" }`.

Accounts, billing and the database stay shared. Emails still say Squadron and need the same brand treatment before a fully separate launch.
