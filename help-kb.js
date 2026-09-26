// help-kb.js — Squadron's own help center knowledge. One source for the
// /help page and for Ace, the support chat on squadron.tel. Every answer is
// a complete, plain statement of how Squadron works today; nothing here
// claims a number Squadron has not measured.

export const CATEGORIES = [
  { id: 'start', title: 'Getting started' },
  { id: 'train', title: 'Training your team' },
  { id: 'test', title: 'Testing your team' },
  { id: 'deploy', title: 'Going live' },
  { id: 'agents', title: 'Your agents' },
  { id: 'billing', title: 'Plans and billing' },
  { id: 'trouble', title: 'Troubleshooting' },
  { id: 'account', title: 'Account, data and trust' },
];

export const ARTICLES = [
  // ---- Getting started ----
  { id: 'what-is-squadron', cat: 'start', q: 'What is Squadron?',
    keys: 'what is squadron about who are you what do you do overview explain product',
    a: `Squadron builds a customer-service team of AI agents for your business from your website, your iOS App Store listing or your documents. Each agent manages one area, such as the front desk, billing or scheduling, and answers only from what your business publishes. The team answers your website chat today, and phone lines are opening soon. Plans start at $39 for 30 days, paid in advance.` },
  { id: 'how-setup-works', cat: 'start', q: 'How do I set up my team?',
    keys: 'setup set up get started start begin onboarding steps how does it work sign up create',
    a: `Setup has six steps at squadron.tel/start:\n1. Enter your website, App Store link or documents.\n2. Squadron reads up to ten pages, starting with pricing, FAQ, contact, hours and policies. Reading costs nothing.\n3. Create an account and prepay a plan.\n4. Review your Business Profile. Every fact shows its source, and you can correct anything.\n5. Review the team Squadron builds, and edit any agent.\n6. Test the team by chat and voice, then turn chat on with one line of code.` },
  { id: 'what-you-need', cat: 'start', q: 'What does Squadron need from me?',
    keys: 'need requirements input website url documents app store what do i need',
    a: `Squadron needs one of three things: a website address, an iOS App Store link, or your documents as .txt, .md, .csv or .html files. PDF and Word files are not read yet, so paste their text instead. The better your pages cover pricing, hours, policies and FAQs, the more your team can answer.` },
  { id: 'how-long-setup', cat: 'start', q: 'How long does setup take?',
    keys: 'how long time minutes fast quick setup duration',
    a: `Reading your site takes about a minute. Building the profile and the team starts as soon as your plan is paid, and your review and testing take as long as you want them to. Nothing goes live until you turn it on.` },
  { id: 'app-store', cat: 'start', q: 'Can Squadron read my App Store listing?',
    keys: 'app store ios iphone app listing apple',
    a: `Yes. Paste your iOS App Store link. Squadron reads the listing, then the support and seller sites the listing points to, because those usually hold the support details.` },
  { id: 'no-website', cat: 'start', q: 'I do not have a website. Can I still use Squadron?',
    keys: 'no website without website documents only paste text',
    a: `Yes. Choose Documents at squadron.tel/start and add .txt, .md, .csv or .html files, or paste text such as your price list, hours, policies and common questions.` },

  // ---- Training ----
  { id: 'train-team', cat: 'train', q: 'How do I train my team?',
    keys: 'train training teach learn learns learning improve knowledge customize answers resolve matters make it smarter',
    a: `You train your team in plain English, with no prompts or code:\n1. Squadron reads your website, App Store listing or documents and builds your Business Profile, with the source of every fact.\n2. You correct any fact or add what your site does not say, on the profile page.\n3. When a customer asks something the profile does not cover, the question lands in your knowledge queue in Squadron HQ. Answer it once and approve it, and the whole team uses that answer from the next conversation.\n4. On the team page you set what each agent handles, when it passes a customer to a person, and its greeting.` },
  { id: 'learns-automatically', cat: 'train', q: 'Does the AI learn from conversations on its own?',
    keys: 'learn automatically self learning from calls conversations over time on its own memory',
    a: `No, on purpose. Your team only knows what is in your Business Profile and the answers you approve. It never teaches itself from conversations, so it cannot pick up something wrong from a customer. Every question it could not answer goes to your knowledge queue, so you decide what it learns.` },
  { id: 'update-website', cat: 'train', q: 'I changed my website. How does my team find out?',
    keys: 'website changed updated new prices re-read refresh resync crawl again',
    a: `Correct the changed facts on your profile page, where every fact shows the page it came from. Your team uses the corrected facts from the next conversation.` },
  { id: 'resolve-issues', cat: 'train', q: 'How does my team resolve a customer problem?',
    keys: 'resolve problem issue complaint refund request handle matter solve fix case',
    a: `Your team resolves what your published policies and your approved answers cover, such as explaining a return, a price, an order process or your hours. For anything that needs a decision from you, like an exception, a refund outside your policy or an account change, it takes the details and passes the customer to a person, following the human layer and escalation rules you set.` },
  { id: 'agent-rules', cat: 'train', q: 'Can I set rules, like passing big refunds to me?',
    keys: 'rules escalation rule scope handle refund over limit pass to owner manager',
    a: `Yes. Each agent has an escalation rule you can edit on the team page, written in plain English, such as passing any refund over $500 to the owner. You also edit what each agent handles and what it hands to someone else.` },

  // ---- More about Squadron ----
  { id: 'install-platforms', cat: 'deploy', q: 'How do I install the chat on Shopify, WordPress, Squarespace, Wix or Webflow?',
    keys: 'install shopify wordpress squarespace wix webflow html site code embed paste footer theme',
    a: `Copy your line from the Deploy screen, then:\n1. Shopify: Online Store, Themes, Edit code, and paste it into theme.liquid just before </body>.\n2. WordPress: paste it into your theme footer, or use any header and footer code plugin.\n3. Squarespace: paste it into Code Injection, in the Footer box.\n4. Wix: Settings, Custom Code, and add it to the end of the body on all pages.\n5. Webflow: Site settings, Custom code, and paste it into the Footer code box.\n6. Any other site: paste it just before the closing </body> tag.` },
  { id: 'who-makes', cat: 'account', q: 'Who is behind Squadron?',
    keys: 'company who makes owns behind squadron island global legal entity delaware founder',
    a: `Squadron is made by Island Global Co, doing business as Squadron, under Delaware law. You can reach a person at info@squadron.tel.` },
  { id: 'ai-models', cat: 'account', q: 'Which AI does Squadron use?',
    keys: 'which ai model openai gpt llm voice model technology powered by',
    a: `Squadron uses OpenAI models for reading your business, for chat and for real-time voice, and Twilio for phone lines.` },
  { id: 'not-chatbot', cat: 'start', q: 'How is Squadron different from a chatbot?',
    keys: 'different chatbot bot vs better than intercom zendesk retell compare why squadron',
    a: `A chatbot answers from a script you write. Squadron builds a team of AI agents from your own website, each managing one area, answers only from facts with a source, escalates to a higher manager or a person when needed, and works on chat and phone with voices you can hear before you buy. You do not write prompts or build flows, and it is one prepaid price with no contract.` },
  { id: 'can-book', cat: 'agents', q: 'Can my team book appointments or take payments?',
    keys: 'book appointments booking schedule calendar take payments orders checkout reservations',
    a: `Not directly. Your team can give customers your booking link and explain how booking or paying works, from your profile, but it does not connect to calendars or payment systems yet.` },
  { id: 'outbound', cat: 'agents', q: 'Can my team make outbound calls?',
    keys: 'outbound calls call customers dial out cold call sales calls',
    a: `No. Squadron answers inbound conversations only and never places outbound AI calls.` },
  { id: 'own-voice', cat: 'agents', q: 'Can I use my own voice or rename the agents?',
    keys: 'own voice clone custom voice rename agent name change voice',
    a: `You choose from the 24 Squadron voices and can reassign any agent. You can change each agent's title and greeting on the team page. Cloning your own voice is not available.` },
  { id: 'many-calls', cat: 'agents', q: 'Can my team handle several customers at once?',
    keys: 'concurrent simultaneous several many customers at once same time busy volume',
    a: `Yes, on chat: every chat runs as its own conversation, so several customers can be helped at the same time.` },

  // ---- Testing ----
  { id: 'test-chat', cat: 'test', q: 'How do I test my team by chat?',
    keys: 'test chat try ask questions practice preview conversation typing',
    a: `Open the Test step and ask what your customers ask. Every answer shows the source it came from. A question your profile does not cover is refused honestly and added to your knowledge queue, so you can add the answer.` },
  { id: 'test-voice', cat: 'test', q: 'How do I test my team by voice?',
    keys: 'test voice talk speak microphone browser call hear',
    a: `Choose Voice in the Test step and press Start. Your browser asks for the microphone. Your team answers with the Front Desk voice and says out loud when it hands you to another agent. Test calls end automatically after a few minutes, they use your prepaid balance, and the transcript is saved to Squadron HQ.` },
  { id: 'demo-number', cat: 'test', q: 'Can I call my team from a real phone?',
    keys: 'demo number phone call real phone test call dial test by phone phone test',
    a: `Yes. In the Test step, choose Call a demo number. Squadron lends you a real phone number for fifteen minutes. Your Front Desk agent answers, says it is an AI and that the call is recorded, and the recording appears in Squadron HQ as a test call. Demo calls use your prepaid balance, so they need an active plan.` },
  { id: 'qa-checklist', cat: 'test', q: 'What should I check before going live?',
    keys: 'qa checklist quality check before launch go live review verify',
    a: `Run this checklist before you turn anything on:\n1. Ask for your hours, prices and address, and confirm each answer matches your site.\n2. Ask about your refund or cancellation policy.\n3. Ask for a person, and confirm the agent offers a message or a transfer.\n4. Ask something your site does not cover, and confirm the agent says it does not know.\n5. Set your on-call number and hours on the Deploy screen.\n6. Read the knowledge queue in Squadron HQ and answer anything that came up.` },
  { id: 'wrong-answer', cat: 'test', q: 'My agent gave a wrong answer. How do I fix it?',
    keys: 'wrong answer incorrect mistake fix correct error bad answer outdated',
    a: `Every answer comes from your Business Profile, so fix the profile. Open the profile, find the field the answer came from (each answer shows its source), and correct it. Your team uses the corrected value in the next conversation. If your website changed, you can also have Squadron read it again.` },
  { id: 'knowledge-queue', cat: 'test', q: 'What is the knowledge queue?',
    keys: 'knowledge queue gaps unanswered questions dont know missing answers',
    a: `The knowledge queue in Squadron HQ lists every question your team could not answer and every message it took. Write an answer once, approve it, and your team uses it from then on.` },

  // ---- Going live ----
  { id: 'chat-widget', cat: 'deploy', q: 'How do I add the chat to my website?',
    keys: 'chat widget embed install snippet script code website add chat wordpress shopify squarespace wix',
    a: `On the Deploy screen, turn chat on and copy the one-line snippet. Paste it into your site just before the closing </body> tag, or into your site builder's custom code area (Shopify theme.liquid, WordPress footer, Squarespace code injection, or Wix custom code). The chat button appears on every page that includes the snippet.` },
  { id: 'phone-lines', cat: 'deploy', q: 'When can my team answer my phone?',
    keys: 'phone line lines number calls answer my phone forward porting twilio inbound ready when available soon launch',
    a: `Phone lines are opening soon. When they do, the Deploy screen will show your number, which you can publish or forward your existing business line to. Until then you can test by phone with a fifteen-minute demo number.` },
  { id: 'email-sms', cat: 'deploy', q: 'Can my team answer email and text messages?',
    keys: 'email sms text texts texting send messages channels inbox',
    a: `Not yet. The Deploy screen shows email and SMS as not yet available, and each will get its own status there when it opens. Web chat is live today.` },
  { id: 'human-layer', cat: 'deploy', q: 'Can customers choose a person instead of the AI?',
    keys: 'human layer person or ai choice talk to a person option ai only person first receptionist escalate to a person only straight ai mode',
    a: `Yes. On the Deploy screen, choose one of four human layers, and every channel follows it:\n1. AI first, a person on request: the AI team answers, and a customer can ask for a person at any time.\n2. Customer chooses: every conversation starts by offering a person at your business or the AI team.\n3. A person first: the AI acts as your receptionist, takes the customer's name, contact details and reason, and passes them to your on-call person.\n4. AI only: the AI team handles everything and takes a message when someone asks for a person.\nIn the chat, a Talk to a person button is always on screen unless you choose AI only. Person requests are emailed to you and marked as escalations in Squadron HQ, and they never use your prepaid balance.` },
  { id: 'on-call', cat: 'deploy', q: 'How do transfers to a person work?',
    keys: 'transfer human person on call escalate staff forward to me manager real person',
    a: `Set an on-call phone number and hours on the Deploy screen. When a customer asks for a person, is upset, or asks something your profile does not cover, the agent transfers the call to your on-call number or takes a message, and the conversation is logged in Squadron HQ.` },
  { id: 'turn-off', cat: 'deploy', q: 'How do I pause or turn off my team?',
    keys: 'pause turn off disable stop agents offline switch off',
    a: `Turn a channel off on the Deploy screen, or remove the chat snippet from your site. You can also turn off any single agent on the team page. Nothing is switched on until you switch it on.` },

  // ---- Agents ----
  { id: 'agents-24', cat: 'agents', q: 'How many agents are there, and how are they chosen?',
    keys: 'agents how many 24 roster personas choose pick assign voices crew',
    a: `Squadron has 24 AI agents, each with its own voice, rank and specialty. Squadron picks between two and six of them for your business, based on what your profile shows it needs, and you can reassign or turn off any of them. You can hear every voice on the homepage before you buy.` },
  { id: 'escalation', cat: 'agents', q: 'What happens when a caller asks for a manager?',
    keys: 'manager supervisor escalate escalation top brass rank higher agent',
    a: `Every Squadron agent is the AI manager of its own area, so callers deal with a manager from the first word. The team moves a caller to the agent who fits the situation, and escalates to a higher-ranking manager when needed. A caller talks with at most three agents on one call, and after that the call goes to a person at your business.` },
  { id: 'says-ai', cat: 'agents', q: 'Does the agent say it is an AI?',
    keys: 'ai disclosure honest human pretend identify bot recording notice',
    a: `Yes. Every agent says it is an AI at the start of every conversation, every call begins with a recording notice, and an agent never claims to be human. Squadron answers inbound conversations only and never places outbound AI calls.` },
  { id: 'dont-know', cat: 'agents', q: 'What does an agent do when it does not know the answer?',
    keys: 'dont know unknown hallucinate make up invent guess not sure accuracy',
    a: `It says so plainly. Agents answer only from your Business Profile, never invent prices, policies or promises, and log the question to your knowledge queue. They then offer to take a message or transfer the customer to a person.` },
  { id: 'edit-agent', cat: 'agents', q: 'Can I change what an agent says or does?',
    keys: 'edit agent customize change job description scope greeting escalation rule tone',
    a: `Yes. On the team page you can edit each agent's title, job description, scope, escalation rule and greeting, or turn the agent off. Changes apply to the next conversation.` },
  { id: 'languages', cat: 'agents', q: 'Do the agents speak other languages?',
    keys: 'language spanish french languages multilingual translate',
    a: `Your team answers from your Business Profile, and Rosetta is the agent for customers who write or speak in another language. Test the languages your customers use in the Test step before you go live.` },

  // ---- Billing ----
  { id: 'pricing', cat: 'billing', q: 'How much does Squadron cost?',
    keys: 'price pricing cost how much plans basic pro command center battalion tiers enterprise large high volume',
    a: `Plans are prepaid for 30 days: Basic is $39 with 250 AI voice minutes, Pro is $79 with 650 minutes, Command Center is $199 with 2,000 minutes, and Battalion is $999 with 10,000 minutes. Every plan includes the full team and unlimited web chat. On Basic, Pro and Command Center, extra voice minutes cost 25¢ each, prepaid in blocks of 100. On Battalion, minutes beyond 10,000 draw on prepaid overage credit at Squadron's cost plus 1¢ a minute.` },
  { id: 'battalion-overage', cat: 'billing', q: 'What does a minute past 10,000 cost on Battalion?',
    keys: 'battalion overage over 10000 extra minutes cost plus markup rate card openai twilio credit',
    a: `Each minute past 10,000 costs exactly what that call costs Squadron at our providers' published prices, plus 1¢. The prices are:\n1. OpenAI voice model: $10 per million audio tokens in, $20 per million audio tokens out, and $0.60 and $2.40 per million text tokens in and out.\n2. Call transcription: 0.3¢ a minute.\n3. Twilio phone line: 0.85¢ a minute inbound, and 0.25¢ a minute for the recording.\n4. Squadron markup: 1¢ a minute.\nThese minutes draw on overage credit you prepay in $100 blocks, and your Billing page shows every minute past 10,000 and the credit it used. When the credit runs out, the team pauses until you add more.` },
  { id: 'no-surprise-bills', cat: 'billing', q: 'Can I get a surprise bill?',
    keys: 'surprise bill overage charges hidden fees extra charges bill after auto upgrade',
    a: `No. Squadron is prepaid and never bills you after the fact. When a period's prepaid amount is used, your team pauses and Squadron emails you a top-up invoice. There is no automatic upgrade, no per-agent fee and no hidden overage rate.` },
  { id: 'payment-methods', cat: 'billing', q: 'How can I pay?',
    keys: 'pay payment card credit card wire ach bank transfer invoice mercury stripe',
    a: `Pay by card, and your team is built and switched on right away. Or pay by bank wire or ACH using the details on your invoice, put the reference in the memo, and your team switches on as soon as the transfer lands.` },
  { id: 'cancel', cat: 'billing', q: 'How do I cancel?',
    keys: 'cancel cancellation quit stop subscription contract end leave',
    a: `There is nothing to cancel. Squadron has no contract and nothing renews automatically. If you do not pay for another 30 days, your team stops at the end of the current period.` },
  { id: 'refunds', cat: 'billing', q: 'Do you give refunds?',
    keys: 'refund refunds policy money back return chargeback',
    a: `Payments are not refunded, which is why Squadron never takes more than 30 days at a time and never renews automatically. You can see every voice and read the full Terms before you pay.` },
  { id: 'free-trial', cat: 'billing', q: 'Is there a free trial?',
    keys: 'free trial try for free demo no cost',
    a: `No. Squadron is prepaid instead, with no contract: pay for 30 days from $39, test your team by chat and voice, and simply do not renew if it is not for you.` },
  { id: 'team-paused', cat: 'billing', q: 'Why is my team paused?',
    keys: 'paused stopped not answering prepaid used up out of minutes balance',
    a: `Your team pauses when the current period's prepaid amount is used or the period ends. Squadron emails you when that happens. Pay the top-up invoice or the next 30 days in Billing, and your team resumes when the payment lands.` },

  // ---- Troubleshooting ----
  { id: 'widget-missing', cat: 'trouble', q: 'The chat button does not appear on my site.',
    keys: 'widget not showing chat button missing not appearing invisible snippet',
    a: `Check these in order:\n1. Chat is turned on for this business on the Deploy screen.\n2. The snippet is on the page you are viewing, just before </body>.\n3. Your site builder published the change; reload with the cache cleared.\n4. A content security policy on your site allows scripts from squadron.tel.\n5. Your plan is active; a paused team does not answer.` },
  { id: 'mic-blocked', cat: 'trouble', q: 'The voice test cannot hear me.',
    keys: 'microphone mic blocked permission voice test not hearing cant hear audio no sound',
    a: `Allow the microphone for squadron.tel in your browser's site settings, then reload the Test page. Close other apps that are using the microphone, and use headphones so the agent does not hear its own voice. Voice tests need an active plan.` },
  { id: 'site-not-read', cat: 'trouble', q: 'Squadron could not read my website.',
    keys: 'could not read site crawl failed error 403 blocked website not read reading failed',
    a: `Some sites block automated readers or need a login. Check that the address opens in a private browser window. If it still fails, choose Documents and paste the text of your key pages, such as pricing, hours, policies and FAQs.` },
  { id: 'profile-missing', cat: 'trouble', q: 'My profile is missing information.',
    keys: 'profile missing info empty fields incomplete not stated',
    a: `Fields marked "Not stated in your sources" were not on the pages Squadron read. Fill them in on the profile page, or add the page or document that covers them. Your team only answers from what the profile holds.` },
  { id: 'payment-pending', cat: 'trouble', q: 'I paid, but my team has not started.',
    keys: 'paid not started payment pending wire not arrived waiting activation',
    a: `Card payments start your team right away. Wire and ACH transfers start it when the transfer lands, which can take one to three business days, and the reference must be in the memo so Squadron can match it. If it has been longer, write to support with your reference.` },
  { id: 'reset-password', cat: 'trouble', q: 'I forgot my password.',
    keys: 'password forgot reset login cant log in locked out sign in',
    a: `Go to squadron.tel/reset and enter the email you use for Squadron. Squadron emails you a link to choose a new password.` },

  // ---- Account and trust ----
  { id: 'delete-account', cat: 'account', q: 'How do I delete my account?',
    keys: 'delete account remove data erase close account gdpr',
    a: `Open your account page and choose Delete my account. It permanently deletes your account, every team, conversation and recording, and takes your agents offline right away.` },
  { id: 'recordings', cat: 'account', q: 'Where are my transcripts and recordings?',
    keys: 'transcripts recordings history conversations export csv json download hq',
    a: `Squadron HQ keeps every conversation, with transcripts, recordings and the sources each answer used. The Export tab downloads everything as a CSV, or as JSON with full transcripts.` },
  { id: 'data-use', cat: 'account', q: 'What does Squadron do with my data?',
    keys: 'data privacy security safe secure safety what happens with my data train sell',
    a: `Squadron uses your sources to build your profile and answer your customers. The Privacy Policy at squadron.tel/privacy explains what is kept and why. For any other data question, write to info@squadron.tel.` },
  { id: 'integrations', cat: 'account', q: 'Does Squadron integrate with my CRM or booking system?',
    keys: 'integration crm hubspot salesforce zapier api booking calendar webhook',
    a: `Not today. Squadron does not offer CRM or booking integrations or a public API yet. Everything your team handles is in Squadron HQ and can be exported.` },
  { id: 'contact-person', cat: 'account', q: 'How do I reach a person at Squadron?',
    keys: 'contact support human person talk to someone help email ticket',
    a: `Use the form at squadron.tel/help#contact, or email info@squadron.tel. Every request gets a reference number, and a person at Squadron replies by email.` },
];

