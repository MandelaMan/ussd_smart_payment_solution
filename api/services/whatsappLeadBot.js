/**
 * WhatsApp Cloud API lead bot via whatsapp-cloud-bot (ESM).
 * Loaded with dynamic import() so it works from this CommonJS codebase.
 * Gracefully no-ops when credentials are missing.
 */

const leadStore = require("./leadStore");
const { emitSyncEvent } = require("../socket");

let client = null;
let initPromise = null;
let initError = null;

const INTEREST_OPTIONS = [
  { id: "internet", title: "Home Internet" },
  { id: "dstv", title: "Internet + DSTV" },
  { id: "business", title: "Business" },
  { id: "other", title: "Other / Sales" },
];

function isConfigured() {
  return Boolean(
    process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN
  );
}

function getVerifyToken() {
  return process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "";
}

function emitLeadEvent(event, payload) {
  try {
    emitSyncEvent(event, payload);
  } catch {
    /* socket optional */
  }
}

async function loadWhatsAppClass() {
  const mod = await import("whatsapp-cloud-bot");
  return mod.WhatsApp || mod.default;
}

function interestLabel(id) {
  return INTEREST_OPTIONS.find((o) => o.id === id)?.title || id || null;
}

function extractButtonId(update) {
  const interactive = update.interactiveText;
  if (interactive == null) return null;
  if (typeof interactive === "string") return interactive;
  if (typeof interactive === "object") {
    return (
      interactive.id ||
      interactive.button_reply?.id ||
      interactive.list_reply?.id ||
      null
    );
  }
  return null;
}

async function findOrCreateWhatsAppLead(waId, displayName) {
  let lead = await leadStore.getLeadByWhatsAppWaId(waId);
  if (lead && !["converted", "closed"].includes(lead.status)) {
    return lead;
  }

  const id = await leadStore.createLead({
    source: "whatsapp",
    status: "new",
    name: displayName || null,
    phone: waId || null,
    whatsappWaId: waId,
    conversationState: "welcome",
  });
  lead = await leadStore.getLeadById(id);
  emitLeadEvent("leads:created", { leadId: id, source: "whatsapp" });
  return lead;
}

async function sendWelcome(update) {
  const body =
    process.env.WHATSAPP_WELCOME_MESSAGE ||
    "Welcome to Starlynx! What are you interested in?";

  if (typeof update.replyWithButton === "function") {
    // Library accepts string titles or InlineButton; titles are enough for lead capture.
    await update.replyWithButton(
      body,
      INTEREST_OPTIONS.slice(0, 3).map((o) => o.title)
    );
    return;
  }
  if (typeof update.replyMessage === "function") {
    const lines = INTEREST_OPTIONS.map(
      (o, i) => `${i + 1}. ${o.title}`
    ).join("\n");
    await update.replyMessage(`${body}\n\n${lines}\n\nReply with a number.`);
  }
}

async function replyText(update, text) {
  if (typeof update.replyWithText === "function") {
    await update.replyWithText(text);
    return;
  }
  if (typeof update.replyMessage === "function") {
    await update.replyMessage(text);
  }
}

