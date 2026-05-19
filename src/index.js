// Thies Ma Ville — WhatsApp Bot v9 — Thies Uni + Voice + Carte PDF

import express from "express";
import twilio from "twilio";
const { twiml } = twilio;
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, statSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import cors from "cors";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";

dotenv.config();
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
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const AUDIO_DIR = join(__dirname, "audio_tmp");
if (!existsSync(AUDIO_DIR)) mkdirSync(AUDIO_DIR, { recursive: true });

// ─── THIES UNI CONFIG ────────────────────────────────────────────────────────
const COMMUNES_THIES = [
  "Thies Nord","Thies Est","Thies Ouest",
  "Pout","Khombole","Thienaba","Fandene","Notto Gouye Diama","Notto Niobass",
  "Mbour","Joal-Fadiouth","Nguekhokh",
  "Tivaouane","Pambal","Mekesse"
];

const tuSessions = new Map();
function getTuSession(phone) {
  if (!tuSessions.has(phone)) tuSessions.set(phone, {});
  return tuSessions.get(phone);
}
function getCurrentSemaine() {
  const now = new Date();
  const yr = now.getFullYear();
  const start = new Date(yr, 0, 1);
  const wk = Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
  return yr + "-S" + String(wk).padStart(2,"0");
}
function getSemaineLabel() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay() + 1);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = d => d.toLocaleDateString("fr-FR", { day:"numeric", month:"short" });
  return fmt(start) + " - " + fmt(end);
}

// ─── THIES UNI POINTS ───────────────────────────────────────────────────────
async function addPoints(phone, nom, quartier, commune, points) {
  try {
    const { data } = await supabase.from("thiesuni_points").select("*").eq("militant_chat_id", phone).maybeSingle();
    if (data) {
      await supabase.from("thiesuni_points").update({ points_total: data.points_total + points, updated_at: new Date().toISOString() }).eq("militant_chat_id", phone);
    } else {
      await supabase.from("thiesuni_points").insert({ militant_chat_id: phone, militant_nom: nom, quartier, commune, points_total: points });
    }
  } catch(err) { console.error("addPoints error:", err.message); }
}

async function addBadge(phone, badge) {
  try {
    const { data } = await supabase.from("thiesuni_points").select("badges").eq("militant_chat_id", phone).maybeSingle();
    if (data) {
      const badges = data.badges || [];
      if (!badges.includes(badge)) {
        await supabase.from("thiesuni_points").update({ badges: [...badges, badge] }).eq("militant_chat_id", phone);
        return true;
      }
    }
  } catch(err) { console.error("addBadge error:", err.message); }
  return false;
}

// ─── THIES UNI HANDLERS ──────────────────────────────────────────────────────

// /tucellule
async function startTuCellule(phone) {
  getTuSession(phone).cellule = { step: 1 };
  return "Enregistrer une Cellule - Thies Uni\n\nEtape 1/3 - Nom du responsable ?";
}
async function handleTuCellule(phone, text) {
  try {
    const s = getTuSession(phone);
    const c = s.cellule;
    if (c.step === 1) { c.nom = text; c.step = 2; return "Etape 2/3 - Quartier ?"; }
    if (c.step === 2) { c.quartier = text; c.step = 3;
      const ct = COMMUNES_THIES.map((cm,i) => (i+1) + ". " + cm).join("\n");
      return "Etape 3/3 - Commune ?\n\n" + ct + "\n\nTapez le numero"; }
    if (c.step === 3 && /^\d+$/.test(text)) {
      const idx = parseInt(text) - 1;
      if (idx >= 0 && idx < COMMUNES_THIES.length) {
        c.commune = COMMUNES_THIES[idx];
        await supabase.from("thiesuni_cellules").insert({ quartier: c.quartier, commune: c.commune, responsable_chat_id: phone, responsable_nom: c.nom });
        await addPoints(phone, c.nom, c.quartier, c.commune, 50);
        await addBadge(phone, "Fondateur de Cellule");
        delete s.cellule;
        return "Cellule enregistree !\n" + c.nom + "\n" + c.quartier + " - " + c.commune + "\n\n+50 points\nBadge : Fondateur de Cellule !\n\nThies Uni";
      }
    }
    return null;
  } catch(err) { console.error("handleTuCellule error:", err.message); delete getTuSession(phone).cellule; return "Erreur. Tapez tucellule pour recommencer."; }
}

// /tuqrcode
async function startTuQrcode(phone) {
  try {
    const { data: cellule } = await supabase.from("thiesuni_cellules").select("*").eq("responsable_chat_id", phone).maybeSingle();
    if (!cellule) return "Vous n'avez pas encore de cellule.\n\nTapez tucellule pour creer votre cellule !";
    const lien = "https://wa.me/" + WHATSAPP_NUMBER.replace("whatsapp:+","") + "?text=TUCELLULE_" + cellule.id;
    const qrBuffer = await QRCode.toBuffer(lien, { errorCorrectionLevel: "M", type: "png", width: 400, margin: 2, color: { dark: "#009639", light: "#FFFFFF" } });
    const qrId = "qr_" + Date.now();
    writeFileSync(join(AUDIO_DIR, qrId + ".png"), qrBuffer);
    const qrUrl = BASE_URL + "/qr/" + qrId;
    const { data: membres } = await supabase.from("thiesuni_membres_qr").select("*").eq("cellule_id", cellule.id);
    await sendWhatsAppMedia("whatsapp:+" + phone.replace(/\D/g,""), "QR CODE - CELLULE THIES UNI\n\nResponsable: " + cellule.responsable_nom + "\nQuartier: " + cellule.quartier + "\nCommune: " + cellule.commune + "\n\nFaites scanner ce QR code !\nLien: " + lien + "\n\nMembres recrutes: " + (membres?.length || 0) + "/20", qrUrl);
    return null;
  } catch(err) { console.error("QR error:", err.message); return "Erreur QR Code. Reessayez."; }
}

