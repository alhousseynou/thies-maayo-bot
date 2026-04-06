// Thies Ma Ville — WhatsApp Bot v3 + Dashboard

import express from "express";
import pkg from "twilio";
const { twiml } = pkg;
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import cors from "cors";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors());
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const BOT_NAME = "Thies Ma Ville";
const WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886";
const DASHBOARD_URL = process.env.DASHBOARD_URL || "https://thies-maayo-bot.onrender.com/dashboard";
const ADMIN_PHONES = ["+221771980297"];

// ─── Session store ────────────────────────────────────────────────────────────
const sessions = new Map();

function getSession(from) {
  if (!sessions.has(from)) {
    sessions.set(from, { history: [], benevole: null, awaitingSondage: false });
  }
  return sessions.get(from);
}

function generateCode(phone) {
  const digits = phone.replace(/\D/g, "").slice(-8);
  return `TMV${digits}`;
}

function cleanPhone(from) {
  return from.replace("whatsapp:", "");
}

// ─── Track WhatsApp user ──────────────────────────────────────────────────────
async function trackWhatsAppUser(from, profileName = null, referredBy = null) {
  const phone = cleanPhone(from);
  const referralCode = generateCode(phone);

  const { data } = await supabase.from("users").select("id, message_count").eq("phone", phone).single();

  if (data) {
    await supabase.from("users").update({ message_count: data.message_count + 1 }).eq("phone", phone);
  } else {
    const { error } = await supabase.from("users").insert({
      telegram_id: null,
      first_name: profileName || "WhatsApp User",
      last_name: null,
      username: null,
      phone: phone,
      language: "fr",
      referral_code: referralCode,
      referred_by: referredBy || null,
      message_count: 1,
    });
    if (error) console.error("❌ Insert error:", error);
    else if (referredBy) {
      const { data: referrer } = await supabase.from("users").select("telegram_id, phone, first_name").eq("referral_code", referredBy).single();
      if (referrer) {
        await supabase.from("referrals").insert({
          referrer_telegram_id: referrer.telegram_id || null,
          referred_telegram_id: null,
          referrer_phone: referrer.phone || null,
          referred_phone: phone,
        });
        if (referrer.phone) {
          await sendWhatsAppMessage(`whatsapp:${referrer.phone}`, `🎉 *Nouveau supporter recruté !*\n\n${profileName || "Un ami"} a rejoint Thiès Ma Ville grâce à votre lien ! Jërejëf 🙏\n\nContinuez à partager ! 🏙️`);
        }
      }
    }
    console.log("✅ New WhatsApp user:", phone);
  }
}