// Scores articles against a question with plain keyword overlap. No AI, no
// cost, and the same answer every time.
const STOP = new Set('a an the is are do does i my me you your to of for and or in on it can how what why when where with be this that there have has will please not want working get need'.split(' '));
function words(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)); }
function stem(w) { return w.replace(/(ing|ed|es|s)$/, ''); }

export function search(query, limit = 3) {
  const q = [...new Set(words(query).map(stem))];
  if (!q.length) return [];
  const docs = ARTICLES.map((a) => ({ a, keys: new Set(words(a.keys + ' ' + a.q).map(stem)), body: new Set(words(a.a).map(stem)) }));
  const N = docs.length;
  const idf = {};
  for (const w of q) { const df = docs.filter((d) => d.keys.has(w) || d.body.has(w)).length; idf[w] = df ? Math.log(1 + N / df) : 0; }
  const scored = docs.map((d) => {
    let s = 0;
    for (const w of q) { if (d.keys.has(w)) s += 3 * idf[w]; else if (d.body.has(w)) s += idf[w]; }
    return { a: d.a, s: s / Math.sqrt(q.length) };
  }).filter((x) => x.s > 0).sort((x, y) => y.s - x.s);
  return scored.slice(0, limit).map((x) => ({ ...x.a, score: x.s }));
}