// /turapport
async function startTuRapport(phone) {
  getTuSession(phone).rapport = { step: 1 };
  return "Rapport Hebdomadaire - Thies Uni\nSemaine : " + getSemaineLabel() + "\n\nEtape 1/9 - Votre prenom et nom ?";
}
async function handleTuRapport(phone, text) {
  try {
    const s = getTuSession(phone); const r = s.rapport;
    if (r.step===1) { r.nom=text; r.step=2;
      return "Etape 2/9 - Votre commune ?\n\n" + COMMUNES_THIES.map((c,i) => (i+1)+". "+c).join("\n") + "\n\nTapez le numero"; }
    if (r.step===2 && /^\d+$/.test(text)) { const idx=parseInt(text)-1;
      if (idx>=0 && idx<COMMUNES_THIES.length) { r.commune=COMMUNES_THIES[idx]; r.step=3; return "Etape 3/9 - Votre quartier ?"; } return null; }
    if (r.step===3) { r.quartier=text; r.step=4; return "Etape 4/9 - Cellules creees cette semaine ?"; }
    if (r.step===4) { r.cellules=parseInt(text)||0; r.step=5; return "Etape 5/9 - Cartes de soutien vendues ?"; }
    if (r.step===5) { r.cartes=parseInt(text)||0; r.step=6; return "Etape 6/9 - T-shirts vendus ?"; }
    if (r.step===6) { r.tshirts=parseInt(text)||0; r.step=7; return "Etape 7/9 - Nouveaux membres enregistres ?"; }
    if (r.step===7) { r.membres=parseInt(text)||0; r.step=8; return "Etape 8/9 - Portes frappees ?"; }
    if (r.step===8) { r.portes=parseInt(text)||0; r.step=9; return "Etape 9/9 - Bilan rapide ? (ou tapez ok)"; }
    if (r.step===9) { r.bilan=text==="ok"?"":text;
      await supabase.from("thiesuni_rapports").insert({ responsable_chat_id:phone, responsable_nom:r.nom, quartier:r.quartier, commune:r.commune, semaine:getCurrentSemaine(), cellules_crees:r.cellules, cartes_vendues:r.cartes, tshirts_vendus:r.tshirts, nouveaux_membres:r.membres, portes_frappees:r.portes, bilan:r.bilan });
      const pts = (r.cellules*10)+(r.cartes*2)+(r.membres*1)+Math.floor(r.portes*0.5);
      await addPoints(phone, r.nom, r.quartier, r.commune, pts);
      const isNew = await addBadge(phone, "Premier Rapport");
      delete s.rapport;
      return "Rapport enregistre !\nCellules:"+r.cellules+" Cartes:"+r.cartes+" T-shirts:"+r.tshirts+"\nMembres:"+r.membres+" Portes:"+r.portes+"\n\n+"+pts+" points !"+(isNew?"\nBadge : Premier Rapport !":"")+"\n\nThies Uni"; }
    return null;
  } catch(err) { console.error("handleTuRapport error:", err.message); delete getTuSession(phone).rapport; return "Erreur. Tapez turapport pour recommencer."; }
}

// /tureseaux
async function startTuReseaux(phone) {
  getTuSession(phone).reseaux = { step: 1 };
  return "Rapport Reseaux - Thies Uni\nSemaine : " + getSemaineLabel() + "\n\nEtape 1/6 - Votre prenom et nom ?";
}
async function handleTuReseaux(phone, text) {
  try {
    const s = getTuSession(phone); const r = s.reseaux;
    if (r.step===1) { r.nom=text; r.step=2; return "Etape 2/6 - Posts publies cette semaine ?"; }
    if (r.step===2) { r.posts=parseInt(text)||0; r.step=3; return "Etape 3/6 - Total vues cumulees ?"; }
    if (r.step===3) { r.vues=parseInt(text)||0; r.step=4; return "Etape 4/6 - Total likes ?"; }
    if (r.step===4) { r.likes=parseInt(text)||0; r.step=5; return "Etape 5/6 - Total partages ?"; }
    if (r.step===5) { r.partages=parseInt(text)||0; r.step=6; return "Etape 6/6 - Nouveaux followers ?"; }
    if (r.step===6) { r.followers=parseInt(text)||0;
      await supabase.from("thiesuni_reseaux").insert({ militant_chat_id:phone, militant_nom:r.nom, semaine:getCurrentSemaine(), posts:r.posts, vues:r.vues, likes:r.likes, partages:r.partages, nouveaux_followers:r.followers });
      const pts = Math.floor((r.vues/100)+(r.likes*2)+(r.partages*3)+(r.followers*5));
      await addPoints(phone, r.nom, "", "", pts);
      delete s.reseaux;
      return "Stats enregistrees !\nPosts:"+r.posts+" Vues:"+r.vues+" Likes:"+r.likes+"\nPartages:"+r.partages+" Followers:"+r.followers+"\n\n+"+pts+" points !\n\nThies Uni"; }
    return null;
  } catch(err) { console.error("handleTuReseaux error:", err.message); delete getTuSession(phone).reseaux; return "Erreur. Tapez tureseaux pour recommencer."; }
}

// /tupaiement
async function startTuPaiement(phone) {
  getTuSession(phone).paiement = { step: 1 };
  return "Declarer une Vente - Thies Uni\n\nEtape 1/5 - Votre nom ?";
}
async function handleTuPaiement(phone, text) {
  try {
    const s = getTuSession(phone); const p = s.paiement;
    if (p.step===1) { p.nom=text; p.step=2; return "Etape 2/5 - Type ?\n1. Carte de soutien\n2. T-shirt\n3. Autre"; }
    if (p.step===2 && /^[1-3]$/.test(text)) { p.type=text==="1"?"carte":text==="2"?"tshirt":"autre"; p.step=3; return "Etape 3/5 - Quantite ?"; }
    if (p.step===3) { p.quantite=parseInt(text)||0; p.step=4; return "Etape 4/5 - Montant total (FCFA) ?"; }
    if (p.step===4) { p.montant=parseInt(text)||0; p.step=5;
      return "Etape 5/5 - Votre commune ?\n\n" + COMMUNES_THIES.map((cm,i) => (i+1)+". "+cm).join("\n") + "\n\nTapez le numero"; }
    if (p.step===5 && /^\d+$/.test(text)) { const idx=parseInt(text)-1;
      if (idx>=0 && idx<COMMUNES_THIES.length) { p.commune=COMMUNES_THIES[idx];
        await supabase.from("thiesuni_ventes").insert({ militant_chat_id:phone, militant_nom:p.nom, commune:p.commune, semaine:getCurrentSemaine(), type_vente:p.type, quantite:p.quantite, montant:p.montant });
        const pts = Math.floor(p.montant/500);
        await addPoints(phone, p.nom, "", p.commune, pts);
        delete s.paiement;
        return "Vente enregistree !\n" + p.type + " x" + p.quantite + " = " + p.montant + " FCFA\n\n+" + pts + " points !\n\nThies Uni"; } }
    return null;
  } catch(err) { console.error("handleTuPaiement error:", err.message); delete getTuSession(phone).paiement; return "Erreur. Tapez tupaiement pour recommencer."; }
}

