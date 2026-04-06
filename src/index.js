// Thies Ma Ville — WhatsApp Bot v5 — Phase 2

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
import PDFDocument from "pdfkit";
import { PassThrough } from "stream";

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
const BASE_URL = process.env.BASE_URL || "https://thies-maayo-bot.onrender.com";
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
function cleanPhone(from) { return from.replace("whatsapp:", ""); }

// ─── Send WhatsApp message ────────────────────────────────────────────────────
async function sendWhatsAppMessage(to, body) {
  const client = pkg(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  try {
    await client.messages.create({ from: WHATSAPP_NUMBER, to, body });
  } catch (err) {
    console.error("❌ Twilio send error:", err.message);
  }
}

// ─── Send WhatsApp message with media ────────────────────────────────────────
async function sendWhatsAppMedia(to, body, mediaUrl) {
  const client = pkg(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  try {
    await client.messages.create({ from: WHATSAPP_NUMBER, to, body, mediaUrl: [mediaUrl] });
  } catch (err) {
    console.error("❌ Twilio media send error:", err.message);
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
        await supabase.from("referrals").insert({ referrer_telegram_id: referrer.telegram_id || null, referred_telegram_id: null, referrer_phone: referrer.phone || null, referred_phone: phone });
        if (referrer.phone) await sendWhatsAppMessage(`whatsapp:${referrer.phone}`, `🎉 *Nouveau supporter recruté !*\n\n${profileName || "Un ami"} a rejoint Thiès Ma Ville grâce à votre lien ! Jërejëf 🙏\n\nContinuez à partager ! 🏙️`);
      }
    }
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es "Thies Ma Ville" — l'assistant officiel de la campagne d'ALHOUSSEYNOU BA, candidat à la Mairie de Thiès en 2027. Tu opères sur WhatsApp.

NOM: Alhousseynou Ba | SLOGAN: "Thiès 2027 : L'Audace de la Transformation"
PARTI: FARLU | COALITION: Sénégal Uni | SITE: alhousseynouba.com | WA: +221 77 198 02 97

PROJET THIÈS:
AXE 1 — GOUVERNANCE: Conseil des Sages, Budget Participatif 15%
AXE 2 — DIGITAL: E-Mairie, Wi-Fi Public gratuit
AXE 3 — INTERNATIONAL: Jumelages USA/Égypte/Turquie, 10,000 emplois sur 3 ans
AXE 4 — FONDS CITOYEN: Micro-crédits Jaango sans intérêts
AXE 5 — CADRE DE VIE: Pavage, Thiès Ville Verte, collecte déchets géolocalisée

TES FONCTIONS: TRADUCTION | ATTAQUE | PROGRAMME | PLAINTE
PERSONNALITÉ: Respectueux, énergique, bilingue français/wolof. Salam aleykum, Waaw, Jërejëf.
RÈGLES: Réponses TOUJOURS sous 1500 caractères. Spécifique à Thiès. Détection langue auto.`;

const WOLOF_PROMPT = `Tu es "Thies Ma Ville" — l'assistant officiel de la campagne d'ALHOUSSEYNOU BA. Tu réponds UNIQUEMENT en Wolof pur. Utilise un langage simple et accessible pour les anciens et les marchés. Mentionne les projets: Wi-Fi gratuit, E-Mairie, emplois jeunes, routes, micro-crédits Jaango.`;

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
🔗 *inviter* — Votre lien de recrutement
🤝 *rejoindre* — Rejoindre l'équipe
🗳️ *sondage* — Donner votre avis
📊 *dashboard* — Statistiques campagne
🗣️ *wolof [texte]* — Réponse en Wolof

🌐 alhousseynouba.com | 🏙️ thies.city`;
}

// ─── Generate PDF rapport ─────────────────────────────────────────────────────
async function generatePDFBuffer(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const buffers = [];
    doc.on('data', chunk => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const { users, benevoles, votes, referrals } = data;
    const total = users.length;
    const avecNumero = users.filter(u => u.phone).length;
    const totalBen = benevoles.length;
    const totalVotes = votes.length;
    const totalRefs = referrals.length;

    const byQuartier = {};
    benevoles.forEach(b => { byQuartier[b.quartier] = (byQuartier[b.quartier] || 0) + 1; });

    const byReponse = {};
    votes.forEach(v => { byReponse[v.reponse] = (byReponse[v.reponse] || 0) + 1; });

    const date = new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // Header
    doc.rect(0, 0, 612, 120).fill('#00c853');
    doc.fillColor('white').fontSize(28).font('Helvetica-Bold').text('THIÈS MA VILLE', 50, 30);
    doc.fontSize(14).font('Helvetica').text('Rapport Hebdomadaire de Campagne', 50, 65);
    doc.fontSize(11).text(date, 50, 88);

    doc.fillColor('#1a1a1a').moveDown(4);

    // KPIs
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#00c853').text('📊 STATISTIQUES CLÉS', 50, 140);
    doc.moveTo(50, 160).lineTo(560, 160).strokeColor('#00c853').stroke();

    const kpis = [
      { label: 'Total Supporters', value: total },
      { label: 'Avec Numéro', value: `${avecNumero} (${total ? Math.round(avecNumero/total*100) : 0}%)` },
      { label: 'Bénévoles', value: totalBen },
      { label: 'Votes Sondage', value: totalVotes },
      { label: 'Recrutements', value: totalRefs },
    ];

    let y = 175;
    kpis.forEach((kpi, i) => {
      const x = i % 2 === 0 ? 50 : 320;
      if (i % 2 === 0 && i > 0) y += 55;
      doc.rect(x, y, 240, 45).fillColor('#f0fff0').fill();
      doc.rect(x, y, 4, 45).fillColor('#00c853').fill();
      doc.fillColor('#666').fontSize(10).font('Helvetica').text(kpi.label, x + 12, y + 8);
      doc.fillColor('#1a1a1a').fontSize(20).font('Helvetica-Bold').text(String(kpi.value), x + 12, y + 22);
    });

    y += 80;

    // Benevoles by quartier
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#00c853').text('🗺️ BÉNÉVOLES PAR QUARTIER', 50, y);
    doc.moveTo(50, y + 20).lineTo(560, y + 20).strokeColor('#00c853').stroke();
    y += 35;

    const quartierList = Object.entries(byQuartier).sort((a, b) => b[1] - a[1]);
    if (quartierList.length === 0) {
      doc.fillColor('#666').fontSize(12).font('Helvetica').text('Aucun bénévole encore.', 50, y);
      y += 25;
    } else {
      quartierList.forEach(([q, n]) => {
        const barW = Math.min((n / Math.max(...quartierList.map(x => x[1]))) * 300, 300);
        doc.fillColor('#1a1a1a').fontSize(12).font('Helvetica-Bold').text(q, 50, y);
        doc.rect(200, y + 2, barW, 14).fillColor('#00c853').fill();
        doc.fillColor('#1a1a1a').fontSize(12).font('Helvetica').text(String(n), 510, y);
        y += 25;
      });
    }

    y += 15;

    // Votes
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#00c853').text('🗳️ RÉSULTATS SONDAGE', 50, y);
    doc.moveTo(50, y + 20).lineTo(560, y + 20).strokeColor('#00c853').stroke();
    y += 35;

    const voteList = Object.entries(byReponse).sort((a, b) => b[1] - a[1]);
    if (voteList.length === 0) {
      doc.fillColor('#666').fontSize(12).font('Helvetica').text('Aucun vote encore.', 50, y);
      y += 25;
    } else {
      voteList.forEach(([r, n]) => {
        const barW = Math.min((n / Math.max(...voteList.map(x => x[1]))) * 250, 250);
        doc.fillColor('#1a1a1a').fontSize(11).font('Helvetica').text(r, 50, y, { width: 200 });
        doc.rect(260, y + 2, barW, 14).fillColor('#2979ff').fill();
        doc.fillColor('#1a1a1a').fontSize(11).font('Helvetica').text(String(n), 520, y);
        y += 25;
      });
    }

    y += 15;

    // Supporters list
    if (y < 650) {
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#00c853').text('👥 DERNIERS SUPPORTERS', 50, y);
      doc.moveTo(50, y + 20).lineTo(560, y + 20).strokeColor('#00c853').stroke();
      y += 35;

      const recent = users.slice(-8).reverse();
      recent.forEach(u => {
        doc.fillColor('#1a1a1a').fontSize(11).font('Helvetica')
          .text(`${u.first_name}${u.last_name ? ' ' + u.last_name : ''}`, 50, y, { width: 200 })
          .text(u.language?.toUpperCase() || 'FR', 260, y, { width: 60 })
          .text(u.phone ? '✓ Numéro' : '— Sans numéro', 330, y, { width: 120 })
          .text(u.first_seen ? new Date(u.first_seen).toLocaleDateString('fr-FR') : '—', 460, y);
        y += 20;
      });
    }

    // Footer
    doc.rect(0, 780, 612, 60).fillColor('#00c853').fill();
    doc.fillColor('white').fontSize(10).font('Helvetica')
      .text('alhousseynouba.com  |  thies.city  |  senegaluni.com', 50, 795, { align: 'center', width: 512 });
    doc.fontSize(9).text('Thiès 2027 — L\'Audace de la Transformation', 50, 812, { align: 'center', width: 512 });

    doc.end();
  });
}

