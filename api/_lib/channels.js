// api/_lib/channels.js — honest per-channel deployment status for a business.

export function channelStatus(biz) {
  const ch = biz.channels || {};
  const origin = process.env.PUBLIC_ORIGIN || 'https://www.squadron.tel';
  return {
    phone: biz.phone_number
      ? { state: 'live', label: `Live on ${biz.phone_number}`, detail: 'Inbound calls are answered by your team. The AI identifies itself and every call starts with a recording notice.' }
      : { state: 'ready', label: 'No number yet', detail: 'Pick a local number below and your team answers it at once. The line rental is $1.15 a month, taken from your prepaid balance, and call minutes count against your plan.' },
    chat: ch.chat && ch.chat.enabled
      ? { state: 'live', label: 'Live', detail: 'The chat widget answers on any page that includes the snippet below.', snippet: `<script src="${origin}/widget.js" data-business="${biz.id}" async></script>` }
      : { state: 'ready', label: 'Ready to turn on', detail: 'Turn chat on, then paste one line into your site.', snippet: `<script src="${origin}/widget.js" data-business="${biz.id}" async></script>` },
    email: { state: 'unavailable', label: 'Not yet available', detail: 'Email answering is not available yet. It will appear here with its own status when it is.' },
    sms: { state: 'unavailable', label: 'Not yet available', detail: 'Text messaging is not available yet. It will appear here with its own status when it is.' },
  };
}