// /tudashboard
async function sendTuDashboard(phone) {
  try {
    const semaine = getCurrentSemaine();
    const { data: raps } = await supabase.from("thiesuni_rapports").select("*").eq("semaine",semaine);
    const { data: cellules } = await supabase.from("thiesuni_cellules").select("*");
    const { data: all } = await supabase.from("thiesuni_rapports").select("*");
    const tc = raps?.reduce((s,r)=>s+(r.cellules_crees||0),0)||0;
    const tk = raps?.reduce((s,r)=>s+(r.cartes_vendues||0),0)||0;
    const tm = raps?.reduce((s,r)=>s+(r.nouveaux_membres||0),0)||0;
    const tp = raps?.reduce((s,r)=>s+(r.portes_frappees||0),0)||0;
    const ac = all?.reduce((s,r)=>s+(r.cellules_crees||0),0)||0;
    const am = all?.reduce((s,r)=>s+(r.nouveaux_membres||0),0)||0;
    const best = [...(raps||[])].sort((a,b)=>(b.cellules_crees+b.cartes_vendues+b.nouveaux_membres)-(a.cellules_crees+a.cartes_vendues+a.nouveaux_membres))[0];
    return "DASHBOARD THIES UNI\n" + getSemaineLabel() + "\n\nTERRAIN\nCellules:" + tc + " Cartes:" + tk + "\nMembres:" + tm + " Portes:" + tp + "\nRapports:" + (raps?.length||0) + "\n\nCUMULE\nCellules:" + ac + " Membres:" + am + "\nCellules actives:" + (cellules?.length||0) + "\n\nMeilleur: " + (best?best.responsable_nom:"N/A") + "\n\nThies Uni - Senegal Uni";
  } catch(err) { console.error("sendTuDashboard error:", err.message); return "Erreur dashboard. Reessayez."; }
}

// /tupalmares
async function sendTuPalmares() {
  try {
    const semaine = getCurrentSemaine();
    const { data: raps } = await supabase.from("thiesuni_rapports").select("*").eq("semaine",semaine);
    const { data: points } = await supabase.from("thiesuni_points").select("*").order("points_total",{ascending:false}).limit(5);
    if (!raps?.length) return "Aucun rapport cette semaine.\n\nTapez turapport";
    const medals = ["1.","2.","3.","4.","5."];
    const sorted = [...(raps||[])].sort((a,b)=>(b.cellules_crees+b.cartes_vendues+b.nouveaux_membres)-(a.cellules_crees+a.cartes_vendues+a.nouveaux_membres)).slice(0,5);
    let msg = "PALMARES - " + getSemaineLabel() + "\n\nTOP TERRAIN\n";
    sorted.forEach((r,i) => { msg += medals[i]+" "+r.responsable_nom+" - "+r.quartier+"\nCellules:"+r.cellules_crees+" Membres:"+r.nouveaux_membres+"\n\n"; });
    if (points?.length) { msg += "TOP POINTS\n"; points.forEach((p,i) => { msg += medals[i]+" "+p.militant_nom+" - "+p.points_total+"pts\n"; }); }
    return msg + "\nThies Uni - Senegal Uni";
  } catch(err) { return "Erreur. Reessayez."; }
}

// /tuequipe
async function sendTuEquipe() {
  try {
    const { data: cellules } = await supabase.from("thiesuni_cellules").select("*").order("commune");
    if (!cellules?.length) return "Aucune cellule enregistree.\n\nTapez tucellule";
    const byCommune = {};
    cellules.forEach(c => { if (!byCommune[c.commune]) byCommune[c.commune] = []; byCommune[c.commune].push(c); });
    let msg = "EQUIPE THIES UNI\n\n";
    for (const [commune, cells] of Object.entries(byCommune)) {
      msg += commune.toUpperCase() + " (" + cells.length + " cellules)\n";
      cells.slice(0,3).forEach(c => { msg += "  - " + c.responsable_nom + " (" + c.quartier + ")\n"; });
      if (cells.length > 3) msg += "  ... et " + (cells.length-3) + " autres\n";
      msg += "\n";
    }
    return msg + "Total: " + cellules.length + " cellules\nThies Uni - Senegal Uni";
  } catch(err) { return "Erreur. Reessayez."; }
}

// /tumonprofil
async function sendTuProfil(phone) {
  try {
    const { data: p } = await supabase.from("thiesuni_points").select("*").eq("militant_chat_id", phone).maybeSingle();
    if (!p) return "Pas encore de profil.\n\nTapez tucellule ou turapport pour commencer !";
    const { data: raps } = await supabase.from("thiesuni_rapports").select("*").eq("responsable_chat_id", phone);
    const badges = p.badges?.join(", ") || "Aucun";
    return "MON PROFIL - THIES UNI\n\n" + p.militant_nom + "\n" + p.quartier + " - " + p.commune + "\n\nPoints: " + p.points_total + "\nRapports: " + (raps?.length||0) + "\nBadges: " + badges + "\n\nThies Uni - Senegal Uni";
  } catch(err) { return "Erreur. Reessayez."; }
}

