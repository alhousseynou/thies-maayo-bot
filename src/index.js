// Thies Ma Ville — WhatsApp Bot v4 — All Features

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
  if (!sessions.has(from)) sessions.set(from, { history: [], benevole: null, awaitingSondage: false });
  return sessions.get(from);
}

function generateCode(phone) {
  const digits = phone.replace(/\D/g, "").slice(-8);
  return `TMV${digits}`;
}

function cleanPhone(from) {
  return from.replace("whatsapp:", "");
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
          await sendWhatsAppMessage(`whatsapp:${referrer.phone}`,
            `🎉 *Nouveau supporter recruté !*\n\n${profileName || "Un ami"} a rejoint Thiès Ma Ville grâce à votre lien ! Jërejëf 🙏\n\nContinuez à partager ! 🏙️`);
        }
      }
    }
    console.log("✅ New WhatsApp user:", phone);
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

COMMANDES: rejoindre | inviter | sondage | info | plainte | traduire | attaque | programme | dashboard | tache | taches

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
📊 *dashboard* — Statistiques campagne

🌐 alhousseynouba.com | 🏙️ thies.city`;
}

// ─── Système de tâches ────────────────────────────────────────────────────────
async function assignerTacheWA(from, args, profileName) {
  const phone = cleanPhone(from);
  if (!ADMIN_PHONES.includes(phone)) return "⛔ Commande réservée à l'équipe de campagne.";

  const parts = args.trim().split(" ");
  const quartier = parts[0];
  const description = parts.slice(1).join(" ");

  if (!quartier || !description) {
    return "❌ Format: *tache [quartier] [description]*\nEx: *tache Nguinth Distribuer les flyers rue principale*";
  }

  const { data: tache, error } = await supabase.from("taches").insert({
    quartier, description, assigned_by: null, status: "active"
  }).select().single();

  if (error) { console.error("❌ Tache error:", error); return "❌ Erreur lors de la création de la tâche."; }

  // Notify benevoles in that quartier via WhatsApp
  const { data: benevoles } = await supabase.from("benevoles").select("*").ilike("quartier", `%${quartier}%`);
  let notifies = 0;
  for (const b of benevoles || []) {
    if (!b.phone) continue;
    try {
      await sendWhatsAppMessage(`whatsapp:${b.phone}`,
        `📋 *Nouvelle Mission — Thiès 2027*\n\n📍 Quartier: *${quartier}*\n📝 Tâche: ${description}\n\nRépondez:\n✅ *fait* — Mission accomplie\n❌ *probleme* — Besoin d'aide\n\n_Jërejëf pour votre engagement !_ 🏙️`);
      notifies++;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }
  return `✅ Tâche assignée à *${notifies} bénévole(s)* de *${quartier}* !\n\n📝 "${description}"`;
}

async function voirTachesWA(from) {
  const phone = cleanPhone(from);
  if (!ADMIN_PHONES.includes(phone)) return "⛔ Commande réservée à l'équipe de campagne.";

  const { data: taches } = await supabase.from("taches").select("*").eq("status", "active").order("created_at", { ascending: false });
  if (!taches || taches.length === 0) return "📋 Aucune tâche active pour le moment.";

  const { data: confirmations } = await supabase.from("tache_confirmations").select("*");
  let text = `📋 *Tâches Actives — Thiès 2027*\n\n`;
  for (const t of taches.slice(0, 5)) {
    const faites = confirmations?.filter(c => c.tache_id === t.id && c.status === "fait").length || 0;
    const problemes = confirmations?.filter(c => c.tache_id === t.id && c.status === "probleme").length || 0;
    text += `*${t.quartier}*: ${t.description}\n✅ ${faites} fait | ❌ ${problemes} problème\n\n`;
  }
  return text;
}

// ─── Admin rapport ────────────────────────────────────────────────────────────
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

