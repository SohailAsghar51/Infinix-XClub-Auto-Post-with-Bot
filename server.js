/**
 * Infinix Club Dashboard — Proxy Server
 * Handles CORS + forwards requests to Anthropic & Infinix Club API
 * 
 * Setup:
 *   npm install express cors node-fetch@2
 *   node server.js
 */

const express = require("express");
const cors    = require("cors");
const fetch   = require("node-fetch");
const path    = require("path");

const app  = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// ── Serve frontend ───────────────────────
app.use(express.static(path.join(__dirname)));

// ── 1. AI Generate Route ─────────────────
// Frontend calls: POST /api/generate
app.post("/api/generate", async (req, res) => {
  const { topic, tone, language, groqKey } = req.body;

  if (!topic) return res.status(400).json({ error: "Topic required" });

  const prompt = `You are writing a discussion post for Infinix Club (infinix.club) — a fan community for Infinix smartphone users.

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
    // Try Anthropic first (no key needed from frontend)
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (anthropicRes.ok) {
      const data = await anthropicRes.json();
      const raw  = data.content?.map(c => c.text || "").join("") || "";
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

    const raw2   = groqData.choices?.[0]?.message?.content || "";
    const clean2 = raw2.replace(/```json|```/g, "").trim();
    const parsed2 = JSON.parse(clean2);
    return res.json({ success: true, ...parsed2 });

  } catch (err) {
    console.error("Generate error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 2. Publish to Infinix Club ────────────
// Frontend calls: POST /api/publish
app.post("/api/publish", async (req, res) => {
  const { title, content, fid, authToken, cookie, imageUrl, topid } = req.body;

  if (!title || !content) return res.status(400).json({ error: "Title and content required" });
  if (!authToken)          return res.status(400).json({ error: "Auth token required" });

  // Convert to BBCode
  // If image URL provided, prepend it as BBCode img tag
  let bbContent = content
    .split("\n")
    .filter(l => l.trim())
    .map(l => `[p]${l.trim()}[/p]`)
    .join("\n");

  if (imageUrl && imageUrl.trim()) {
    bbContent = `[img]${imageUrl.trim()}[/img]\n` + bbContent;
  }

  // covers array — Infinix Club uses this for cover image
  const covers = (imageUrl && imageUrl.trim())
    ? [{ url: imageUrl.trim(), width: 0, height: 0 }]
    : [];

  const payload = {
    subject:          title,
    message:          bbContent,
    country_fid:      parseInt(fid) || 293,
    fid:              parseInt(fid) || 293,
    typeid:           0,
    topid:            topid ? parseInt(topid) : "",
    thread_tag:       1,
    phonetype:        "infinix HOT 10",
    covers,
    aids:             "",
    spu_id:           "",
    activity:         0,
    is_author_only:   0,
    at_list_current:  "",
    push_time:        Math.floor(Date.now() / 1000)
  };

  // ── Debug: log exactly what we're sending ──
  console.log("\n━━━ PUBLISH REQUEST ━━━");
  console.log("Payload:", JSON.stringify(payload, null, 2));
  console.log("Token (first 30):", authToken.substring(0, 30) + "...");
  console.log("Cookie present:", !!cookie);

  try {
    const response = await fetch("https://www.infinix.club/v5/content/thread", {
      method: "POST",
      headers: {
        "Content-Type":        "application/json",
        "Xclub-Authorization": authToken,
        "Authorization":       `Bearer ${authToken}`,
        "Cookie":              cookie || "",
        "User-Agent":          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        "Referer":             "https://www.infinix.club/note/thread",
        "Origin":              "https://www.infinix.club",
        "Accept":              "application/json, text/plain, */*",
        "Accept-Language":     "en-US,en;q=0.9",
      },
      body: JSON.stringify(payload)
    });

    // Read raw text first so we never crash on non-JSON
    const rawText = await response.text();
    console.log("━━━ INFINIX RESPONSE ━━━");
    console.log("HTTP Status:", response.status);
    console.log("Body:", rawText);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━\n");

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
      // Return full Infinix error to frontend so user can see it
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

// ── 3. Fetch topics for fid ───────────────
// Calls /v5/content/category?fid=X to get topic list
// Each topic has topid (e.g. 6675163 = Daily Thread)
app.get("/api/categories", async (req, res) => {
  const { fid = 293, authToken, cookie } = req.query;

  const HEADERS = {
    "Xclub-Authorization": authToken || "",
    "Authorization":       `Bearer ${authToken || ""}`,
    "Cookie":              cookie || "",
    "User-Agent":          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    "Accept":              "application/json, text/plain, */*",
    "Accept-Language":     "en-US,en;q=0.9",
    "Referer":             `https://www.infinix.club/note/thread`,
  };

  try {
    // Primary: category list
    const r1   = await fetch(`https://www.infinix.club/v5/content/category?fid=${fid}`, { headers: HEADERS });
    const txt1 = await r1.text();
    console.log("Category raw:", txt1.slice(0, 500));
    const d1   = JSON.parse(txt1);

    // API returns data.list array with {topid, topic_name, icon, ...}
    const rawList = d1?.data?.list || d1?.data?.lists || d1?.data || [];

    if (Array.isArray(rawList) && rawList.length > 0) {
      const topics = rawList.map(t => ({
        topid: t.topid || t.id,
        name:  t.topic_name || t.name || t.title,
        icon:  t.icon || t.img || "",
        desc:  t.description || ""
      }));
      return res.json({ success: true, topics });
    }

    // Fallback: known Pakistan topics hardcoded from network analysis
    console.log("Category list empty — using known Pakistan topics");
    return res.json({
      success: true,
      topics: [
        { topid: 6675164, name: "PlayStation Universe",   icon: "", desc: "Sony's PlayStation (PS) revolutionized 3D gaming in 1994." },
        { topid: 6675163, name: "Daily Thread",   icon: "", desc: "Rozana ki baat cheet" },
        { topid: 6674907, name: "V4 GAMES",   icon: "", desc: "V4 Games main gaming fans gameplay videos dekhain" },
        { topid: 0,       name: "No Topic",        icon: "", desc: "Koi tag nahi" },
      ],
      fallback: true
    });

  } catch(e) {
    console.error("Categories error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 4. Debug: test credentials ────────────
app.post("/api/debug", async (req, res) => {
  const { authToken, cookie } = req.body;
  try {
    const r = await fetch("https://www.infinix.club/v5/user/info", {
      headers: {
        "Xclub-Authorization": authToken || "",
        "Authorization":       `Bearer ${authToken || ""}`,
        "Cookie":              cookie || "",
        "User-Agent":          "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept":              "application/json",
      }
    });
    const text = await r.text();
    console.log("Debug user info:", text);
    res.json({ httpStatus: r.status, body: text.slice(0, 500) });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Start ─────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✓ Infinix Club Proxy Server running`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Dashboard: http://localhost:${PORT}/infinix_dashboard.html\n`);
});
