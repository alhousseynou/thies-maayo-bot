// Thies Ma Ville — WhatsApp Bot v7b — Voice Fixed (ffmpeg-static)

import express from "express";
import pkg from "twilio";
const { twiml } = pkg;
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, statSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import cors from "cors";
import PDFDocument from "pdfkit";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";

dotenv.config();

// Pointer fluent-ffmpeg vers le binaire embarqué
ffmpeg.setFfmpegPath(ffmpegStatic);

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
const BASE_URL = process.env.BASE_URL || "https://thies-maayo-bot.onrender.com";
const ADMIN_PHONES = ["+221771980297"];
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "RsFOT0jgZkwkcYbjMH9c";

// ─── Audio temp directory ─────────────────────────────────────────────────────
const AUDIO_DIR = join(__dirname, "audio_tmp");
if (!existsSync(AUDIO_DIR)) mkdirSync(AUDIO_DIR, { recursive: true });

function cleanOldAudioFiles() {
  try {
    const files = readdirSync(AUDIO_DIR);
    const now = Date.now();
    for (const file of files) {
      const filePath = join(AUDIO_DIR, file);
      const stat = statSync(filePath);
      if (now - stat.mtimeMs > 60 * 60 * 1000) unlinkSync(filePath);
    }
  } catch (e) {
    console.log("ℹ️ Audio cleanup skipped:", e.message);
  }
}

// ─── Session store ────────────────────────────────────────────────────────────
const sessions = new Map();
function getSession(from) {
  if (!sessions.has(from)) sessions.set(from, { history: [], benevole: null, awaitingSondage: false });
  return sessions.get(from);
}
function generateCode(phone) { return `TMV${phone.replace(/\D/g, "").slice(-8)}`; }
function cleanPhone(from) { return from.replace("whatsapp:", ""); }

// ─── Convert MP3 buffer → OGG via ffmpeg-static ───────────────────────────────
function convertMp3ToOgg(mp3Path, oggPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(mp3Path)
      .audioCodec("libopus")
      .audioBitrate("32k")
      .format("ogg")
      .on("end", resolve)
      .on("error", reject)
      .save(oggPath);
  });
}