// ─── Auto follow-up 24h ───────────────────────────────────────────────────────
async function sendWhatsAppFollowUps() {
  const { data: users } = await supabase.from("users").select("*").not("phone", "is", null);
  if (!users) return;
  for (const user of users) {
    try {
      const { data: existing } = await supabase.from("follow_ups").select("id").eq("phone", user.phone).eq("type", "24h").single();
      if (existing) continue;
    } catch (e) {}
    const firstSeen = new Date(user.first_seen);
    const hoursSince = (Date.now() - firstSeen) / (1000 * 60 * 60);
    if (hoursSince < 24) continue;
    const code = generateCode(user.phone);
    const link = `https://wa.me/${WHATSAPP_NUMBER.replace("whatsapp:+", "")}?text=TMV${code}`;
    try {
      await sendWhatsAppMessage(`whatsapp:${user.phone}`,
        `Salam aleykum *${user.first_name}* ! 🏙️\n\nJërejëf d'avoir rejoint Thiès Ma Ville 2027 !\n\n👉 Avez-vous parlé de la campagne à *3 amis* ?\n\nPartagez votre lien :\n${link}\n\n_Ndank ndank mooy japp golo ci naaye_ 💪`);
      await supabase.from("follow_ups").insert({ telegram_id: null, phone: user.phone, type: "24h" });
      console.log(`✅ WhatsApp follow-up sent to ${user.first_name}`);
    } catch (e) {
      console.error(`❌ Follow-up error:`, e.message);
    }
    await new Promise(r => setTimeout(r, 100));
  }
}

function scheduleWhatsAppFollowUps() {
  setInterval(sendWhatsAppFollowUps, 60 * 60 * 1000);
  setTimeout(sendWhatsAppFollowUps, 5 * 60 * 1000);
  console.log("⏰ WhatsApp follow-up scheduler started");
}

