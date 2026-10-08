// api/_lib/directory.js — the Switchboard directory. A business can list the
// departments and people calls should reach (front desk, reservations,
// accounts payable, "Sarah in HR"), each with a phone number for transfers
// and an email for messages. The team routes each caller to the right entry.
// Frontdesk businesses leave it empty and use the single on-call contact.

export const EDITIONS = {
  frontdesk: { key: 'frontdesk', name: 'Frontdesk', line: 'An AI receptionist for your business.' },
  switchboard: { key: 'switchboard', name: 'Switchboard', line: 'An AI operator that puts every caller through to the right department or person.' },
};

// Kinds of business that usually need a switchboard: several departments
// answering one main number.
export const SWITCHBOARD_KINDS = new Set(['hotel']);

export function editionOf(settings) {
  const e = settings && settings.edition;
  if (EDITIONS[e]) return e;
  return directoryOf(settings).length ? 'switchboard' : 'frontdesk';
}

const clean = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const digits = (v) => String(v || '').replace(/[^\d+]/g, '');

// Validates and normalises a directory from the browser. Entries without a
// name are dropped; a phone needs at least 10 digits to be dialled.
export function cleanDirectory(list) {
  const out = [];
  for (const x of Array.isArray(list) ? list.slice(0, 40) : []) {
    const name = clean(x && x.name, 80);
    if (!name) continue;
    const phone = clean(x.phone, 40);
    const email = clean(x.email, 200);
    out.push({
      id: clean(x.id, 24) || 'd' + Math.random().toString(36).slice(2, 8),
      name,
      kind: x.kind === 'person' ? 'person' : 'department',
      handles: clean(x.handles, 300),
      phone: digits(phone).replace(/\D/g, '').length >= 10 ? phone : '',
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '',
    });
  }
  return out;
}

export function directoryOf(settings) {
  return Array.isArray(settings && settings.directory) ? settings.directory : [];
}

export function findEntry(settings, id) {
  if (!id) return null;
  return directoryOf(settings).find((d) => d.id === id) || null;
}

// The rule text the team follows when a directory exists. Numbers and
// emails are never shown to the model, so it cannot read them out.
export function directoryRule(settings, name) {
  const dir = directoryOf(settings);
  if (!dir.length) return '';
  return `
DIRECTORY (you are also the switchboard operator for ${name}; put callers through to the right entry):
${dir.map((d) => `- id ${d.id}: ${d.name} (${d.kind})${d.handles ? `. Handles: ${d.handles}` : ''}${d.phone ? '' : '. No direct line: take a message for them.'}`).join('\n')}
SWITCHBOARD RULES:
- When the customer asks for a department or person by name, or their need clearly belongs to one entry, use reply_type "transfer" with transfer_to set to that entry's id, and say in one short sentence that you are putting them through to that name. Do this right away; do not answer questions that entry handles.
- If the entry has no direct line, use reply_type "take_message" with transfer_to set to that id, and collect their name, contact details and message in message_for_owner.
- If they ask for someone not in the directory, say you could not find that name, and offer to put them through to the main contact or take a message.
- Never read out a phone number, extension or email from the directory, and never confirm who works there beyond the names listed.
- For everything else, set transfer_to to null.`;
}