// ─── Welcome message ──────────────────────────────────────────────────────────
function welcomeMessage(name = "") {
  return "Thies Ma Ville v9\n\n" +
    (name ? "Salam aleykum " + name + " !" : "Salam aleykum !") + "\n\n" +
    "Je suis l'assistant d'*Alhousseynou Ba*, candidat Mairie de Thies 2027.\n\n" +
    "CAMPAGNE\n" +
    "inviter - Votre lien de recrutement\n" +
    "rejoindre - Rejoindre l'equipe\n" +
    "carte - Carte de soutien PDF\n" +
    "sondage - Donner votre avis\n\n" +
    "THIES UNI - TERRAIN\n" +
    "tucellule - Enregistrer une cellule\n" +
    "turapport - Rapport hebdomadaire\n" +
    "tupaiement - Declarer une vente\n" +
    "tureseaux - Stats reseaux\n" +
    "tuqrcode - QR code de ma cellule\n\n" +
    "THIES UNI - SUIVI\n" +
    "tudashboard - Dashboard complet\n" +
    "tupalmares - Classement semaine\n" +
    "tuequipe - Voir toute l'equipe\n" +
    "tumonprofil - Mon profil et points\n\n" +
    "AUTRES\n" +
    "wolof [texte] - Reponse en Wolof\n" +
    "audio [texte] - Message vocal\n" +
    "dashboard - Statistiques campagne\n\n" +
    "alhousseynouba.com";
}

// ─── Serve QR PNG ─────────────────────────────────────────────────────────────
app.get("/qr/:id", (req, res) => {
  const qrPath = join(AUDIO_DIR, req.params.id + ".png");
  if (existsSync(qrPath)) {
    res.setHeader("Content-Type", "image/png");
    return res.send(readFileSync(qrPath));
  }
  res.status(404).send("QR not found");
});

// ─── 9 Niveaux de soutien ─────────────────────────────────────────────────────
const NIVEAUX_CARTE = [
  { id:"citoyen",      emoji:"", name:"Citoyen",       price:"GRATUIT",      amount:0,      color:"#4488ff" },
  { id:"ami",          emoji:"", name:"Ami de Thies",  price:"GRATUIT",      amount:0,      color:"#00cc55" },
  { id:"supporter",    emoji:"", name:"Supporter",     price:"1 000 FCFA",   amount:1000,   color:"#ff8800" },
  { id:"contributeur", emoji:"", name:"Contributeur",  price:"2 000 FCFA",   amount:2000,   color:"#00cccc" },
  { id:"acteur",       emoji:"", name:"Acteur",        price:"5 000 FCFA",   amount:5000,   color:"#cc44ff" },
  { id:"champion",     emoji:"", name:"Champion",      price:"10 000 FCFA",  amount:10000,  color:"#4499ff" },
  { id:"batisseur",    emoji:"", name:"Batisseur",     price:"50 000 FCFA",  amount:50000,  color:"#ffaa33" },
  { id:"ambassadeur",  emoji:"", name:"Ambassadeur",   price:"100 000 FCFA", amount:100000, color:"#FFD700" },
  { id:"mecene",       emoji:"", name:"Grand Mecene",  price:"250 000 FCFA", amount:250000, color:"#ff9933" },
];

async function generateCartePDF({ prenom, nom, quartier, phone, niveauId }) {
  const niv = NIVEAUX_CARTE.find(n => n.id === niveauId) || NIVEAUX_CARTE[1];
  const code = "TMV-" + (phone||"").replace(/\D/g,"").slice(-4).padStart(4,"0") + "-" + Date.now().toString().slice(-4);
  const fullName = (prenom + " " + (nom||"")).toUpperCase();
  const displayName = fullName.length > 22 ? fullName.substring(0,22) + "..." : fullName;
  const dateStr = new Date().toLocaleDateString("fr-FR");
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [500, 315], margin: 0 });
    const buffers = [];
    doc.on("data", chunk => buffers.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);
    doc.rect(0, 0, 500, 315).fill("#0a1a0a");
    doc.rect(190, 0, 310, 315).fill("#0a1505").opacity(0.97);
    doc.rect(190, 0, 3, 315).fill(niv.color);
    doc.fontSize(20).font("Helvetica-Bold").fill("#FFD700").text("THIES 2027", 205, 16, { width: 220 });
    doc.fontSize(7).font("Helvetica").fill("rgba(255,255,255,0.45)").text("L'AUDACE DE LA TRANSFORMATION", 205, 40);
    doc.fontSize(8).font("Helvetica-Bold").fill(niv.color).text(niv.name.toUpperCase(), 212, 57);
    doc.fontSize(15).font("Helvetica-Bold").fill("#ffffff").text("ALHOUSSEYNOU BA", 205, 100);
    doc.fontSize(6.5).font("Helvetica").fill("#ffffff45").text("CANDIDAT MAIRIE DE THIES - COALITION SENEGAL UNI", 205, 119);
    doc.fontSize(13).font("Helvetica-Bold").fill(niv.color).text(displayName, 205, 144);
    doc.fontSize(8.5).font("Helvetica").fill(niv.color + "bb").text(code, 205, 163);
    doc.fontSize(7.5).font("Helvetica").fill("#ffffff40").text(quartier || "Thies", 205, 178);
    doc.fontSize(7).fill("#ffffff25").text("Emise le " + dateStr, 205, 192);
    doc.fontSize(7).font("Helvetica").fill("#ffffff30").text("alhousseynouba.com", 205, 276);
    if (niv.amount > 0) { doc.fontSize(9).font("Helvetica-Bold").fill(niv.color).text(niv.price, 370, 290, { width: 115, align: "right" }); }
    doc.rect(0, 311, 500, 4).fill(niv.color);
    doc.end();
  });
}

app.get("/carte/:id", (req, res) => {
  const cartePath = join(AUDIO_DIR, req.params.id + ".pdf");
  if (existsSync(cartePath)) {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=carte-soutien-thies2027.pdf");
    return res.send(readFileSync(cartePath));
  }
  res.status(404).send("Carte non trouvee");
});

