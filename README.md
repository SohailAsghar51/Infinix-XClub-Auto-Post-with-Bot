# 🤖 Infinix XClub Auto Post & View Bot

An AI-powered automation tool for [Infinix XClub](https://www.infinix.club) — automatically generates and posts discussions using AI, and boosts post views using proxy rotation.

---

## ✨ Features

- 🧠 **AI Post Generator** — Uses Groq (free) to generate human-like forum posts
- 📝 **Auto Poster** — Automatically submits posts to Infinix Club forum

---

## 📁 Project Structure

```
infinix-club-bot/
├── infinix_auto_poster.js   # AI post generator + auto poster
├── infinix_view_bot.js      # View booster with proxy rotation
├── README.md                # This file
└── package.json             # Dependencies
```

---

## ⚙️ Requirements

- [Node.js](https://nodejs.org) v16 or higher
- Free [Groq API Key](https://console.groq.com) — for AI post generation

---

## 🚀 Setup

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/infinix-club-bot.git
cd infinix-club-bot
```

### 2. Install dependencies

```bash
npm install node-fetch@2 https-proxy-agent@7
```

### 3. Configure `infinix_auto_poster.js`

Open the file and fill in:

```js
const GROQ_KEY    = "your_groq_api_key";     // groq.com
const AUTH_TOKEN  = "your_jwt_token";         // from browser DevTools
const COOKIE      = "your_session_cookie";    // from browser DevTools
const TOPIC       = "Your post topic here";   // what to post about
const LANGUAGE    = "English";                // or Urdu, Hindi, Arabic
```

## 🍪 How to Get Your Cookie & Token

1. Open [infinix.club](https://www.infinix.club) and **log in**
2. Press `F12` → **Network tab** → Filter by **Fetch/XHR**
3. Click any request → **Headers tab** → **Request Headers**
4. Copy the `cookie` value → paste into `COOKIE`
5. Copy the `xclub-authorization` value → paste into `AUTH_TOKEN`

> ⚠️ Cookies expire after some time — refresh them from DevTools when needed.

---

## 🔑 How to Get Groq API Key (Free)

1. Go to [console.groq.com](https://console.groq.com)
2. Sign up with Google
3. Go to **API Keys** → **Create API Key**
4. Copy and paste into `GROQ_KEY`

---

## 📦 Dependencies

| Package | Version | Purpose |
|---|---|---|
| node-fetch | ^2.0.0 | HTTP requests |
| https-proxy-agent | ^7.0.0 | Proxy support |

---

## ⚠️ Disclaimer

This tool is for **educational purposes only**. Use responsibly and in accordance with Infinix Club's terms of service. The author is not responsible for any account bans or violations.

---

## 👤 Author

**Sohail6651**  
Infinix XClub — Super CP Member 🏆

---

## ⭐ Star this repo if it helped you!
