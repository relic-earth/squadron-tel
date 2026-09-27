# Squadron phone bridge

This Cloudflare Worker (squadron-bridge) connects Twilio Media Streams to the OpenAI Realtime API.

Cloudflare Workers Builds deploys it from the main branch of relic-earth/squadron-tel, with /bridge as the root directory. The deploy command is `npx wrangler deploy`, which reads wrangler.toml in this folder.

Secrets are stored in the worker settings: BRIDGE_SECRET, TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN. The worker needs no OpenAI key, because /api/bridge/session on squadron.tel issues a short-lived key for each call.

Health check: GET /health returns ok.

Twilio voice webhook: POST /twilio/voice.

Security: /twilio/voice rejects any request without a valid X-Twilio-Signature, which is checked with TWILIO_AUTH_TOKEN. The voice webhook then signs a short-lived stream ticket with BRIDGE_SECRET, and /media opens an AI session only when that ticket is valid, so nobody can start a call session by connecting to /media directly.

## Current wiring (Sept 27 2026)

Twilio numbers point at https://www.squadron.tel/api/bridge/voice, not at the worker. Squadron checks Twilio's signature, finds the business, places the prepaid hold and returns TwiML that streams the call to wss://BRIDGE_HOST/media with a signed ticket. Recording, transfer and hang-up go through /api/bridge/twilio, and Deepgram voices go through /api/bridge/speak. The worker therefore needs only one secret, BRIDGE_SECRET, which must match Squadron's. Set BRIDGE_HOST in Vercel to the worker's host name.