// ─── Generate voice with ElevenLabs → OGG ─────────────────────────────────────
async function generateVoiceOgg(text) {
  // 1. Appel ElevenLabs → MP3
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.5,
        use_speaker_boost: true,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ElevenLabs error ${res.status}: ${errText}`);
  }

  const mp3Buffer = Buffer.from(await res.arrayBuffer());
  const audioId = Date.now().toString();
  const mp3Path = join(AUDIO_DIR, `${audioId}.mp3`);
  const oggPath = join(AUDIO_DIR, `${audioId}.ogg`);

  // 2. Sauvegarder MP3 sur disque
  writeFileSync(mp3Path, mp3Buffer);
  console.log(`✅ MP3 saved (${mp3Buffer.length} bytes)`);

  // 3. Convertir MP3 → OGG/OPUS
  try {
    await convertMp3ToOgg(mp3Path, oggPath);
    unlinkSync(mp3Path);
    console.log(`✅ OGG ready: ${audioId}`);
    return { audioId, format: "ogg" };
  } catch (err) {
    console.warn("⚠️ OGG conversion failed, using MP3:", err.message);
    // Fallback : servir le MP3 directement
    return { audioId, format: "mp3" };
  }
}

// ─── Serve audio files ────────────────────────────────────────────────────────
app.get("/audio/:id", (req, res) => {
  const id = req.params.id;
  const oggPath = join(AUDIO_DIR, `${id}.ogg`);
  const mp3Path = join(AUDIO_DIR, `${id}.mp3`);

  if (existsSync(oggPath)) {
    res.setHeader("Content-Type", "audio/ogg");
    res.setHeader("Content-Disposition", "inline; filename=message.ogg");
    return res.send(readFileSync(oggPath));
  } else if (existsSync(mp3Path)) {
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", "inline; filename=message.mp3");
    return res.send(readFileSync(mp3Path));
  } else {
    res.status(404).send("Audio not found");
  }
});

// ─── Send WhatsApp message ────────────────────────────────────────────────────
async function sendWhatsAppMessage(to, body) {
  const client = pkg(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  try {
    await client.messages.create({ from: WHATSAPP_NUMBER, to, body });
  } catch (err) {
    console.error("❌ Twilio send error:", err.message);
  }
}

async function sendWhatsAppMedia(to, body, mediaUrl) {
  const client = pkg(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  try {
    console.log(`📤 Sending media to ${to}: ${mediaUrl}`);
    await client.messages.create({ from: WHATSAPP_NUMBER, to, body, mediaUrl: [mediaUrl] });
    console.log("✅ Media sent!");
  } catch (err) {
    console.error("❌ Twilio media error:", err.message);
    throw err;
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
      telegram_id: null, first_name: profileName || "WhatsApp User", last_name: null,
      username: null, phone, language: "fr", referral_code: referralCode,
      referred_by: referredBy || null, message_count: 1,
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
          await sendWhatsAppMessage(`whatsapp:${referrer.phone}`, `🎉 *Nouveau supporter recruté !*\n\n${profileName || "Un ami"} a rejoint Thiès Ma Ville ! Jërejëf 🙏🏙️`);
        }
      }
    }
  }
}

// ─── System prompts ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es "Thies Ma Ville" — l'assistant officiel de la campagne d'ALHOUSSEYNOU BA, candidat à la Mairie de Thiès en 2027.
NOM: Alhousseynou Ba | SLOGAN: "Thiès 2027 : L'Audace de la Transformation"
PROJET: E-Mairie, Wi-Fi gratuit, 10,000 emplois, Micro-crédits Jaango, Thiès Ville Verte
PERSONNALITÉ: Respectueux, énergique, bilingue français/wolof. Réponses sous 1500 caractères.`;

const WOLOF_PROMPT = `Tu es "Thies Ma Ville". Tu réponds UNIQUEMENT en Wolof pur. Langage simple pour les anciens et marchés de Thiès. Mentionne: Wi-Fi gratuit, E-Mairie, emplois jeunes, routes pavées, micro-crédits Jaango.`;

// ─── Welcome message ──────────────────────────────────────────────────────────
function welcomeMessage(name = "") {
  return `🏙️ *Thies Ma Ville* — Agent Officiel

${name ? `Salam aleykum ${name} !` : "Salam aleykum !"}

Je suis l'assistant d'*Alhousseynou Ba*, candidat Mairie de Thiès 2027.

Tapez :
🔗 *inviter* — Votre lien de recrutement
🤝 *rejoindre* — Rejoindre l'équipe
🗳️ *sondage* — Donner votre avis
🗣️ *wolof [texte]* — Réponse en Wolof
🎙️ *audio [texte]* — Message vocal français
🎙️ *audio-wolof [texte]* — Message vocal Wolof
📊 *dashboard* — Statistiques

🌐 alhousseynouba.com | 🏙️ thies.city`;
}

// ─── PDF generation ───────────────────────────────────────────────────────────
let latestPDFBuffer = null;
let latestPDFDate = null;

async function generatePDFBuffer(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const buffers = [];
    doc.on("data", chunk => buffers.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    const { users, benevoles, votes, referrals } = data;
    const date = new Date().toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

    doc.rect(0, 0, 612, 120).fill("#00c853");
    doc.fillColor("white").fontSize(28).font("Helvetica-Bold").text("THIÈS MA VILLE", 50, 30);
    doc.fontSize(14).font("Helvetica").text("Rapport Hebdomadaire de Campagne", 50, 65);
    doc.fontSize(11).text(date, 50, 88);
    doc.fillColor("#1a1a1a").moveDown(4);

    const kpis = [
      { label: "Total Supporters", value: users.length },
      { label: "Avec Numéro", value: `${users.filter(u => u.phone).length}` },
      { label: "Bénévoles", value: benevoles.length },
      { label: "Votes", value: votes.length },
      { label: "Recrutements", value: referrals.length },
    ];

    let y = 175;
    kpis.forEach((kpi, i) => {
      const x = i % 2 === 0 ? 50 : 320;
      if (i % 2 === 0 && i > 0) y += 55;
      doc.rect(x, y, 240, 45).fillColor("#f0fff0").fill();
      doc.rect(x, y, 4, 45).fillColor("#00c853").fill();
      doc.fillColor("#666").fontSize(10).font("Helvetica").text(kpi.label, x + 12, y + 8);
      doc.fillColor("#1a1a1a").fontSize(20).font("Helvetica-Bold").text(String(kpi.value), x + 12, y + 22);
    });

    doc.rect(0, 780, 612, 60).fillColor("#00c853").fill();
    doc.fillColor("white").fontSize(10).font("Helvetica").text("alhousseynouba.com | thies.city | senegaluni.com", 50, 795, { align: "center", width: 512 });
    doc.fontSize(9).text("Thiès 2027 — L'Audace de la Transformation", 50, 812, { align: "center", width: 512 });
    doc.end();
  });
}