// ─── Send WhatsApp message ────────────────────────────────────────────────────
async function sendWhatsAppMessage(to, body) {
  const client = pkg(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  try {
    await client.messages.create({ from: WHATSAPP_NUMBER, to, body });
  } catch (err) {
    console.error("❌ Twilio send error:", err.message);
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es "Thies Ma Ville" — l'assistant officiel de la campagne d'ALHOUSSEYNOU BA, candidat à la Mairie de Thiès en 2027. Tu opères sur WhatsApp.

NOM: Alhousseynou Ba | SLOGAN: "Thiès 2027 : L'Audace de la Transformation"
PARTI: FARLU | COALITION: Sénégal Uni | SITE: alhousseynouba.com | WA: +221 77 198 02 97

QUI EST ALHOUSSEYNOU BA:
- Fondateur PDG One Africa Group & Ba Investment Group
- Fondateur 1er réseau social panafricain: one-africa.com
- Président FARLU, nommé Conseil Arabo-Africain (Égypte)
- Expert tech & entrepreneur — PAS un politicien de carrière

RÉSEAUX: one-africa.com | senegaluni.com | senegaldiaspora.com | thies.city | alhousseynouba.com

PROJET THIÈS:
AXE 1 — GOUVERNANCE: Conseil des Sages, Budget Participatif 15%
AXE 2 — DIGITAL: E-Mairie, Wi-Fi Public gratuit
AXE 3 — INTERNATIONAL: Jumelages USA/Égypte/Turquie, 10,000 emplois sur 3 ans
AXE 4 — FONDS CITOYEN: Micro-crédits Jaango sans intérêts
AXE 5 — CADRE DE VIE: Pavage, Thiès Ville Verte, collecte déchets géolocalisée

TES FONCTIONS (détection automatique):
1. TRADUCTION → français officiel + wolof marché + note vocale WhatsApp 30s
2. ATTAQUE → 3 phrases factuelles et percutantes
3. PROGRAMME → agenda optimisé par quartier
4. PLAINTE → solution + budget CFA estimé + note vocale wolof 15s

COMMANDES: rejoindre | inviter | sondage | info | plainte | traduire | attaque | programme | dashboard

PERSONNALITÉ: Respectueux, énergique, bilingue français/wolof. Salam aleykum, Waaw, Jërejëf.
RÈGLES: Réponses TOUJOURS sous 1500 caractères. Spécifique à Thiès. Détection langue auto.`;

// ─── Welcome message ──────────────────────────────────────────────────────────
function welcomeMessage(name = "") {
  return `🏙️ *Thies Ma Ville* — Agent Officiel

${name ? `Salam aleykum ${name} !` : "Salam aleykum !"}

Je suis l'assistant d'*Alhousseynou Ba*, candidat Mairie de Thiès 2027.

Tapez :
1️⃣ *plainte* — Signaler un problème
2️⃣ *traduire* — Traduire une politique
3️⃣ *attaque* — Répondre à une attaque
4️⃣ *programme* — Optimiser un agenda
5️⃣ *info* — En savoir plus
🔗 *inviter* — Votre lien de recrutement
🤝 *rejoindre* — Rejoindre l'équipe
🗳️ *sondage* — Donner votre avis

🌐 alhousseynouba.com | 🏙️ thies.city`;
}

// ─── Admin rapport text ───────────────────────────────────────────────────────
async function buildRapport() {
  const { data: users } = await supabase.from("users").select("*");
  const { data: benevoles } = await supabase.from("benevoles").select("*");
  const { data: votes } = await supabase.from("votes").select("*");
  const { data: referrals } = await supabase.from("referrals").select("*");

  const total = users?.length || 0;
  const avecNumero = users?.filter(u => u.phone).length || 0;
  const totalBen = benevoles?.length || 0;
  const totalVotes = votes?.length || 0;
  const totalRefs = referrals?.length || 0;

  const byQuartier = {};
  benevoles?.forEach(b => { byQuartier[b.quartier] = (byQuartier[b.quartier] || 0) + 1; });
  const quartierText = Object.entries(byQuartier).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([q, n]) => `  • ${q}: ${n}`).join("\n") || "  Aucun encore";

  const byReponse = {};
  votes?.forEach(v => { byReponse[v.reponse] = (byReponse[v.reponse] || 0) + 1; });
  const votesText = Object.entries(byReponse).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([r, n]) => `  • ${r}: ${n}`).join("\n") || "  Aucun encore";

  return `📊 *Rapport — Thiès 2027*
_${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}_

👥 *Supporters: ${total}*
  • Avec numéro: ${avecNumero} (${total ? Math.round((avecNumero / total) * 100) : 0}%)

🤝 *Bénévoles: ${totalBen}*
${quartierText}

🗳️ *Votes: ${totalVotes}*
${votesText}

🔗 *Referrals: ${totalRefs}*

📊 Dashboard: ${DASHBOARD_URL}

_Thiès 2027 : L'Audace de la Transformation !_ 🏙️`;
}

// ─── Weekly sondage ───────────────────────────────────────────────────────────
const SONDAGES = [
  { question: "Quel est votre problème principal à Thiès ?", choices: { "1": "Routes et pavage", "2": "Eau et électricité", "3": "Emploi et jeunesse", "4": "Santé et hôpital", "5": "Éducation et écoles" } },
  { question: "Quel projet vous tient le plus à cœur ?", choices: { "1": "E-Mairie digitale", "2": "Wi-Fi public gratuit", "3": "10,000 emplois", "4": "Micro-crédits Jaango", "5": "Thiès Ville Verte" } },
  { question: "Comment avez-vous entendu parler d'Alhousseynou Ba ?", choices: { "1": "Réseaux sociaux", "2": "Un ami / famille", "3": "Ce bot WhatsApp", "4": "Événement campagne", "5": "Médias / presse" } },
];

let currentSondageIndex = 0;

async function sendWeeklySondage() {
  const sondage = SONDAGES[currentSondageIndex % SONDAGES.length];
  currentSondageIndex++;
  const choicesText = Object.entries(sondage.choices).map(([k, v]) => `${k}️⃣ ${v}`).join("\n");
  const message = `🗳️ *Sondage Hebdomadaire — Thiès 2027*\n\n*${sondage.question}*\n\n${choicesText}\n\n_Tapez le numéro de votre choix !_`;
  const { data: users } = await supabase.from("users").select("phone").not("phone", "is", null);
  if (!users) return;
  let sent = 0;
  for (const user of users) {
    try {
      await sendWhatsAppMessage(`whatsapp:${user.phone}`, message);
      sent++;
      await new Promise(r => setTimeout(r, 100));
    } catch (e) {}
  }
  console.log(`✅ Weekly sondage sent to ${sent} users`);
}

function scheduleWeeklySondage() {
  const now = new Date();
  const nextSunday = new Date();
  nextSunday.setUTCHours(9, 0, 0, 0);
  const daysUntilSunday = (7 - now.getUTCDay()) % 7 || 7;
  nextSunday.setUTCDate(now.getUTCDate() + daysUntilSunday);
  const msUntilNext = nextSunday - now;
  console.log(`⏰ Next weekly sondage in ${Math.round(msUntilNext / 1000 / 60)} minutes`);
  setTimeout(async () => {
    await sendWeeklySondage();
    setInterval(sendWeeklySondage, 7 * 24 * 60 * 60 * 1000);
  }, msUntilNext);
}

// ─── Dashboard route ──────────────────────────────────────────────────────────
app.get("/dashboard", (req, res) => {
  try {
    const html = readFileSync(join(__dirname, "dashboard.html"), "utf-8");
    res.type("text/html").send(html);
  } catch (err) {
    res.status(500).send("Dashboard file not found. Make sure dashboard.html is in src/");
  }
});

// ─── API stats endpoint ───────────────────────────────────────────────────────
app.get("/api/stats", async (req, res) => {
  try {
    const [usersRes, benevolesRes, votesRes, referralsRes] = await Promise.all([
      supabase.from("users").select("*"),
      supabase.from("benevoles").select("*"),
      supabase.from("votes").select("*"),
      supabase.from("referrals").select("*"),
    ]);
    res.json({
      users: usersRes.data || [],
      benevoles: benevolesRes.data || [],
      votes: votesRes.data || [],
      referrals: referralsRes.data || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "online", agent: BOT_NAME, timestamp: new Date().toISOString() });
});

// ─── Main WhatsApp webhook ────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  const MessagingResponse = twiml.MessagingResponse;
  const response = new MessagingResponse();

  const incomingMsg = (req.body.Body || "").trim();
  const from = req.body.From || "unknown";
  const profileName = req.body.ProfileName || null;
  const phone = cleanPhone(from);
  const session = getSession(from);
  const msgLower = incomingMsg.toLowerCase();

  await trackWhatsAppUser(from, profileName, session.referredBy || null);

  // ── Greetings ───────────────────────────────────────────────────────────────
  const greetings = ["bonjour", "salam", "hello", "hi", "salut", "start", "aide", "help", "debut", "début"];
  if (greetings.some(g => msgLower.startsWith(g)) && session.history.length === 0) {
    response.message(welcomeMessage(profileName));
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── Referral code ───────────────────────────────────────────────────────────
  if (msgLower.startsWith("tmv") && session.history.length === 0) {
    session.referredBy = incomingMsg.trim();
    await trackWhatsAppUser(from, profileName, session.referredBy);
    response.message(welcomeMessage(profileName));
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── inviter ─────────────────────────────────────────────────────────────────
  if (["inviter", "invite", "lien"].includes(msgLower)) {
    const code = generateCode(phone);
    const { data: refs } = await supabase.from("referrals").select("id").eq("referrer_phone", phone);
    const count = refs?.length || 0;
    response.message(`🔗 *Votre lien de recrutement :*

https://wa.me/${WHATSAPP_NUMBER.replace("whatsapp:+", "")}?text=TMV${code}

Partagez avec vos amis et famille !

📊 Vous avez recruté *${count} supporter(s)*.

_Ndank ndank mooy japp golo ci naaye !_ 🏙️`);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── dashboard ───────────────────────────────────────────────────────────────
  if (msgLower === "dashboard" || msgLower === "stats") {
    response.message(`📊 *Dashboard Campagne Thiès 2027*

Consultez toutes vos statistiques en temps réel :

🔗 ${DASHBOARD_URL}

Supporters, bénévoles, votes, referrals — tout en un coup d'œil ! 🏙️`);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── sondage ─────────────────────────────────────────────────────────────────
  if (msgLower === "sondage") {
    session.awaitingSondage = true;
    response.message(`🗳️ *Sondage Thiès 2027*

Quel est votre problème principal à Thiès ?

1️⃣ Routes et pavage
2️⃣ Eau et électricité
3️⃣ Emploi et jeunesse
4️⃣ Santé et hôpital
5️⃣ Éducation et écoles`);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── Sondage response ─────────────────────────────────────────────────────────
  if (session.awaitingSondage && ["1", "2", "3", "4", "5"].includes(incomingMsg)) {
    const reponses = { "1": "Routes et pavage", "2": "Eau et électricité", "3": "Emploi et jeunesse", "4": "Santé et hôpital", "5": "Éducation et écoles" };
    await supabase.from("votes").insert({ telegram_id: null, question: "Problème principal à Thiès", reponse: reponses[incomingMsg] });
    session.awaitingSondage = false;
    response.message(`✅ Merci pour votre vote ! Jërejëf 🙏\n\nVotre choix: *${reponses[incomingMsg]}*\n\n👉 Recrutez des supporters : tapez *inviter*`);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── rejoindre (benevole) ────────────────────────────────────────────────────
  if (["rejoindre", "benevole", "bénévole"].includes(msgLower)) {
    session.benevole = { step: 1 };
    response.message(`🤝 *Rejoindre l'équipe !*

Waaw ! Jërejëf pour votre engagement 🙏

*Question 1/2* — Quel est votre quartier à Thiès ?
(Ex: Médina Fall, Randoulène, Cité Sonatel, Nord, Est, Gare...)`);
    res.type("text/xml"); return res.send(response.toString());
  }

  if (session.benevole) {
    if (session.benevole.step === 1) {
      session.benevole.quartier = incomingMsg;
      session.benevole.step = 2;
      response.message(`*Question 2/2* — Quelle est votre disponibilité ?

1️⃣ Week-end seulement
2️⃣ Soirs de semaine
3️⃣ Temps plein`);
      res.type("text/xml"); return res.send(response.toString());
    }
    if (session.benevole.step === 2) {
      const { error } = await supabase.from("benevoles").insert({
        telegram_id: null,
        first_name: profileName || "WhatsApp User",
        last_name: null,
        quartier: session.benevole.quartier,
        disponibilite: incomingMsg,
        phone: phone,
      });
      if (error) console.error("❌ Benevole error:", error);
      else console.log("✅ WhatsApp benevole inserted!");
      session.benevole = null;
      response.message(`✅ *Inscription confirmée !*

Jërejëf ${profileName || ""} ! Tu fais partie de l'équipe Thiès 2027 ! 🏙️

👉 Recrutez vos amis : tapez *inviter*

*Ndank ndank mooy japp golo ci naaye !* 💪`);
      res.type("text/xml"); return res.send(response.toString());
    }
  }

  // ── Admin: rapport ──────────────────────────────────────────────────────────
  if (msgLower === "rapport" && ADMIN_PHONES.includes(phone)) {
    const rapport = await buildRapport();
    response.message(rapport);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── Admin: broadcast ────────────────────────────────────────────────────────
  if (msgLower.startsWith("broadcast ") && ADMIN_PHONES.includes(phone)) {
    const message = incomingMsg.replace(/^broadcast /i, "");
    const { data: users } = await supabase.from("users").select("phone").not("phone", "is", null);
    let envoye = 0;
    for (const user of users || []) {
      try {
        await sendWhatsAppMessage(`whatsapp:${user.phone}`, `📢 *Message de campagne*\n\n${message}\n\n🏙️ _Alhousseynou Ba — Thiès 2027_`);
        envoye++;
        await new Promise(r => setTimeout(r, 100));
      } catch (e) {}
    }
    response.message(`✅ Message envoyé à ${envoye} supporters !`);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── reset ───────────────────────────────────────────────────────────────────
  if (msgLower === "reset") {
    sessions.delete(from);
    response.message("✅ Conversation réinitialisée. Jërejëf !");
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── Claude AI ───────────────────────────────────────────────────────────────
  session.history.push({ role: "user", content: incomingMsg });
  if (session.history.length > 20) session.history = session.history.slice(-20);

  try {
    const completion = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: session.history,
    });
    const reply = completion.content.map(b => b.text || "").join("").trim();
    session.history.push({ role: "assistant", content: reply });
    if (reply.length > 1580) {
      const chunks = reply.match(/.{1,1580}(\s|$)/gs) || [reply];
      chunks.forEach(chunk => response.message(chunk.trim()));
    } else {
      response.message(reply);
    }
  } catch (err) {
    console.error("Anthropic error:", err);
    response.message("⚠️ Une erreur est survenue. Veuillez réessayer. / Jërejëf, bañ ak solo bi.");
  }

  res.type("text/xml");
  res.send(response.toString());
});

// ─── Reset session endpoint ───────────────────────────────────────────────────
app.post("/reset/:phone", (req, res) => {
  const phone = `whatsapp:+${req.params.phone}`;
  sessions.delete(phone);
  res.json({ reset: true, phone });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🏙️ ${BOT_NAME} WhatsApp Bot running on port ${PORT}`);
  scheduleWeeklySondage();
});