// Store latest PDF in memory for serving
let latestPDFBuffer = null;
let latestPDFDate = null;

app.get("/rapport.pdf", (req, res) => {
  if (!latestPDFBuffer) {
    res.status(404).send("Rapport pas encore généré. Attendez lundi matin.");
    return;
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="rapport-thies-2027-${latestPDFDate}.pdf"`);
  res.send(latestPDFBuffer);
});

// ─── Send weekly PDF rapport every Monday at 8am ──────────────────────────────
async function sendWeeklyPDFRapport() {
  console.log("📄 Generating weekly PDF rapport...");
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
    latestPDFDate = new Date().toISOString().split('T')[0];
    const pdfUrl = `${BASE_URL}/rapport.pdf`;

    // Send to admin
    for (const adminPhone of ADMIN_PHONES) {
      await sendWhatsAppMedia(
        `whatsapp:${adminPhone}`,
        `📊 *Rapport Hebdomadaire — Thiès 2027*\n\n_${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}_\n\n👥 Supporters: ${data.users.length}\n🤝 Bénévoles: ${data.benevoles.length}\n🗳️ Votes: ${data.votes.length}\n🔗 Referrals: ${data.referrals.length}\n\n📄 Rapport PDF complet:\n${pdfUrl}\n\n_Jërejëf — Thiès 2027 !_ 🏙️`,
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

// ─── Système d'événements ─────────────────────────────────────────────────────
async function creerEvenementWA(from, args) {
  const phone = cleanPhone(from);
  if (!ADMIN_PHONES.includes(phone)) return "⛔ Commande réservée à l'équipe de campagne.";

  const parts = args.trim().split(" ");
  const quartier = parts[0];
  const details = parts.slice(1).join(" ");

  if (!quartier || !details) {
    return "❌ Format: *evenement [quartier] [détails]*\nEx: *evenement Nguinth Réunion samedi 15h place du marché*";
  }

  const { data: benevoles } = await supabase.from("benevoles").select("*").ilike("quartier", `%${quartier}%`);
  let notifies = 0;
  for (const b of benevoles || []) {
    if (!b.phone) continue;
    try {
      await sendWhatsAppMessage(`whatsapp:${b.phone}`,
        `📅 *Événement Campagne — Thiès 2027*\n\n📍 Quartier: *${quartier}*\n📋 ${details}\n\n🏙️ Votre présence est importante !\n_Alhousseynou Ba — L'Audace de la Transformation_\n\nJërejëf ! 🙏`);
      notifies++;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }
  return `✅ Événement notifié à *${notifies} bénévole(s)* de *${quartier}* !\n\n📋 "${details}"`;
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
  if (error) return "❌ Erreur lors de la création de la tâche.";

  const { data: benevoles } = await supabase.from("benevoles").select("*").ilike("quartier", `%${quartier}%`);
  let notifies = 0;
  for (const b of benevoles || []) {
    if (!b.phone) continue;
    try {
      await sendWhatsAppMessage(`whatsapp:${b.phone}`,
        `📋 *Nouvelle Mission — Thiès 2027*\n\n📍 Quartier: *${quartier}*\n📝 Tâche: ${description}\n\nRépondez:\n✅ *fait* — Mission accomplie\n❌ *probleme* — Besoin d'aide\n\n_Jërejëf !_ 🏙️`);
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

// ─── Admin rapport texte ──────────────────────────────────────────────────────
async function buildRapport() {
  const { data: users } = await supabase.from("users").select("*");
  const { data: benevoles } = await supabase.from("benevoles").select("*");
  const { data: votes } = await supabase.from("votes").select("*");
  const { data: referrals } = await supabase.from("referrals").select("*");
  const total = users?.length || 0;
  const avecNumero = users?.filter(u => u.phone).length || 0;
  const byQuartier = {};
  benevoles?.forEach(b => { byQuartier[b.quartier] = (byQuartier[b.quartier] || 0) + 1; });
  const quartierText = Object.entries(byQuartier).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([q, n]) => `  • ${q}: ${n}`).join("\n") || "  Aucun encore";
  const byReponse = {};
  votes?.forEach(v => { byReponse[v.reponse] = (byReponse[v.reponse] || 0) + 1; });
  const votesText = Object.entries(byReponse).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `  • ${r}: ${n}`).join("\n") || "  Aucun encore";
  return `📊 *Rapport — Thiès 2027*\n_${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}_\n\n👥 *Supporters: ${total}*\n  • Avec numéro: ${avecNumero} (${total ? Math.round((avecNumero / total) * 100) : 0}%)\n\n🤝 *Bénévoles: ${benevoles?.length || 0}*\n${quartierText}\n\n🗳️ *Votes: ${votes?.length || 0}*\n${votesText}\n\n🔗 *Referrals: ${referrals?.length || 0}*\n\n📊 Dashboard: ${DASHBOARD_URL}\n📄 PDF: ${BASE_URL}/rapport.pdf\n\n_Thiès 2027 : L'Audace de la Transformation !_ 🏙️`;
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
    try { await sendWhatsAppMessage(`whatsapp:${user.phone}`, message); sent++; await new Promise(r => setTimeout(r, 100)); } catch (e) {}
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
  setTimeout(async () => { await sendWeeklySondage(); setInterval(sendWeeklySondage, 7 * 24 * 60 * 60 * 1000); }, msUntilNext);
}

// ─── Auto follow-up 24h ───────────────────────────────────────────────────────
async function sendWhatsAppFollowUps() {
  const { data: users } = await supabase.from("users").select("*").not("phone", "is", null);
  if (!users) return;
  for (const user of users) {
    try { const { data: existing } = await supabase.from("follow_ups").select("id").eq("phone", user.phone).eq("type", "24h").single(); if (existing) continue; } catch (e) {}
    const hoursSince = (Date.now() - new Date(user.first_seen)) / (1000 * 60 * 60);
    if (hoursSince < 24) continue;
    const code = generateCode(user.phone);
    const link = `https://wa.me/${WHATSAPP_NUMBER.replace("whatsapp:+", "")}?text=TMV${code}`;
    try {
      await sendWhatsAppMessage(`whatsapp:${user.phone}`, `Salam aleykum *${user.first_name}* ! 🏙️\n\nJërejëf d'avoir rejoint Thiès Ma Ville 2027 !\n\n👉 Avez-vous parlé de la campagne à *3 amis* ?\n\nPartagez votre lien :\n${link}\n\n_Ndank ndank mooy japp golo ci naaye_ 💪`);
      await supabase.from("follow_ups").insert({ telegram_id: null, phone: user.phone, type: "24h" });
    } catch (e) { console.error(`❌ Follow-up error:`, e.message); }
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
  try { const html = readFileSync(join(__dirname, "dashboard.html"), "utf-8"); res.type("text/html").send(html); }
  catch (err) { res.status(500).send("Dashboard file not found."); }
});

app.get("/api/stats", async (req, res) => {
  try {
    const [usersRes, benevolesRes, votesRes, referralsRes] = await Promise.all([
      supabase.from("users").select("*"), supabase.from("benevoles").select("*"),
      supabase.from("votes").select("*"), supabase.from("referrals").select("*"),
    ]);
    res.json({ users: usersRes.data || [], benevoles: benevolesRes.data || [], votes: votesRes.data || [], referrals: referralsRes.data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/", (req, res) => { res.json({ status: "online", agent: BOT_NAME, timestamp: new Date().toISOString() }); });

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
  const greetings = ["bonjour", "salam", "hello", "hi", "salut", "start", "aide", "help"];
  if (greetings.some(g => msgLower.startsWith(g)) && session.history.length === 0) {
    response.message(welcomeMessage(profileName)); res.type("text/xml"); return res.send(response.toString());
  }

  // ── Referral code ─────────────────────────────────────────────────────────────
  if (msgLower.startsWith("tmv") && session.history.length === 0) {
    session.referredBy = incomingMsg.trim();
    await trackWhatsAppUser(from, profileName, session.referredBy);
    response.message(welcomeMessage(profileName)); res.type("text/xml"); return res.send(response.toString());
  }

  // ── inviter ───────────────────────────────────────────────────────────────────
  if (["inviter", "invite", "lien"].includes(msgLower)) {
    const code = generateCode(phone);
    const { data: refs } = await supabase.from("referrals").select("id").eq("referrer_phone", phone);
    response.message(`🔗 *Votre lien de recrutement :*\n\nhttps://wa.me/${WHATSAPP_NUMBER.replace("whatsapp:+", "")}?text=TMV${code}\n\nPartagez avec vos amis !\n\n📊 Vous avez recruté *${refs?.length || 0} supporter(s)*.\n\n_Ndank ndank mooy japp golo ci naaye !_ 🏙️`);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── dashboard ─────────────────────────────────────────────────────────────────
  if (["dashboard", "stats"].includes(msgLower)) {
    response.message(`📊 *Dashboard Campagne Thiès 2027*\n\n🔗 ${DASHBOARD_URL}\n\nSupporters, bénévoles, votes, carte — tout en un coup d'œil ! 🏙️`);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── wolof ─────────────────────────────────────────────────────────────────────
  if (msgLower.startsWith("wolof ")) {
    const texte = incomingMsg.replace(/^wolof /i, "");
    try {
      const completion = await anthropic.messages.create({
        model: "claude-opus-4-5", max_tokens: 400, system: WOLOF_PROMPT,
        messages: [{ role: "user", content: texte }],
      });
      const reply = completion.content.map(b => b.text || "").join("").trim();
      response.message(`🗣️ *En Wolof:*\n\n${reply}`);
    } catch (e) { response.message("❌ Erreur. Réessayez."); }
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── evenement (admin) ─────────────────────────────────────────────────────────
  if (msgLower.startsWith("evenement ") && ADMIN_PHONES.includes(phone)) {
    const args = incomingMsg.replace(/^evenement /i, "");
    const reply = await creerEvenementWA(from, args);
    response.message(reply); res.type("text/xml"); return res.send(response.toString());
  }

  // ── tache (admin) ─────────────────────────────────────────────────────────────
  if (msgLower.startsWith("tache ") && ADMIN_PHONES.includes(phone)) {
    const args = incomingMsg.replace(/^tache /i, "");
    const reply = await assignerTacheWA(from, args);
    response.message(reply); res.type("text/xml"); return res.send(response.toString());
  }

  // ── taches (admin) ────────────────────────────────────────────────────────────
  if (msgLower === "taches" && ADMIN_PHONES.includes(phone)) {
    const reply = await voirTachesWA(from);
    response.message(reply); res.type("text/xml"); return res.send(response.toString());
  }

  // ── rapport (admin) ───────────────────────────────────────────────────────────
  if (msgLower === "rapport" && ADMIN_PHONES.includes(phone)) {
    const rapport = await buildRapport();
    response.message(rapport); res.type("text/xml"); return res.send(response.toString());
  }

  // ── pdf (admin) ───────────────────────────────────────────────────────────────
  if (msgLower === "pdf" && ADMIN_PHONES.includes(phone)) {
    await sendWeeklyPDFRapport();
    response.message(`📄 Rapport PDF généré et envoyé !\n\n🔗 ${BASE_URL}/rapport.pdf`);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── Confirmation tâche ────────────────────────────────────────────────────────
  if (["fait", "probleme"].includes(msgLower)) {
    const status = msgLower === "fait" ? "fait" : "probleme";
    const { data: taches } = await supabase.from("taches").select("*").eq("status", "active");
    if (taches && taches.length > 0) {
      await supabase.from("tache_confirmations").insert({ tache_id: taches[0].id, telegram_id: null, phone, status });
      response.message(status === "fait" ? `✅ Jërejëf ! Mission confirmée. Tu es un vrai champion de Thiès 2027 ! 💪🏙️` : `❌ Merci pour le retour ! L'équipe va vous contacter. Jërejëf ! 🙏`);
      res.type("text/xml"); return res.send(response.toString());
    }
  }

  // ── sondage ───────────────────────────────────────────────────────────────────
  if (msgLower === "sondage") {
    session.awaitingSondage = true;
    response.message(`🗳️ *Sondage Thiès 2027*\n\nQuel est votre problème principal à Thiès ?\n\n1️⃣ Routes et pavage\n2️⃣ Eau et électricité\n3️⃣ Emploi et jeunesse\n4️⃣ Santé et hôpital\n5️⃣ Éducation et écoles`);
    res.type("text/xml"); return res.send(response.toString());
  }

  if (session.awaitingSondage && ["1", "2", "3", "4", "5"].includes(incomingMsg)) {
    const reponses = { "1": "Routes et pavage", "2": "Eau et électricité", "3": "Emploi et jeunesse", "4": "Santé et hôpital", "5": "Éducation et écoles" };
    await supabase.from("votes").insert({ telegram_id: null, question: "Problème principal à Thiès", reponse: reponses[incomingMsg] });
    session.awaitingSondage = false;
    response.message(`✅ Merci ! Jërejëf 🙏\n\nVotre choix: *${reponses[incomingMsg]}*\n\n👉 Recrutez : tapez *inviter*`);
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── rejoindre ─────────────────────────────────────────────────────────────────
  if (["rejoindre", "benevole", "bénévole"].includes(msgLower)) {
    session.benevole = { step: 1 };
    response.message(`🤝 *Rejoindre l'équipe !*\n\nWaaw ! Jërejëf 🙏\n\n*Question 1/2* — Quel est votre quartier à Thiès ?`);
    res.type("text/xml"); return res.send(response.toString());
  }

  if (session.benevole) {
    if (session.benevole.step === 1) {
      session.benevole.quartier = incomingMsg; session.benevole.step = 2;
      response.message(`*Question 2/2* — Disponibilité ?\n\n1️⃣ Week-end\n2️⃣ Soirs\n3️⃣ Temps plein`);
      res.type("text/xml"); return res.send(response.toString());
    }
    if (session.benevole.step === 2) {
      await supabase.from("benevoles").insert({ telegram_id: null, first_name: profileName || "WhatsApp User", last_name: null, quartier: session.benevole.quartier, disponibilite: incomingMsg, phone });
      session.benevole = null;
      response.message(`✅ *Inscription confirmée !*\n\nJërejëf ${profileName || ""} ! Tu fais partie de l'équipe Thiès 2027 ! 🏙️\n\n👉 Tapez *inviter* pour recruter vos amis\n\n*Ndank ndank mooy japp golo ci naaye !* 💪`);
      res.type("text/xml"); return res.send(response.toString());
    }
  }

  // ── broadcast (admin) ─────────────────────────────────────────────────────────
  if (msgLower.startsWith("broadcast ") && ADMIN_PHONES.includes(phone)) {
    const message = incomingMsg.replace(/^broadcast /i, "");
    const { data: users } = await supabase.from("users").select("phone").not("phone", "is", null);
    let envoye = 0;
    for (const user of users || []) {
      try { await sendWhatsAppMessage(`whatsapp:${user.phone}`, `📢 *Message de campagne*\n\n${message}\n\n🏙️ _Alhousseynou Ba — Thiès 2027_`); envoye++; await new Promise(r => setTimeout(r, 100)); } catch (e) {}
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
    const completion = await anthropic.messages.create({ model: "claude-opus-4-5", max_tokens: 800, system: SYSTEM_PROMPT, messages: session.history });
    const reply = completion.content.map(b => b.text || "").join("").trim();
    session.history.push({ role: "assistant", content: reply });
    if (reply.length > 1580) { const chunks = reply.match(/.{1,1580}(\s|$)/gs) || [reply]; chunks.forEach(chunk => response.message(chunk.trim())); }
    else response.message(reply);
  } catch (err) { response.message("⚠️ Une erreur est survenue. Veuillez réessayer."); }

  res.type("text/xml"); res.send(response.toString());
});

app.post("/reset/:phone", (req, res) => {
  sessions.delete(`whatsapp:+${req.params.phone}`);
  res.json({ reset: true });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🏙️ ${BOT_NAME} WhatsApp Bot v5 running on port ${PORT}`);
  scheduleWeeklySondage();
  scheduleWhatsAppFollowUps();
  scheduleWeeklyPDFRapport();
});
