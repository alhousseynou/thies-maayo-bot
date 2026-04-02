import express from "express";
import pkg from "twilio";
const { twiml } = pkg;;
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── In-memory session store (replace with Redis in production) ───────────────
const sessions = new Map();

function getSession(from) {
  if (!sessions.has(from)) {
    sessions.set(from, { history: [], role: null });
  }
  return sessions.get(from);
}

// ─── Campaign configuration (set via env or hardcode after onboarding) ────────
const CAMPAIGN = {
  candidate: process.env.CANDIDATE_NAME || "Le candidat",
  movement: process.env.MOVEMENT_NAME || "Notre mouvement",
  opponents: process.env.OPPONENTS || "L'adjoint au maire actuel",
  topIssue: process.env.TOP_ISSUE || "eau potable, routes, chômage des jeunes",
};

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are "Thies Maayo Agent" – an AI campaign manager for ${CAMPAIGN.candidate} (${CAMPAIGN.movement}), running for Mayor of Thiès, Senegal.

OPPONENTS: ${CAMPAIGN.opponents}
VOTERS' TOP ISSUE: ${CAMPAIGN.topIssue}

YOUR PERSONALITY: Respectful, energetic, pragmatic. Fluent in French and basic Wolof. You naturally use Wolof greetings and proverbs (Salam aleykum, Waaw, Jërejëf, "Ndank ndank mooy japp golo ci naaye").

You understand Senegalese political culture:
- Religious brotherhoods (Tidjane, Mouride) and their spiritual leaders
- Transport union power at Gare Routière de Thiès
- Student influence from Université Iba Der Thiam
- Market women networks (thioffoye)
- Neighborhood dynamics: Cité Sonatel, Médina Fall, Nord, Est, Gare area

YOU HAVE FOUR MODES. Detect the user's intent and respond accordingly:

1. POLICY TRANSLATION — when user shares a policy or says "traduire":
   Output three versions:
   🇫🇷 FRANÇAIS OFFICIEL: [formal, for officials/press]
   🗣️ WOLOF (marché/anciens): [colloquial, accessible]
   📱 NOTE VOCALE WHATSAPP (30 sec): [warm, urgent, honest script]

2. ATTACK REBUTTAL — when user describes an opponent attack or says "répondre à":
   Output a 3-sentence rebuttal: factual, non-insulting, but damaging.
   Cite lack of action, never personal flaws. Label it: ⚔️ RÉPONSE:

3. SCHEDULE OPTIMIZATION — when user says "programme-moi X heures" or similar:
   Output a hour-by-hour route through Thiès neighborhoods with:
   ⏰ Time | 📍 Location | 👤 Person to meet | 💬 2-minute talking point

4. VOTER COMPLAINT HANDLER — when user describes a local problem (water, roads, trash, etc.):
   Output three things:
   📋 SOLUTION POLITIQUE: one paragraph + rough CFA budget estimate
   🎙️ NOTE VOCALE WOLOF (15 sec): script in Wolof
   ⚔️ BILAN DE L'ADJOINT: rebuttal citing deputy mayor's failure on this issue

IMPORTANT RULES:
- Keep WhatsApp responses concise — under 1600 characters total when possible
- Use emojis as section headers for easy scanning on mobile
- Always be specific to Thiès (street names, landmarks, real institutions)
- No generic political advice — only actionable, local outputs
- If the message is a general greeting or unclear, respond warmly in French/Wolof and ask what they need
- If someone identifies as press/journalist, respond formally in French only

ROLE DETECTION:
- If user says "je suis journaliste" or "presse" → formal French only, no Wolof
- If user says "je suis électeur" or describes a local problem → voter mode
- If user says "staff" or "équipe" → full campaign manager mode with all 4 functions`;

// ─── Detect user role from message ───────────────────────────────────────────
function detectRole(message) {
  const msg = message.toLowerCase();
  if (msg.includes("journalist") || msg.includes("presse") || msg.includes("journaliste")) return "press";
  if (msg.includes("staff") || msg.includes("équipe") || msg.includes("equipe")) return "staff";
  return "voter";
}

// ─── Build welcome message ────────────────────────────────────────────────────
function welcomeMessage() {
  return `🗳️ *Thies Maayo Agent*
Campagne de ${CAMPAIGN.candidate}

Salam aleykum! Comment puis-je vous aider?

Tapez:
1️⃣ *plainte* – Signaler un problème dans votre quartier
2️⃣ *politique* – Obtenir une traduction de politique
3️⃣ *attaque* – Répondre à une attaque d'un opposant
4️⃣ *programme* – Optimiser un agenda de campagne
5️⃣ *presse* – Mode journaliste (français uniquement)

_Waaw — écrivez votre message et je répondrai immédiatement._`;
}

// ─── Main WhatsApp webhook ────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  const MessagingResponse = twiml.MessagingResponse;
  const response = new MessagingResponse();

  const incomingMsg = (req.body.Body || "").trim();
  const from = req.body.From || "unknown";

  const session = getSession(from);

  // Detect role if not set
  if (!session.role) {
    session.role = detectRole(incomingMsg);
  }

  // Handle greetings / first contact
  const greetings = ["bonjour", "salam", "hello", "hi", "salut", "start", "aide", "help"];
  if (greetings.some((g) => incomingMsg.toLowerCase().startsWith(g)) && session.history.length === 0) {
    response.message(welcomeMessage());
    res.type("text/xml");
    return res.send(response.toString());
  }

  // Add to history
  session.history.push({ role: "user", content: incomingMsg });

  // Keep last 10 exchanges to manage context
  if (session.history.length > 20) {
    session.history = session.history.slice(-20);
  }

  try {
    const completion = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: session.history,
    });

    const reply = completion.content.map((b) => b.text || "").join("").trim();

    session.history.push({ role: "assistant", content: reply });

    // WhatsApp has a 1600 char limit per message — split if needed
    if (reply.length > 1580) {
      const chunks = reply.match(/.{1,1580}(\s|$)/gs) || [reply];
      chunks.forEach((chunk) => response.message(chunk.trim()));
    } else {
      response.message(reply);
    }
  } catch (err) {
    console.error("Anthropic error:", err);
    response.message("⚠️ Une erreur est survenue. Veuillez réessayer dans un moment. / Jërejëf, bañ ak solo bi.");
  }

  res.type("text/xml");
  res.send(response.toString());
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status: "online",
    agent: "Thies Maayo Agent",
    candidate: CAMPAIGN.candidate,
    timestamp: new Date().toISOString(),
  });
});

// ─── Reset session (for testing) ──────────────────────────────────────────────
app.post("/reset/:phone", (req, res) => {
  const phone = `whatsapp:+${req.params.phone}`;
  sessions.delete(phone);
  res.json({ reset: true, phone });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🗳️  Thies Maayo Agent running on port ${PORT}`);
});