// ─── Dashboard & API ──────────────────────────────────────────────────────────
app.get("/dashboard", (req, res) => {
  try {
    const html = readFileSync(join(__dirname, "dashboard.html"), "utf-8");
    res.type("text/html").send(html);
  } catch (err) {
    res.status(500).send("Dashboard file not found. Make sure dashboard.html is in src/");
  }
});

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

  // ── Greetings ─────────────────────────────────────────────────────────────────
  const greetings = ["bonjour", "salam", "hello", "hi", "salut", "start", "aide", "help", "debut", "début"];
  if (greetings.some(g => msgLower.startsWith(g)) && session.history.length === 0) {
    response.message(welcomeMessage(profileName));
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── Referral code ─────────────────────────────────────────────────────────────
  if (msgLower.startsWith("tmv") && session.history.length === 0) {
    session.referredBy = incomingMsg.trim();
    await trackWhatsAppUser(from, profileName, session.referredBy);
    response.message(welcomeMessage(profileName));
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── inviter ───────────────────────────────────────────────────────────────────
  if (["inviter", "invite", "lien"].includes(msgLower)) {
    const code = generateCode(phone);
    const { data: refs } = await supabase.from("referrals").select("id").eq("referrer_phone", phone);
    const count = refs?.length || 0;
    response.message(`🔗 *Votre lien de recrutement :*\n\nhttps://wa.me/${WHATSAPP_NUMBER.replace("whatsapp:+", "")}?text=TMV${code}\n\nPartagez avec vos amis et famille !\n\n📊 Vous avez recruté *${count} supporter(s)*.\n\n_Ndank ndank mooy japp golo ci naaye !_ 🏙️`);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── dashboard ─────────────────────────────────────────────────────────────────
  if (["dashboard", "stats"].includes(msgLower)) {
    response.message(`📊 *Dashboard Campagne Thiès 2027*\n\nConsultez toutes vos statistiques en temps réel :\n\n🔗 ${DASHBOARD_URL}\n\nSupporters, bénévoles, votes, referrals, carte — tout en un coup d'œil ! 🏙️`);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── tache (admin) ─────────────────────────────────────────────────────────────
  if (msgLower.startsWith("tache ") && ADMIN_PHONES.includes(phone)) {
    const args = incomingMsg.replace(/^tache /i, "");
    const reply = await assignerTacheWA(from, args, profileName);
    response.message(reply);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── taches (admin) ────────────────────────────────────────────────────────────
  if (msgLower === "taches" && ADMIN_PHONES.includes(phone)) {
    const reply = await voirTachesWA(from);
    response.message(reply);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── Confirmation tâche ────────────────────────────────────────────────────────
  if (["fait", "probleme"].includes(msgLower)) {
    const status = msgLower === "fait" ? "fait" : "probleme";
    const { data: taches } = await supabase.from("taches").select("*").eq("status", "active");
    if (taches && taches.length > 0) {
      await supabase.from("tache_confirmations").insert({ tache_id: taches[0].id, telegram_id: null, phone, status });
      response.message(status === "fait"
        ? `✅ Jërejëf ! Mission confirmée. Tu es un vrai champion de Thiès 2027 ! 💪🏙️`
        : `❌ Merci pour le retour ! L'équipe va vous contacter. Jërejëf ! 🙏`);
      res.type("text/xml"); return res.send(response.toString());
    }
  }

  // ── sondage ───────────────────────────────────────────────────────────────────
  if (msgLower === "sondage") {
    session.awaitingSondage = true;
    response.message(`🗳️ *Sondage Thiès 2027*\n\nQuel est votre problème principal à Thiès ?\n\n1️⃣ Routes et pavage\n2️⃣ Eau et électricité\n3️⃣ Emploi et jeunesse\n4️⃣ Santé et hôpital\n5️⃣ Éducation et écoles`);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── Sondage response ──────────────────────────────────────────────────────────
  if (session.awaitingSondage && ["1", "2", "3", "4", "5"].includes(incomingMsg)) {
    const reponses = { "1": "Routes et pavage", "2": "Eau et électricité", "3": "Emploi et jeunesse", "4": "Santé et hôpital", "5": "Éducation et écoles" };
    await supabase.from("votes").insert({ telegram_id: null, question: "Problème principal à Thiès", reponse: reponses[incomingMsg] });
    session.awaitingSondage = false;
    response.message(`✅ Merci pour votre vote ! Jërejëf 🙏\n\nVotre choix: *${reponses[incomingMsg]}*\n\n👉 Recrutez des supporters : tapez *inviter*`);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── rejoindre (benevole) ──────────────────────────────────────────────────────
  if (["rejoindre", "benevole", "bénévole"].includes(msgLower)) {
    session.benevole = { step: 1 };
    response.message(`🤝 *Rejoindre l'équipe !*\n\nWaaw ! Jërejëf pour votre engagement 🙏\n\n*Question 1/2* — Quel est votre quartier à Thiès ?\n(Ex: Médina Fall, Randoulène, Cité Sonatel, Nord, Est, Gare...)`);
    res.type("text/xml"); return res.send(response.toString());
  }

  if (session.benevole) {
    if (session.benevole.step === 1) {
      session.benevole.quartier = incomingMsg;
      session.benevole.step = 2;
      response.message(`*Question 2/2* — Quelle est votre disponibilité ?\n\n1️⃣ Week-end seulement\n2️⃣ Soirs de semaine\n3️⃣ Temps plein`);
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
      response.message(`✅ *Inscription confirmée !*\n\nJërejëf ${profileName || ""} ! Tu fais partie de l'équipe Thiès 2027 ! 🏙️\n\n👉 Recrutez vos amis : tapez *inviter*\n\n*Ndank ndank mooy japp golo ci naaye !* 💪`);
      res.type("text/xml"); return res.send(response.toString());
    }
  }

  // ── rapport (admin) ───────────────────────────────────────────────────────────
  if (msgLower === "rapport" && ADMIN_PHONES.includes(phone)) {
    const rapport = await buildRapport();
    response.message(rapport);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── broadcast (admin) ─────────────────────────────────────────────────────────
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

  // ── reset ─────────────────────────────────────────────────────────────────────
  if (msgLower === "reset") {
    sessions.delete(from);
    response.message("✅ Conversation réinitialisée. Jërejëf !");
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── Claude AI ─────────────────────────────────────────────────────────────────
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
  console.log(`🏙️ ${BOT_NAME} WhatsApp Bot v4 running on port ${PORT}`);
  scheduleWeeklySondage();
  scheduleWhatsAppFollowUps();
});