async function envoyerCarteWhatsApp(from, carteData) {
  try {
    const niv = NIVEAUX_CARTE.find(n => n.id === carteData.niveauId) || NIVEAUX_CARTE[1];
    const pdfBuffer = await generateCartePDF(carteData);
    const carteId = "carte_" + Date.now();
    writeFileSync(join(AUDIO_DIR, carteId + ".pdf"), pdfBuffer);
    const carteUrl = BASE_URL + "/carte/" + carteId;
    await sendWhatsAppMedia(from, "Votre Carte de Soutien !\n\n" + niv.name + " - " + niv.price + "\n" + carteData.prenom + " " + (carteData.nom||"") + "\n" + carteData.quartier + "\n\nalhousseynouba.com\n\nJerejef ! Thies 2027", carteUrl);
    await supabase.from("benevoles").insert({ first_name: carteData.prenom, last_name: carteData.nom || null, phone: carteData.phone || null, quartier: carteData.quartier, disponibilite: "Soutien-" + niv.name, telegram_id: null });
    for (const adminPhone of ADMIN_PHONES) { try { await sendWhatsAppMessage("whatsapp:" + adminPhone, "Nouvelle Carte !\n" + carteData.prenom + " " + (carteData.nom||"") + "\n" + niv.name + " - " + niv.price + "\n" + carteData.quartier); } catch(e) {} }
  } catch(err) { console.error("Carte error:", err.message); await sendWhatsAppMessage(from, "Erreur carte. Contactez +221771980297"); }
}

function cleanOldFiles() {
  try {
    const files = readdirSync(AUDIO_DIR);
    const now = Date.now();
    for (const file of files) {
      const filePath = join(AUDIO_DIR, file);
      const stat = statSync(filePath);
      if (!file.endsWith(".pdf") && !file.startsWith("qr_") && now - stat.mtimeMs > 60 * 60 * 1000) unlinkSync(filePath);
    }
  } catch(e) { console.log("Cleanup skipped:", e.message); }
}

const sessions = new Map();
function getSession(from) {
  if (!sessions.has(from)) sessions.set(from, { history: [], benevole: null, awaitingSondage: false, carte: null });
  return sessions.get(from);
}
function generateCode(phone) { return "TMV" + phone.replace(/\D/g, "").slice(-8); }
function cleanPhone(from) { return from.replace("whatsapp:+", "").replace("whatsapp:", ""); }

function convertMp3ToOgg(mp3Path, oggPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(mp3Path).audioCodec("libopus").audioBitrate("32k").format("ogg")
      .on("end", resolve).on("error", reject).save(oggPath);
  });
}

async function generateVoiceOgg(text) {
  const res = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + ELEVENLABS_VOICE_ID, {
    method: "POST", headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.35, similarity_boost: 0.80, style: 0.40, use_speaker_boost: true } }),
  });
  if (!res.ok) throw new Error("ElevenLabs error " + res.status);
  const mp3Buffer = Buffer.from(await res.arrayBuffer());
  const audioId = Date.now().toString();
  const mp3Path = join(AUDIO_DIR, audioId + ".mp3");
  const oggPath = join(AUDIO_DIR, audioId + ".ogg");
  writeFileSync(mp3Path, mp3Buffer);
  try { await convertMp3ToOgg(mp3Path, oggPath); unlinkSync(mp3Path); return { audioId, format: "ogg" }; }
  catch(err) { return { audioId, format: "mp3" }; }
}

app.get("/audio/:id", (req, res) => {
  const id = req.params.id;
  const oggPath = join(AUDIO_DIR, id + ".ogg");
  const mp3Path = join(AUDIO_DIR, id + ".mp3");
  if (existsSync(oggPath)) { res.setHeader("Content-Type", "audio/ogg"); return res.send(readFileSync(oggPath)); }
  else if (existsSync(mp3Path)) { res.setHeader("Content-Type", "audio/mpeg"); return res.send(readFileSync(mp3Path)); }
  else res.status(404).send("Audio not found");
});

async function sendWhatsAppMessage(to, body) {
  try { await twilioClient.messages.create({ from: WHATSAPP_NUMBER, to, body }); }
  catch(err) { console.error("Twilio send error:", err.message); }
}

async function sendWhatsAppMedia(to, body, mediaUrl) {
  try { await twilioClient.messages.create({ from: WHATSAPP_NUMBER, to, body, mediaUrl: [mediaUrl] }); }
  catch(err) { console.error("Twilio media error:", err.message); throw err; }
}

async function trackWhatsAppUser(from, profileName = null, referredBy = null) {
  try {
    const phone = cleanPhone(from);
    const { data } = await supabase.from("users").select("id, message_count").eq("phone", phone).maybeSingle();
    if (data) {
      await supabase.from("users").update({ message_count: (data.message_count||0) + 1 }).eq("phone", phone);
    } else {
      await supabase.from("users").insert({ telegram_id: null, first_name: profileName || "WhatsApp User", last_name: null, username: null, phone, language: "fr", referral_code: generateCode(phone), referred_by: referredBy || null, message_count: 1 });
      if (referredBy) {
        const { data: referrer } = await supabase.from("users").select("telegram_id, phone, first_name").eq("referral_code", referredBy).maybeSingle();
        if (referrer?.phone) { try { await sendWhatsAppMessage("whatsapp:+" + referrer.phone, "Nouveau supporter ! " + (profileName||"Un ami") + " a rejoint ! Jerejef"); } catch(e) {} }
      }
    }
  } catch(err) { console.error("trackUser error:", err.message); }
}

const SYSTEM_PROMPT = "Tu es Thies Ma Ville l'assistant officiel d'ALHOUSSEYNOU BA, candidat Mairie de Thies 2027. PROJET: E-Mairie, Wi-Fi gratuit, 10000 emplois. LANGUE: Reponds TOUJOURS en francais. Reponses sous 1500 caracteres.";
const WOLOF_PROMPT = "Tu es Thies Ma Ville. Tu reponds UNIQUEMENT en Wolof phonetique pour audio.";

