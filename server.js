/**
 * Infinix Club Dashboard — Proxy Server
 * Handles CORS + forwards requests to Anthropic & Infinix Club API
 *
 * Setup:
 *   npm install express cors node-fetch@2 form-data
 *   node server.js
 */

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const FormData = require("form-data");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: "20mb" }));

// ── Serve frontend ───────────────────────
app.use(express.static(path.join(__dirname)));

// ── 1. AI Generate Route ─────────────────
app.post("/api/generate", async (req, res) => {
  const { topic, tone, language, groqKey } = req.body;
  if (!topic) return res.status(400).json({ error: "Topic required" });

  // Ai prompt generator
  const prompt = `
                  Act as a professional gaming content creator.

Create a viral social media post about "[GAME NAME]".

Requirements:
- Start with a powerful catchy title (1 line)
- Write 2/3 short engaging lines about the game
- Highlight gameplay, story, and graphics
- Add why gamers love this game
- Use emojis (🎮🔥⚔️🌍)
- Keep it short, stylish, and attractive
- Add 5 trending gaming hashtags
- Add a call-to-action (Play now / Try it today)

Style:
- Viral, modern, eye-catching



Topic: "${topic}"

Tone: ${tone || "casual and friendly"}
Language: ${language || "Urdu"}

Guidelines:
- Sound like a real community member, not a marketer
- Include a question or call-to-action at the end to spark replies
- Length: 150-300 words
- No hashtags

Return ONLY raw JSON (no markdown, no backticks):
{"title": "Engaging post title here", "content": "Full post content here"}`;

  try {
    // Try Anthropic first
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }]
      })
    });