async function handleInbound(update) {
  const waId =
    update.userPhoneNumber ||
    update.user?.wa_id ||
    update.userId ||
    update.from ||
    null;
  if (!waId) return;

  const displayName =
    update.userDisplayName || update.user?.profile?.name || null;

  const buttonId = extractButtonId(update);
  const text = String(update.messageText || buttonId || "").trim();
  const externalId = update.messageId || null;

  const lead = await findOrCreateWhatsAppLead(String(waId), displayName);

  await leadStore.addMessage({
    leadId: lead.id,
    direction: "inbound",
    channel: "whatsapp",
    body: text || "(interactive)",
    payload: {
      buttonId,
      messageText: update.messageText || null,
    },
    externalMessageId: externalId,
  });

  const state = lead.conversationState || "welcome";
  let outbound = null;
  let nextState = state;
  const patch = {};

  if (state === "welcome" || state === "awaiting_interest") {
    const interestId =
      buttonId ||
      INTEREST_OPTIONS.find(
        (o) =>
          o.id === text.toLowerCase() ||
          o.title.toLowerCase() === text.toLowerCase() ||
          String(INTEREST_OPTIONS.indexOf(o) + 1) === text
      )?.id;

    if (!interestId && state === "welcome") {
      await sendWelcome(update);
      outbound = "welcome_buttons";
      nextState = "awaiting_interest";
    } else if (interestId) {
      patch.interest = interestLabel(interestId);
      nextState = "awaiting_name";
      outbound = "Thanks! What is your full name?";
      await replyText(update, outbound);
    } else {
      outbound =
        "Please choose an option, or reply 1–4:\n" +
        INTEREST_OPTIONS.map((o, i) => `${i + 1}. ${o.title}`).join("\n");
      await replyText(update, outbound);
      nextState = "awaiting_interest";
    }
  } else if (state === "awaiting_name") {
    if (text.length < 2) {
      outbound = "Please reply with your full name.";
      await replyText(update, outbound);
    } else {
      patch.name = text.slice(0, 200);
      nextState = "awaiting_building";
      outbound =
        "Got it. Which building or estate are you in? (or type Skip)";
      await replyText(update, outbound);
    }
  } else if (state === "awaiting_building") {
    if (text && text.toLowerCase() !== "skip") {
      patch.buildingInterest = text.slice(0, 200);
    }
    nextState = "complete";
    outbound =
      process.env.WHATSAPP_COMPLETE_MESSAGE ||
      "Thanks! Our sales team will contact you shortly. You can also visit our website for packages.";
    await replyText(update, outbound);
  } else if (/^(hi|hello|start|menu)$/i.test(text)) {
    nextState = "awaiting_interest";
    await sendWelcome(update);
    outbound = "welcome_buttons";
  } else {
    outbound =
      "Thanks for reaching out. A team member will follow up soon. Reply HI to start again.";
    await replyText(update, outbound);
  }

  patch.conversationState = nextState;
  await leadStore.updateLead(lead.id, patch);

  if (outbound) {
    await leadStore.addMessage({
      leadId: lead.id,
      direction: "outbound",
      channel: "whatsapp",
      body: String(outbound),
    });
  }

  emitLeadEvent("leads:updated", { leadId: lead.id, source: "whatsapp" });
}

function registerHandlers(wa) {
  const handler = async (update) => {
    try {
      await handleInbound(update);
    } catch (err) {
      console.error("[whatsapp] handler error:", err.message || err);
    }
  };

  if (typeof wa.onTextMessage === "function") {
    wa.onTextMessage(handler);
  } else if (typeof wa.onMessage === "function") {
    wa.onMessage(handler);
  }

  if (typeof wa.onButtonReply === "function") {
    wa.onButtonReply(handler);
  }
  if (typeof wa.onListReply === "function") {
    wa.onListReply(handler);
  }
  if (typeof wa.onInteractiveMessage === "function") {
    wa.onInteractiveMessage(handler);
  }
}

async function ensureClient() {
  if (client) return client;
  if (initPromise) return initPromise;

  if (!isConfigured()) {
    initError = "WhatsApp credentials not configured";
    return null;
  }

  initPromise = (async () => {
    try {
      const WhatsApp = await loadWhatsAppClass();
      client = new WhatsApp({
        numberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
        token: process.env.WHATSAPP_ACCESS_TOKEN,
      });
      registerHandlers(client);
      initError = null;
      return client;
    } catch (err) {
      initError = err.message || String(err);
      console.error("[whatsapp] Failed to init client:", initError);
      client = null;
      return null;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

async function verifyWebhookQuery(query) {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  const expected = getVerifyToken();

  if (mode === "subscribe" && expected && token === expected) {
    return { ok: true, challenge: String(challenge || "") };
  }
  return { ok: false };
}

async function processWebhook(body) {
  const wa = await ensureClient();
  if (!wa) {
    return {
      ok: false,
      error: initError || "WhatsApp not configured",
      skipped: true,
    };
  }

  await wa.processUpdate(body);
  return { ok: true };
}

function getStatus() {
  return {
    configured: isConfigured(),
    ready: Boolean(client),
    error: initError,
  };
}

module.exports = {
  isConfigured,
  ensureClient,
  verifyWebhookQuery,
  processWebhook,
  getStatus,
  INTEREST_OPTIONS,
};
