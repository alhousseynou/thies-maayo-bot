# 🗳️ Thies Maayo Agent — WhatsApp Bot
## Deployment Guide

---

## What This Bot Does

Anyone who messages your WhatsApp campaign number gets an AI agent that:
- Handles **voter complaints** (water, roads, trash) with policy responses + Wolof voice note scripts
- **Translates policies** into formal French, Wolof, and WhatsApp voice note scripts
- **Rebuts opponent attacks** with factual, damaging 3-sentence responses
- **Optimizes campaign schedules** neighborhood by neighborhood
- Serves **campaign staff**, **voters**, **journalists**, and the **general public** differently

---

## Step 1 — Set Up Twilio WhatsApp

1. Go to [twilio.com](https://twilio.com) → create a free account
2. In the Twilio Console → **Messaging** → **Try it out** → **Send a WhatsApp message**
3. For production: request a **WhatsApp Business number** (takes 1–3 days approval)
4. For testing immediately: use Twilio's **WhatsApp Sandbox** number `+1 415 523 8886`
   - Your testers must send `join <your-sandbox-word>` to that number first

---

## Step 2 — Deploy the Server

### Option A: Railway (Recommended — free tier available)
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```
Railway gives you a public URL like `https://thies-maayo.up.railway.app`

### Option B: Render (also free)
1. Push code to GitHub
2. Go to [render.com](https://render.com) → New Web Service
3. Connect your GitHub repo
4. Set environment variables (see Step 3)
5. Deploy — Render gives you `https://thies-maayo.onrender.com`

### Option C: Local + ngrok (for testing only)
```bash
npm install
cp .env.example .env
# Edit .env with your keys
npm start

# In another terminal:
npx ngrok http 3000
# Copy the https URL ngrok gives you
```

---

## Step 3 — Set Environment Variables

Copy `.env.example` to `.env` and fill in:

```env
ANTHROPIC_API_KEY=sk-ant-...        # from console.anthropic.com
CANDIDATE_NAME=Your Name
MOVEMENT_NAME=Your Movement
OPPONENTS=Opponent 1, Opponent 2
TOP_ISSUE=water, roads, unemployment
PORT=3000
```

On Railway/Render, add these in the **Environment Variables** dashboard — never commit `.env` to git.

---

## Step 4 — Connect Twilio to Your Server

1. In Twilio Console → **Messaging** → **Settings** → **WhatsApp Sandbox Settings**
2. Set **"When a message comes in"** webhook to:
   ```
   https://YOUR-DEPLOYED-URL.com/webhook
   ```
   Method: **HTTP POST**
3. Save

---

## Step 5 — Test It

Send these messages to your WhatsApp number:

| Message | Expected response |
|---|---|
| `Bonjour` | Welcome menu with 5 options |
| `Il n'y a pas d'eau sur la Rue 12` | Policy fix + CFA budget + Wolof script + rebuttal |
| `Traduire cette politique: construction de 10 forages` | 3-format translation |
| `Répondre à: le candidat n'a aucune expérience` | 3-sentence rebuttal |
| `Programme-moi 4 heures` | Hour-by-hour Thiès route |
| `je suis journaliste` | Switches to formal French only mode |

---

## Architecture

```
WhatsApp User
     │
     ▼
Twilio (receives message)
     │  HTTP POST to /webhook
     ▼
Your Server (Express.js)
     │  Sends to Claude API
     ▼
Anthropic claude-opus-4-5
     │  Returns response
     ▼
Twilio (sends reply back)
     │
     ▼
WhatsApp User ✓
```

Sessions are stored in memory per phone number (last 10 exchanges kept). For production with high volume, replace with Redis.

---

## Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/` | GET | Health check — confirms bot is online |
| `/webhook` | POST | Twilio sends all incoming WhatsApp messages here |
| `/reset/:phone` | POST | Clears a user's session (e.g. `/reset/221771234567`) |

---

## Scaling for High Volume

If thousands of voters message during a rally:
1. Replace in-memory sessions with **Redis** (add `ioredis` package)
2. Deploy on **Railway Pro** or **Render Starter** for always-on uptime
3. Add **rate limiting** per phone number (5 messages/minute) to control API costs

---

## Estimated Costs

| Service | Cost |
|---|---|
| Twilio WhatsApp (sandbox) | Free for testing |
| Twilio WhatsApp (production) | ~$0.005/message |
| Anthropic API (claude-opus-4-5) | ~$0.015–$0.075 per conversation |
| Railway/Render hosting | Free tier available |

For 500 voters/day: approximately **$5–15 USD/day** in API costs.

---

## Support

Bot built with: Node.js · Express · Twilio · Anthropic Claude
Campaign: Thiès Mayoral Election