// mention this id "@Ayat..........".

    if (anthropicRes.ok) {
      const data = await anthropicRes.json();
      const raw = data.content?.map(c => c.text || "").join("") || "";
      const clean = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      return res.json({ success: true, ...parsed });
    }

    // Fallback: Groq
    if (!groqKey) return res.status(400).json({ error: "Groq API key required" });

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${groqKey}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.8,
        max_tokens: 1000
      })
    });

    const groqData = await groqRes.json();
    if (!groqRes.ok) throw new Error(groqData.error?.message || "Groq error");

    const raw2 = groqData.choices?.[0]?.message?.content || "";
    const clean2 = raw2.replace(/```json|```/g, "").trim();
    const parsed2 = JSON.parse(clean2);
    return res.json({ success: true, ...parsed2 });

  } catch (err) {
    console.error("Generate error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 2. Image Upload → Infinix CDN ────────
// Frontend sends base64 → server converts to multipart/form-data
// → POST https://infinix.club/v5/content/imageUpload
// → Returns { aid, url } where aid is used in covers[] array
app.post("/api/upload-image", async (req, res) => {
  const { base64, fileName, authToken, cookie } = req.body;

  if (!base64) return res.status(400).json({ error: "No image data" });
  if (!authToken) return res.status(400).json({ error: "Auth token required" });

  // Strip "data:image/jpeg;base64," prefix
  const matches = base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches) return res.status(400).json({ error: "Invalid base64 format" });

  const mimeType = matches[1];
  const buffer = Buffer.from(matches[2], "base64");
  const safeName = fileName || "cover.jpg";

  console.log(`\n━━━ IMAGE UPLOAD ━━━`);
  console.log(`File: ${safeName} | MIME: ${mimeType} | Size: ${Math.round(buffer.length / 1024)}KB`);

  try {
    const form = new FormData();
    form.append("file", buffer, {
      filename: safeName,
      contentType: mimeType
    });

    const uploadRes = await fetch("https://infinix.club/v5/content/imageUpload", {
      method: "POST",
      headers: {
        ...form.getHeaders(),
        "xclub-authorization": authToken,
        "cookie": cookie || "",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        "referer": "https://infinix.club/note/thread",
        "origin": "https://infinix.club",
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        "accept-language-api": "en",
        "sec-ch-ua-platform": '"Windows"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua": '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin"
      },
      body: form
    });

    const rawText = await uploadRes.text();
    console.log("Infinix imageUpload HTTP:", uploadRes.status);
    console.log("Infinix imageUpload response:", rawText.slice(0, 400));

    let data;
    try { data = JSON.parse(rawText); }
    catch { throw new Error("Non-JSON from Infinix: " + rawText.slice(0, 200)); }

    // Success: { status: 1, data: { aid: "12808379", fileUrl: "https://..." } }
    if (data.status === 1 && data.data?.aid) {
      console.log(`✓ Upload OK — aid: ${data.data.aid} | url: ${data.data.fileUrl}`);
      return res.json({
        success: true,
        aid: String(data.data.aid),   // covers array uses string aid
        url: data.data.fileUrl         // CDN URL for preview
      });
    }

    throw new Error(data.msg || data.message || "Infinix image upload failed");

  } catch (err) {
    console.error("Image upload error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 3. Publish to Infinix Club ────────────
app.post("/api/publish", async (req, res) => {
  const { title, content, fid, authToken, cookie, imageAid, topid } = req.body;

  if (!title || !content) return res.status(400).json({ error: "Title and content required" });
  if (!authToken) return res.status(400).json({ error: "Auth token required" });

  // Build BBCode body — exactly like working curl: [div][p]...[/p][/div]
  const bbContent = content
    .split("\n")
    .filter(l => l.trim())
    .map(l => `[p]${l.trim()}[/p]`)
    .join("");

  // covers: array of aid strings — exactly as Infinix web app sends
  const covers = imageAid ? [String(imageAid)] : [];

  // Payload exactly matching working curl:
  // {"at_list_current":"","push_time":...,"message":"[div][p]...[/p][/div]",
  //  "aids":"","subject":"...","typeid":0,"thread_tag":0,"activity":0,
  //  "spu_id":"","phonetype":"pc","covers":[...],"country_fid":293,
  //  "is_author_only":0,"topid":6675163}
  const payload = {
    at_list_current: "",
    push_time: Math.floor(Date.now() / 1000),
    message: `[div]${bbContent}[/div]`,
    aids: "",
    subject: title,
    typeid: 0,
    thread_tag: 0,
    activity: 0,
    spu_id: "",
    phonetype: "pc",
    covers,
    country_fid: parseInt(fid) || 293,
    is_author_only: 0,
    topid: topid ? parseInt(topid) : 6675163
  };

  console.log("\n━━━ PUBLISH REQUEST ━━━");
  console.log("Payload:", JSON.stringify(payload));
  console.log("Token (first 40):", authToken.substring(0, 40) + "...");
  console.log("Cookie (first 40):", (cookie || "").substring(0, 40) + "...");

  try {
    const response = await fetch("https://infinix.club/v5/content/thread", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9,ur;q=0.8",
        "accept-language-api": "en",
        "xclub-authorization": authToken,
        "cookie": cookie || "",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        "referer": "https://infinix.club/note/thread",
        "origin": "https://infinix.club",
        "sec-ch-ua": '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "priority": "u=1, i"
      },
      body: JSON.stringify(payload)
    });

    const rawText = await response.text();
    console.log("━━━ INFINIX RESPONSE ━━━");
    console.log("HTTP Status:", response.status);
    console.log("Body:", rawText);

    let data;
    try { data = JSON.parse(rawText); }
    catch { return res.status(502).json({ error: "Infinix returned non-JSON: " + rawText.slice(0, 200) }); }

    if (data.status === 1) {
      res.json({
        success: true,
        tid: data?.data?.tid,
        pid: data?.data?.pid,
        url: `https://www.infinix.club/t/${data?.data?.tid}`
      });
    } else {
      res.status(400).json({
        error: data.msg || data.message || "Infinix Club ne reject kar diya",
        infinix_status: data.status,
        infinix_code: data.code,
        raw: data
      });
    }

  } catch (err) {
    console.error("Publish error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 4. Fetch topics ───────────────────────
app.get("/api/categories", async (req, res) => {
  const { fid = 293, authToken, cookie } = req.query;

  const HEADERS = {
    "Xclub-Authorization": authToken || "",
    "Authorization": `Bearer ${authToken || ""}`,
    "Cookie": cookie || "",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.infinix.club/note/thread",
  };

  try {
    const r1 = await fetch(`https://www.infinix.club/v5/content/category?fid=${fid}`, { headers: HEADERS });
    const txt1 = await r1.text();
    console.log("Category raw:", txt1.slice(0, 500));
    const d1 = JSON.parse(txt1);

    const rawList = d1?.data?.list || d1?.data?.lists || d1?.data || [];

    if (Array.isArray(rawList) && rawList.length > 0) {
      const topics = rawList.map(t => ({
        topid: t.topid || t.id,
        name: t.topic_name || t.name || t.title,
        icon: t.icon || t.img || "",
        desc: t.description || ""
      }));
      return res.json({ success: true, topics });
    }

    return res.json({
      success: true,
      fallback: true,
      topics: [
        { topid: 6675164, name: "PlayStation Universe", icon: "", desc: "Sony's PlayStation revolutionized 3D gaming in 1994." },
        { topid: 6675163, name: "Daily Thread", icon: "", desc: "Rozana ki baat cheet" },
        { topid: 6674907, name: "V4 GAMES", icon: "", desc: "V4 Games gaming fans ke liye" },
        { topid: 0, name: "No Topic", icon: "", desc: "Koi tag nahi" },
      ]
    });

  } catch (e) {
    console.error("Categories error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 5. Debug credentials ──────────────────
app.post("/api/debug", async (req, res) => {
  const { authToken, cookie } = req.body;
  try {
    const r = await fetch("https://infinix.club/v5/user/auth?scene=default", {
      headers: {
        "xclub-authorization": authToken || "",
        "Cookie": cookie || "",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9,ur;q=0.8",
        "accept-language-api": "en",
        "Referer": "https://infinix.club/foryou",
        "sec-ch-ua": '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
      }
    });
    const text = await r.text();
    console.log("Debug auth response:", text.slice(0, 300));
    res.json({ httpStatus: r.status, body: text.slice(0, 800) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Start ─────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✓ Infinix Club Proxy Server running`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Dashboard: http://localhost:${PORT}/infinix_dashboard.html\n`);
});
