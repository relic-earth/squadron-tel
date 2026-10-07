// /api/voice.js — old Twilio voice webhook address. Every Squadron number now
// points at /api/bridge/voice, which answers with the business's own AI team
// and transfers only to that business's on-call number. Any number still set
// to this address is sent there, so no call reaches a placeholder line.
export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/xml');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">/api/bridge/voice</Redirect></Response>');
}