const SONDAGES = [
  { question: "Quel est votre probleme principal a Thies ?", choices: { "1":"Routes et pavage","2":"Eau et electricite","3":"Emploi et jeunesse","4":"Sante et hopital","5":"Education et ecoles" } },
];
let currentSondageIndex = 0;

async function sendWeeklySondage() {
  try {
    const sondage = SONDAGES[currentSondageIndex % SONDAGES.length]; currentSondageIndex++;
    const choicesText = Object.entries(sondage.choices).map(([k,v]) => k + ". " + v).join("\n");
    const { data: users } = await supabase.from("users").select("phone").not("phone","is",null);
    let sent = 0;
    for (const user of users||[]) { try { await sendWhatsAppMessage("whatsapp:+" + user.phone, "Sondage - Thies 2027\n\n" + sondage.question + "\n\n" + choicesText + "\n\nTapez le numero !"); sent++; await new Promise(r=>setTimeout(r,100)); } catch(e) {} }
    console.log("Sondage envoye a " + sent + " users");
  } catch(err) { console.error("sendWeeklySondage error:", err.message); }
}

function scheduleWeeklySondage() {
  const now = new Date(); const nextSunday = new Date();
  nextSunday.setUTCHours(9,0,0,0);
  const days = (7 - now.getUTCDay()) % 7 || 7;
  nextSunday.setUTCDate(now.getUTCDate() + days);
  setTimeout(async () => { await sendWeeklySondage(); setInterval(sendWeeklySondage, 7*24*60*60*1000); }, nextSunday - now);
}

let latestPDFBuffer = null; let latestPDFDate = null;
async function generatePDFBuffer(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const buffers = [];
    doc.on("data", chunk => buffers.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);
    doc.rect(0, 0, 612, 120).fill("#00c853");
    doc.fillColor("white").fontSize(28).font("Helvetica-Bold").text("THIES MA VILLE", 50, 30);
    doc.fontSize(14).font("Helvetica").text("Rapport Campagne", 50, 65);
    doc.fontSize(11).text(new Date().toLocaleDateString("fr-FR"), 50, 88);
    doc.fillColor("#1a1a1a").moveDown(4);
    const kpis = [
      { label:"Supporters", value:data.users.length },
      { label:"Benevoles", value:data.benevoles.length },
      { label:"Votes", value:data.votes.length },
      { label:"Cellules TU", value:data.cellules?.length||0 },
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
    doc.fillColor("white").fontSize(10).font("Helvetica").text("alhousseynouba.com | Thies 2027", 50, 795, { align:"center", width:512 });
    doc.end();
  });
}

app.get("/rapport.pdf", (req, res) => {
  if (!latestPDFBuffer) { res.status(404).send("Rapport pas encore genere."); return; }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=rapport-thies-2027.pdf");
  res.send(latestPDFBuffer);
});

async function sendWeeklyPDFRapport() {
  try {
    const [usersRes, benevolesRes, votesRes, cellulesRes] = await Promise.all([
      supabase.from("users").select("*"), supabase.from("benevoles").select("*"),
      supabase.from("votes").select("*"), supabase.from("thiesuni_cellules").select("*"),
    ]);
    const data = { users:usersRes.data||[], benevoles:benevolesRes.data||[], votes:votesRes.data||[], cellules:cellulesRes.data||[] };
    latestPDFBuffer = await generatePDFBuffer(data);
    latestPDFDate = new Date().toISOString().split("T")[0];
    const pdfUrl = BASE_URL + "/rapport.pdf";
    for (const adminPhone of ADMIN_PHONES) { try { await sendWhatsAppMedia("whatsapp:" + adminPhone, "Rapport Hebdo - Thies 2027\n\nSupporters: " + data.users.length + "\nBenevoles: " + data.benevoles.length + "\nCellules: " + data.cellules.length + "\n\n" + pdfUrl, pdfUrl); } catch(e) {} }
    console.log("PDF rapport sent!");
  } catch(err) { console.error("PDF rapport error:", err.message); }
}

app.get("/dashboard", (req, res) => {
  try { const html = readFileSync(join(__dirname, "dashboard.html"), "utf-8"); res.type("text/html").send(html); }
  catch(err) { res.status(500).send("Dashboard file not found."); }
});