app.get("/rapport.pdf", (req, res) => {
  if (!latestPDFBuffer) { res.status(404).send("Rapport pas encore généré."); return; }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="rapport-thies-2027-${latestPDFDate}.pdf"`);
  res.send(latestPDFBuffer);
});

async function sendWeeklyPDFRapport() {
  try {
    const [usersRes, benevolesRes, votesRes, referralsRes] = await Promise.all([
      supabase.from("users").select("*"),
      supabase.from("benevoles").select("*"),
      supabase.from("votes").select("*"),
      supabase.from("referrals").select("*"),
    ]);
    const data = {
      users: usersRes.data || [],
      benevoles: benevolesRes.data || [],
      votes: votesRes.data || [],
      referrals: referralsRes.data || [],
    };
    latestPDFBuffer = await generatePDFBuffer(data);
    latestPDFDate = new Date().toISOString().split("T")[0];
    const pdfUrl = `${BASE_URL}/rapport.pdf`;
    for (const adminPhone of ADMIN_PHONES) {
      await sendWhatsAppMedia(
        `whatsapp:${adminPhone}`,
        `📊 *Rapport Hebdomadaire — Thiès 2027*\n\n👥 Supporters: ${data.users.length}\n🤝 Bénévoles: ${data.benevoles.length}\n🗳️ Votes: ${data.votes.length}\n\n📄 PDF: ${pdfUrl}\n\n_Jërejëf — Thiès 2027 !_ 🏙️`,
        pdfUrl
      );
    }
    console.log("✅ Weekly PDF rapport sent!");
  } catch (err) {
    console.error("❌ PDF rapport error:", err.message);
  }
}

function scheduleWeeklyPDFRapport() {
  const now = new Date();
  const nextMonday = new Date();
  nextMonday.setUTCHours(8, 0, 0, 0);
  const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
  nextMonday.setUTCDate(now.getUTCDate() + daysUntilMonday);
  const msUntilNext = nextMonday - now;
  console.log(`📄 Next PDF rapport in ${Math.round(msUntilNext / 1000 / 60 / 60)} hours`);
  setTimeout(async () => {
    await sendWeeklyPDFRapport();
    setInterval(sendWeeklyPDFRapport, 7 * 24 * 60 * 60 * 1000);
  }, msUntilNext);
}

// ─── Système de tâches ────────────────────────────────────────────────────────
async function assignerTacheWA(from, args) {
  const phone = cleanPhone(from);
  if (!ADMIN_PHONES.includes(phone)) return "⛔ Commande réservée à l'équipe de campagne.";
  const parts = args.trim().split(" ");
  const quartier = parts[0];
  const description = parts.slice(1).join(" ");
  if (!quartier || !description) return "❌ Format: *tache [quartier] [description]*";
  const { data: tache, error } = await supabase.from("taches").insert({ quartier, description, assigned_by: null, status: "active" }).select().single();
  if (error) return "❌ Erreur lors de la création.";
  const { data: benevoles } = await supabase.from("benevoles").select("*").ilike("quartier", `%${quartier}%`);
  let notifies = 0;
  for (const b of benevoles || []) {
    if (!b.phone) continue;
    try {
      await sendWhatsAppMessage(`whatsapp:${b.phone}`, `📋 *Nouvelle Mission — Thiès 2027*\n\n📍 *${quartier}*\n📝 ${description}\n\n✅ *fait* — Mission accomplie\n❌ *probleme* — Besoin d'aide\n\n_Jërejëf !_ 🏙️`);
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
  if (!taches || taches.length === 0) return "📋 Aucune tâche active.";
  const { data: confirmations } = await supabase.from("tache_confirmations").select("*");
  let text = `📋 *Tâches Actives*\n\n`;
  for (const t of taches.slice(0, 5)) {
    const faites = confirmations?.filter(c => c.tache_id === t.id && c.status === "fait").length || 0;
    const problemes = confirmations?.filter(c => c.tache_id === t.id && c.status === "probleme").length || 0;
    text += `*${t.quartier}*: ${t.description}\n✅ ${faites} | ❌ ${problemes}\n\n`;
  }
  return text;
}

async function creerEvenementWA(from, args) {
  const phone = cleanPhone(from);
  if (!ADMIN_PHONES.includes(phone)) return "⛔ Commande réservée à l'équipe de campagne.";
  const parts = args.trim().split(" ");
  const quartier = parts[0];
  const details = parts.slice(1).join(" ");
  if (!quartier || !details) return "❌ Format: *evenement [quartier] [détails]*";
  const { data: benevoles } = await supabase.from("benevoles").select("*").ilike("quartier", `%${quartier}%`);
  let notifies = 0;
  for (const b of benevoles || []) {
    if (!b.phone) continue;
    try {
      await sendWhatsAppMessage(`whatsapp:${b.phone}`, `📅 *Événement Campagne — Thiès 2027*\n\n📍 Quartier: *${quartier}*\n📋 ${details}\n\n🏙️ Votre présence est importante !\n_Alhousseynou Ba_\n\nJërejëf ! 🙏`);
      notifies++;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }
  return `✅ Événement notifié à *${notifies} bénévole(s)* de *${quartier}* !`;
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
  const { data: users } = await supabase.from("users").select("phone").not("phone", "is", null);
  if (!users) return;
  let sent = 0;
  for (const user of users) {
    try {
      await sendWhatsAppMessage(`whatsapp:${user.phone}`, `🗳️ *Sondage Hebdomadaire — Thiès 2027*\n\n*${sondage.question}*\n\n${choicesText}\n\n_Tapez le numéro de votre choix !_`);
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

async function sendWhatsAppFollowUps() {
  const { data: users } = await supabase.from("users").select("*").not("phone", "is", null);
  if (!users) return;
  for (const user of users) {
    try {
      const { data: existing } = await supabase.from("follow_ups").select("id").eq("phone", user.phone).eq("type", "24h").single();
      if (existing) continue;
    } catch (e) {}
    const hoursSince = (Date.now() - new Date(user.first_seen)) / (1000 * 60 * 60);
    if (hoursSince < 24) continue;
    const code = generateCode(user.phone);
    const link = `https://wa.me/${WHATSAPP_NUMBER.replace("whatsapp:+", "")}?text=TMV${code}`;
    try {
      await sendWhatsAppMessage(`whatsapp:${user.phone}`, `Salam aleykum *${user.first_name}* ! 🏙️\n\nJërejëf d'avoir rejoint Thiès Ma Ville 2027 !\n\n👉 Partagez votre lien à 3 amis :\n${link}\n\n_Ndank ndank mooy japp golo ci naaye_ 💪`);
      await supabase.from("follow_ups").insert({ telegram_id: null, phone: user.phone, type: "24h" });
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
    res.status(500).send("Dashboard file not found.");
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
  res.json({ status: "online", agent: BOT_NAME, version: "v7b" });
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

  // ── Greetings ──────────────────────────────────────────────────────────────
  const greetings = ["bonjour", "salam", "hello", "hi", "salut", "start", "aide", "help"];
  if (greetings.some(g => msgLower.startsWith(g)) && session.history.length === 0) {
    response.message(welcomeMessage(profileName));
    // Message vocal de bienvenue en Wolof
    try {
      const wolofWelcome = `Assalamoualeykoum ${profileName || ""} ! Djeureudjeuf ci yèguèle ci botte bi di Tièss 2027. Mâ ngui Tièss Ma Vile, l'assistant d'Alhousseynou Ba. N'dank n'dank mouy djape golou ci naaye. Tièss maayo !`;
      const { audioId } = await generateVoiceOgg(wolofWelcome);
      const audioUrl = `${BASE_URL}/audio/${audioId}`;
      await sendWhatsAppMedia(from, `🎙️ *Bienvenue — Thiès 2027 !*`, audioUrl);
    } catch(e) {
      console.log("Voice welcome skipped:", e.message);
    }
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── Referral code ──────────────────────────────────────────────────────────
  if (msgLower.startsWith("tmv") && session.history.length === 0) {
    session.referredBy = incomingMsg.trim();
    await trackWhatsAppUser(from, profileName, session.referredBy);
    response.message(welcomeMessage(profileName));
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── audio-wolof ────────────────────────────────────────────────────────────
  if (msgLower.startsWith("audio-wolof ")) {
    const texte = incomingMsg.replace(/^audio-wolof /i, "").trim();
    try {
      const completion = await anthropic.messages.create({
        model: "claude-opus-4-5", max_tokens: 300, system: WOLOF_PROMPT,
        messages: [{ role: "user", content: texte }],
      });
      const wolofText = completion.content.map(b => b.text || "").join("").trim();
      const { audioId } = await generateVoiceOgg(wolofText);
      const audioUrl = `${BASE_URL}/audio/${audioId}`;
      await sendWhatsAppMedia(from, `🎙️ *Message en Wolof — Alhousseynou Ba*\n\n📝 ${wolofText}`, audioUrl);
      response.message("🎙️ Message vocal Wolof envoyé !");
    } catch (e) {
      console.error("❌ Voice-wolof error:", e.message);
      response.message(`❌ Erreur vocale : ${e.message}`);
    }
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── audio ──────────────────────────────────────────────────────────────────
  if (msgLower.startsWith("audio ")) {
    const texte = incomingMsg.replace(/^audio /i, "").trim();
    try {
      const { audioId } = await generateVoiceOgg(texte);
      const audioUrl = `${BASE_URL}/audio/${audioId}`;
      await sendWhatsAppMedia(from, `🎙️ *Message vocal — Alhousseynou Ba*`, audioUrl);
      response.message("🎙️ Message vocal envoyé !");
    } catch (e) {
      console.error("❌ Voice error:", e.message);
      response.message(`❌ Erreur vocale : ${e.message}`);
    }
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── wolof ──────────────────────────────────────────────────────────────────
  if (msgLower.startsWith("wolof ")) {
    const texte = incomingMsg.replace(/^wolof /i, "");
    try {
      const completion = await anthropic.messages.create({
        model: "claude-opus-4-5", max_tokens: 400, system: WOLOF_PROMPT,
        messages: [{ role: "user", content: texte }],
      });
      const reply = completion.content.map(b => b.text || "").join("").trim();
      response.message(`🗣️ *En Wolof:*\n\n${reply}`);
    } catch (e) {
      response.message("❌ Erreur. Réessayez.");
    }
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── inviter ────────────────────────────────────────────────────────────────
  if (["inviter", "invite", "lien"].includes(msgLower)) {
    const code = generateCode(phone);
    const { data: refs } = await supabase.from("referrals").select("id").eq("referrer_phone", phone);
    response.message(`🔗 *Votre lien de recrutement :*\n\nhttps://wa.me/${WHATSAPP_NUMBER.replace("whatsapp:+", "")}?text=TMV${code}\n\nPartagez avec vos amis !\n\n📊 Vous avez recruté *${refs?.length || 0} supporter(s)*.\n\n_Ndank ndank mooy japp golo ci naaye !_ 🏙️`);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── dashboard ──────────────────────────────────────────────────────────────
  if (["dashboard", "stats"].includes(msgLower)) {
    response.message(`📊 *Dashboard Campagne*\n\n🔗 ${DASHBOARD_URL}\n\nSupporters, bénévoles, votes, carte ! 🏙️`);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── pdf (admin) ────────────────────────────────────────────────────────────
  if (msgLower === "pdf" && ADMIN_PHONES.includes(phone)) {
    await sendWeeklyPDFRapport();
    response.message(`📄 Rapport PDF généré !\n\n🔗 ${BASE_URL}/rapport.pdf`);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── evenement (admin) ──────────────────────────────────────────────────────
  if (msgLower.startsWith("evenement ") && ADMIN_PHONES.includes(phone)) {
    const reply = await creerEvenementWA(from, incomingMsg.replace(/^evenement /i, ""));
    response.message(reply);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── tache (admin) ──────────────────────────────────────────────────────────
  if (msgLower.startsWith("tache ") && ADMIN_PHONES.includes(phone)) {
    const reply = await assignerTacheWA(from, incomingMsg.replace(/^tache /i, ""));
    response.message(reply);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── taches (admin) ─────────────────────────────────────────────────────────
  if (msgLower === "taches" && ADMIN_PHONES.includes(phone)) {
    const reply = await voirTachesWA(from);
    response.message(reply);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── rapport (admin) ────────────────────────────────────────────────────────
  if (msgLower === "rapport" && ADMIN_PHONES.includes(phone)) {
    const { data: users } = await supabase.from("users").select("*");
    const { data: benevoles } = await supabase.from("benevoles").select("*");
    const { data: votes } = await supabase.from("votes").select("*");
    const { data: referrals } = await supabase.from("referrals").select("*");
    response.message(`📊 *Rapport — Thiès 2027*\n\n👥 Supporters: ${users?.length || 0}\n🤝 Bénévoles: ${benevoles?.length || 0}\n🗳️ Votes: ${votes?.length || 0}\n🔗 Referrals: ${referrals?.length || 0}\n\n📊 ${DASHBOARD_URL}\n📄 ${BASE_URL}/rapport.pdf\n\n_Thiès 2027 !_ 🏙️`);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── Confirmation tâche ─────────────────────────────────────────────────────
  if (["fait", "probleme"].includes(msgLower)) {
    const status = msgLower === "fait" ? "fait" : "probleme";
    const { data: taches } = await supabase.from("taches").select("*").eq("status", "active");
    if (taches && taches.length > 0) {
      await supabase.from("tache_confirmations").insert({ tache_id: taches[0].id, telegram_id: null, phone, status });
      response.message(status === "fait" ? `✅ Jërejëf ! Mission confirmée ! 💪🏙️` : `❌ Merci ! L'équipe va vous contacter. 🙏`);
      res.type("text/xml"); return res.send(response.toString());
    }
  }

  // ── sondage ────────────────────────────────────────────────────────────────
  if (msgLower === "sondage") {
    session.awaitingSondage = true;
    response.message(`🗳️ *Sondage Thiès 2027*\n\nQuel est votre problème principal ?\n\n1️⃣ Routes et pavage\n2️⃣ Eau et électricité\n3️⃣ Emploi et jeunesse\n4️⃣ Santé et hôpital\n5️⃣ Éducation et écoles`);
    res.type("text/xml"); return res.send(response.toString());
  }

  if (session.awaitingSondage && ["1", "2", "3", "4", "5"].includes(incomingMsg)) {
    const reponses = { "1": "Routes et pavage", "2": "Eau et électricité", "3": "Emploi et jeunesse", "4": "Santé et hôpital", "5": "Éducation et écoles" };
    await supabase.from("votes").insert({ telegram_id: null, question: "Problème principal à Thiès", reponse: reponses[incomingMsg] });
    session.awaitingSondage = false;
    response.message(`✅ Merci ! Jërejëf 🙏\n\nVotre choix: *${reponses[incomingMsg]}*\n\n👉 Tapez *inviter* pour recruter !`);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── rejoindre ──────────────────────────────────────────────────────────────
  if (["rejoindre", "benevole", "bénévole"].includes(msgLower)) {
    session.benevole = { step: 1 };
    response.message(`🤝 *Rejoindre l'équipe !*\n\nWaaw ! Jërejëf 🙏\n\n*Question 1/2* — Quel est votre quartier à Thiès ?`);
    res.type("text/xml"); return res.send(response.toString());
  }

  if (session.benevole) {
    if (session.benevole.step === 1) {
      session.benevole.quartier = incomingMsg;
      session.benevole.step = 2;
      response.message(`*Question 2/2* — Disponibilité ?\n\n1️⃣ Week-end\n2️⃣ Soirs\n3️⃣ Temps plein`);
      res.type("text/xml"); return res.send(response.toString());
    }
    if (session.benevole.step === 2) {
      await supabase.from("benevoles").insert({
        telegram_id: null, first_name: profileName || "WhatsApp User", last_name: null,
        quartier: session.benevole.quartier, disponibilite: incomingMsg, phone,
      });
      session.benevole = null;
      response.message(`✅ *Inscription confirmée !*\n\nJërejëf ${profileName || ""} ! Tu fais partie de l'équipe Thiès 2027 ! 🏙️\n\n👉 Tapez *inviter* pour recruter vos amis\n\n*Ndank ndank mooy japp golo ci naaye !* 💪`);
      res.type("text/xml"); return res.send(response.toString());
    }
  }

  // ── broadcast (admin) ──────────────────────────────────────────────────────
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

  // ── reset ──────────────────────────────────────────────────────────────────
  if (msgLower === "reset") {
    sessions.delete(from);
    response.message("✅ Conversation réinitialisée. Jërejëf !");
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── Claude AI ──────────────────────────────────────────────────────────────
  session.history.push({ role: "user", content: incomingMsg });
  if (session.history.length > 20) session.history = session.history.slice(-20);
  try {
    const completion = await anthropic.messages.create({
      model: "claude-opus-4-5", max_tokens: 800, system: SYSTEM_PROMPT, messages: session.history,
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
    response.message("⚠️ Une erreur est survenue. Réessayez.");
  }

  res.type("text/xml");
  res.send(response.toString());
});

app.post("/reset/:phone", (req, res) => {
  sessions.delete(`whatsapp:+${req.params.phone}`);
  res.json({ reset: true });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🏙️ ${BOT_NAME} WhatsApp Bot v7b running on port ${PORT}`);
  cleanOldAudioFiles();
  scheduleWeeklySondage();
  scheduleWhatsAppFollowUps();
  scheduleWeeklyPDFRapport();
});