app.get("/api/stats", async (req, res) => {
  try {
    const [usersRes, benevolesRes, votesRes, cellulesRes] = await Promise.all([
      supabase.from("users").select("*"), supabase.from("benevoles").select("*"),
      supabase.from("votes").select("*"), supabase.from("thiesuni_cellules").select("*"),
    ]);
    res.json({ users:usersRes.data||[], benevoles:benevolesRes.data||[], votes:votesRes.data||[], cellules:cellulesRes.data||[] });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get("/", (req, res) => { res.json({ status:"online", agent:BOT_NAME, version:"v9" }); });

// ─── MAIN WEBHOOK ─────────────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  const MessagingResponse = twiml.MessagingResponse;
  const response = new MessagingResponse();
  const incomingMsg = (req.body.Body || "").trim();
  const from = req.body.From || "unknown";
  const profileName = req.body.ProfileName || null;
  const phone = cleanPhone(from);
  const session = getSession(from);
  const msgLower = incomingMsg.toLowerCase();

  await trackWhatsAppUser(from, profileName);

  // ── THIÈS UNI COMMANDES ──────────────────────────────────────────────────
  if (msgLower === "tucellule") { const reply = await startTuCellule(phone); if (reply) response.message(reply); res.type("text/xml"); return res.send(response.toString()); }
  if (msgLower === "turapport") { const reply = await startTuRapport(phone); if (reply) response.message(reply); res.type("text/xml"); return res.send(response.toString()); }
  if (msgLower === "tureseaux") { const reply = await startTuReseaux(phone); if (reply) response.message(reply); res.type("text/xml"); return res.send(response.toString()); }
  if (msgLower === "tupaiement") { const reply = await startTuPaiement(phone); if (reply) response.message(reply); res.type("text/xml"); return res.send(response.toString()); }
  if (msgLower === "tuqrcode") { const reply = await startTuQrcode(phone); if (reply) response.message(reply); res.type("text/xml"); return res.send(response.toString()); }
  if (msgLower === "tudashboard") { const reply = await sendTuDashboard(phone); response.message(reply); res.type("text/xml"); return res.send(response.toString()); }
  if (msgLower === "tupalmares") { const reply = await sendTuPalmares(); response.message(reply); res.type("text/xml"); return res.send(response.toString()); }
  if (msgLower === "tuequipe") { const reply = await sendTuEquipe(); response.message(reply); res.type("text/xml"); return res.send(response.toString()); }
  if (msgLower === "tumonprofil") { const reply = await sendTuProfil(phone); response.message(reply); res.type("text/xml"); return res.send(response.toString()); }
  if (msgLower === "tuannuler") { tuSessions.delete(phone); response.message("Saisie annulee."); res.type("text/xml"); return res.send(response.toString()); }

  // ── THIÈS UNI SESSIONS ACTIVES ───────────────────────────────────────────
  const tuS = getTuSession(phone);
  if (tuS.rapport) { const reply = await handleTuRapport(phone, incomingMsg); if (reply) response.message(reply); res.type("text/xml"); return res.send(response.toString()); }
  if (tuS.reseaux) { const reply = await handleTuReseaux(phone, incomingMsg); if (reply) response.message(reply); res.type("text/xml"); return res.send(response.toString()); }
  if (tuS.cellule) { const reply = await handleTuCellule(phone, incomingMsg); if (reply) response.message(reply); res.type("text/xml"); return res.send(response.toString()); }
  if (tuS.paiement) { const reply = await handleTuPaiement(phone, incomingMsg); if (reply) response.message(reply); res.type("text/xml"); return res.send(response.toString()); }

  // ── Greetings ────────────────────────────────────────────────────────────
  const greetings = ["bonjour","salam","hello","hi","salut","start","aide","help"];
  if (greetings.some(g => msgLower.startsWith(g)) && session.history.length === 0) {
    response.message(welcomeMessage(profileName));
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── Referral code ─────────────────────────────────────────────────────────
  if (msgLower.startsWith("tmv") && session.history.length === 0) {
    response.message(welcomeMessage(profileName));
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── CARTE ─────────────────────────────────────────────────────────────────
  if (msgLower === "carte" || msgLower === "card") {
    session.carte = { step: 1 };
    const niveauxText = NIVEAUX_CARTE.map((n,i) => (i+1) + ". " + n.name + " - " + n.price).join("\n");
    response.message("Carte de Soutien - Alhousseynou Ba Thies 2027\n\nChoisissez votre niveau :\n\n" + niveauxText + "\n\nTapez le numero (1-9)");
    res.type("text/xml"); return res.send(response.toString());
  }
  if (session.carte) {
    const s = session.carte;
    if (s.step === 1 && /^[1-9]$/.test(incomingMsg)) { s.niveau = NIVEAUX_CARTE[parseInt(incomingMsg)-1]; s.step = 2; response.message(s.niveau.name + " - " + s.niveau.price + "\n\nVotre prenom et nom ?"); res.type("text/xml"); return res.send(response.toString()); }
    if (s.step === 2) { const parts = incomingMsg.trim().split(" "); s.prenom = parts[0]||"Ami"; s.nom = parts.slice(1).join(" ")||""; s.step = 3; response.message("Votre quartier a Thies ?"); res.type("text/xml"); return res.send(response.toString()); }
    if (s.step === 3) {
      s.quartier = incomingMsg.trim();
      if (s.niveau.amount === 0) { s.step = 4; response.message("Generation de votre carte gratuite..."); res.type("text/xml"); res.send(response.toString()); await envoyerCarteWhatsApp(from, { prenom:s.prenom, nom:s.nom, quartier:s.quartier, phone, niveauId:s.niveau.id }); session.carte = null; return; }
      else { s.step = 4; response.message("Paiement " + s.niveau.name + " - " + s.niveau.price + "\n\nWave: +221 77 198 02 97\nOrange Money: 77 198 02 97\n\nTapez confirmer + code transaction"); res.type("text/xml"); return res.send(response.toString()); }
    }
    if (s.step === 4 && msgLower.startsWith("confirmer")) { s.transaction = incomingMsg.replace(/^confirmer\s*/i,"").trim(); response.message("Generation de votre carte..."); res.type("text/xml"); res.send(response.toString()); await envoyerCarteWhatsApp(from, { prenom:s.prenom, nom:s.nom, quartier:s.quartier, phone, niveauId:s.niveau.id, transaction:s.transaction }); session.carte = null; return; }
  }

  // ── audio-wolof ───────────────────────────────────────────────────────────
  if (msgLower.startsWith("audio-wolof ")) {
    const texte = incomingMsg.replace(/^audio-wolof /i,"").trim();
    try {
      const completion = await anthropic.messages.create({ model:"claude-sonnet-4-5", max_tokens:300, system:WOLOF_PROMPT, messages:[{ role:"user", content:texte }] });
      const wolofText = completion.content.map(b=>b.text||"").join("").trim();
      const { audioId } = await generateVoiceOgg(wolofText);
      await sendWhatsAppMedia(from, "Message Wolof: " + wolofText, BASE_URL + "/audio/" + audioId);
      response.message("Message vocal Wolof envoye !");
    } catch(e) { response.message("Erreur vocale."); }
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── audio ─────────────────────────────────────────────────────────────────
  if (msgLower.startsWith("audio ")) {
    const texte = incomingMsg.replace(/^audio /i,"").trim();
    try { const { audioId } = await generateVoiceOgg(texte); await sendWhatsAppMedia(from, "Message vocal - Alhousseynou Ba", BASE_URL + "/audio/" + audioId); response.message("Message vocal envoye !"); }
    catch(e) { response.message("Erreur vocale."); }
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── wolof ─────────────────────────────────────────────────────────────────
  if (msgLower.startsWith("wolof ")) {
    try {
      const completion = await anthropic.messages.create({ model:"claude-sonnet-4-5", max_tokens:400, system:WOLOF_PROMPT, messages:[{ role:"user", content:incomingMsg.replace(/^wolof /i,"") }] });
      response.message("En Wolof:\n\n" + completion.content.map(b=>b.text||"").join("").trim());
    } catch(e) { response.message("Erreur."); }
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── inviter ───────────────────────────────────────────────────────────────
  if (["inviter","invite","lien"].includes(msgLower)) {
    const code = generateCode(phone);
    const { data: refs } = await supabase.from("referrals").select("id").eq("referrer_phone", phone);
    response.message("Votre lien de recrutement :\n\nhttps://wa.me/" + WHATSAPP_NUMBER.replace("whatsapp:+","") + "?text=TMV" + code + "\n\nVous avez recrute " + (refs?.length||0) + " supporter(s).\n\nNdank ndank mooy japp golo ci naaye !");
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── dashboard ─────────────────────────────────────────────────────────────
  if (["dashboard","stats"].includes(msgLower)) {
    response.message("Dashboard Campagne\n\n" + DASHBOARD_URL + "\n\nThies 2027 !");
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── pdf (admin) ───────────────────────────────────────────────────────────
  if (msgLower === "pdf" && ADMIN_PHONES.includes("+" + phone)) { await sendWeeklyPDFRapport(); response.message("Rapport PDF genere !\n\n" + BASE_URL + "/rapport.pdf"); res.type("text/xml"); return res.send(response.toString()); }

  // ── sondage ───────────────────────────────────────────────────────────────
  if (msgLower === "sondage") {
    session.awaitingSondage = true;
    response.message("Sondage Thies 2027\n\nQuel est votre probleme principal ?\n\n1. Routes et pavage\n2. Eau et electricite\n3. Emploi et jeunesse\n4. Sante et hopital\n5. Education et ecoles");
    res.type("text/xml"); return res.send(response.toString());
  }
  if (session.awaitingSondage && ["1","2","3","4","5"].includes(incomingMsg)) {
    const reponses = {"1":"Routes et pavage","2":"Eau et electricite","3":"Emploi et jeunesse","4":"Sante et hopital","5":"Education et ecoles"};
    await supabase.from("votes").insert({ telegram_id:null, question:"Probleme principal", reponse:reponses[incomingMsg] });
    session.awaitingSondage = false;
    response.message("Jerejef ! Votre choix: " + reponses[incomingMsg] + "\n\nTapez inviter pour recruter !\nTapez carte pour votre carte de soutien !");
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── rejoindre ─────────────────────────────────────────────────────────────
  if (["rejoindre","benevole"].includes(msgLower)) {
    session.benevole = { step: 1 };
    response.message("Rejoindre l'equipe !\n\nJerejef !\n\nQuestion 1/2 - Votre quartier a Thies ?");
    res.type("text/xml"); return res.send(response.toString());
  }
  if (session.benevole) {
    if (session.benevole.step === 1) { session.benevole.quartier = incomingMsg; session.benevole.step = 2; response.message("Question 2/2 - Disponibilite ?\n\n1. Week-end\n2. Soirs\n3. Temps plein"); res.type("text/xml"); return res.send(response.toString()); }
    if (session.benevole.step === 2) {
      await supabase.from("benevoles").insert({ telegram_id:null, first_name:profileName||"WhatsApp User", last_name:null, quartier:session.benevole.quartier, disponibilite:incomingMsg, phone });
      session.benevole = null;
      response.message("Inscription confirmee !\n\nJerejef " + (profileName||"") + " ! Tu fais partie de l'equipe Thies 2027 !\n\nTapez inviter pour recruter\nTapez carte pour votre carte de soutien !\n\nNdank ndank mooy japp golo ci naaye !");
      res.type("text/xml"); return res.send(response.toString());
    }
  }

  // ── broadcast (admin) ─────────────────────────────────────────────────────
  if (msgLower.startsWith("broadcast ") && ADMIN_PHONES.includes("+" + phone)) {
    const msg = incomingMsg.replace(/^broadcast /i,"");
    const { data: users } = await supabase.from("users").select("phone").not("phone","is",null);
    let envoye = 0;
    for (const user of users||[]) { try { await sendWhatsAppMessage("whatsapp:+" + user.phone, "Message de campagne\n\n" + msg + "\n\nAlhousseynou Ba - Thies 2027"); envoye++; await new Promise(r=>setTimeout(r,100)); } catch(e) {} }
    response.message("Message envoye a " + envoye + " supporters !");
    res.type("text/xml"); return res.send(response.toString());
  }

  // ── reset ─────────────────────────────────────────────────────────────────
  if (msgLower === "reset") { sessions.delete(from); tuSessions.delete(phone); response.message("Reinitialise. Jerejef !"); res.type("text/xml"); return res.send(response.toString()); }

  // ── Claude AI ─────────────────────────────────────────────────────────────
  session.history.push({ role:"user", content:incomingMsg });
  if (session.history.length > 20) session.history = session.history.slice(-20);
  try {
    const completion = await anthropic.messages.create({ model:"claude-sonnet-4-5", max_tokens:800, system:SYSTEM_PROMPT, messages:session.history });
    const reply = completion.content.map(b=>b.text||"").join("").trim();
    session.history.push({ role:"assistant", content:reply });
    if (reply.length > 1580) { const chunks = reply.match(/.{1,1580}(\s|$)/gs)||[reply]; chunks.forEach(chunk => response.message(chunk.trim())); }
    else { response.message(reply); }
  } catch(err) { response.message("Une erreur est survenue. Reessayez."); }

  res.type("text/xml");
  res.send(response.toString());
});

app.post("/reset/:phone", (req, res) => { sessions.delete("whatsapp:+" + req.params.phone); tuSessions.delete(req.params.phone); res.json({ reset:true }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Thies Ma Ville WhatsApp Bot v9 - Port " + PORT);
  cleanOldFiles();
  scheduleWeeklySondage();
  console.log("Schedulers started!");
});
