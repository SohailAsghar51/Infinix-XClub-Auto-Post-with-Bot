/**
 * Infinix Club Dashboard — Proxy Server
 * Handles CORS + forwards requests to Anthropic & Infinix Club API
 *
 * Setup:
 *   npm install express cors node-fetch@2 form-data
 *   node server.js
 */

const express  = require("express");
const cors     = require("cors");
const fetch    = require("node-fetch");
const FormData = require("form-data");
const path     = require("path");

const app  = express();
const PORT = 3000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning']
}));
app.use(express.json({ limit: "20mb" }));

// ── Skip ngrok browser warning ────────────
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

// ── Serve frontend ───────────────────────
app.use(express.static(path.join(__dirname)));

// ── Root → Login page ────────────────────
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

// ── Users storage (JSON file) ─────────────
const fs          = require("fs");
const USERS_FILE  = path.join(__dirname, "users.json");

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch(e) {}
  // Default admin
  return { sohailasghar: { password: "Sohail@6651", role: "admin", name: "SohailAsghar", createdAt: Date.now() } };
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ── GET all users ─────────────────────────
app.get("/api/users", (req, res) => {
  const users = loadUsers();
  // Don't send passwords
  const safe = Object.entries(users).map(([username, u]) => ({
    username, role: u.role, name: u.name, createdAt: u.createdAt
  }));
  res.json({ success: true, users: safe });
});

// ── ADD user ──────────────────────────────
app.post("/api/users/add", (req, res) => {
  const { username, password, role, name } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });

  const users = loadUsers();
  if (users[username.toLowerCase()]) return res.status(400).json({ error: "Username already exists" });

  users[username.toLowerCase()] = {
    password,
    role:      role || "user",
    name:      name || username,
    createdAt: Date.now()
  };
  saveUsers(users);
  res.json({ success: true, message: `User ${username} added` });
});

// ── DELETE user ───────────────────────────
app.post("/api/users/delete", (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: "Username required" });
  if (username.toLowerCase() === "sohailasghar") return res.status(400).json({ error: "Cannot delete admin" });

  const users = loadUsers();
  if (!users[username.toLowerCase()]) return res.status(404).json({ error: "User not found" });

  delete users[username.toLowerCase()];
  saveUsers(users);
  res.json({ success: true, message: `User ${username} deleted` });
});

// ── CHANGE password ───────────────────────
app.post("/api/users/password", (req, res) => {
  const { username, newPassword } = req.body;
  if (!username || !newPassword) return res.status(400).json({ error: "Username and new password required" });

  const users = loadUsers();
  if (!users[username.toLowerCase()]) return res.status(404).json({ error: "User not found" });

  users[username.toLowerCase()].password = newPassword;
  saveUsers(users);
  res.json({ success: true, message: "Password updated" });
});

// ── VERIFY login ──────────────────────────
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const users = loadUsers();
  const user  = users[username?.toLowerCase()];

  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  res.json({ success: true, role: user.role, name: user.name, username: username.toLowerCase() });
});

// ── 1. AI Generate Route ─────────────────
app.post("/api/generate", async (req, res) => {
  const { topic, tone, language, groqKey, customPrompt } = req.body;
  if (!topic) return res.status(400).json({ error: "Topic required" });

  // Use custom prompt if provided, else use default
  const prompt = customPrompt || `You are a real Pakistani gamer writing casually on a forum. Write like a real person — not a marketer or AI.

Topic: "${topic}"
Language: ${language || "English"}
Tone: ${tone || "casual and friendly"}

Rules:
- Write like you personally played/experienced this
- Use "I", "me", "my experience" naturally
- Add personal opinion — something you liked OR didn't like
- Include ONE specific detail (a character name, a level, a feature, a date)
- Use 2-3 emojis max — don't overdo it
- Structure with 3 short sections using [b]heading[/b] BBCode
- Section 1: Your personal experience with it
- Section 2: What makes it special (be specific)
- Section 3: Ask a question to spark replies
- Length: 120-200 words total
- NO generic marketing phrases like "stunning graphics", "immersive experience", "take it to the next level"
- Sound genuinely excited but real

Return ONLY raw JSON (no markdown, no backticks):
{"title": "Short casual title here", "content": "Post content with [b]headings[/b]"}`;

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

    if (anthropicRes.ok) {
      const data   = await anthropicRes.json();
      const raw    = data.content?.map(c => c.text || "").join("") || "";
      const clean  = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      return res.json({ success: true, ...parsed });
    }

    // Fallback: Groq
    if (!groqKey) return res.status(400).json({ error: "Groq API key required" });

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${groqKey}`
      },
      body: JSON.stringify({
        model:       "llama-3.3-70b-versatile",
        messages:    [{ role: "user", content: prompt }],
        temperature: 0.8,
        max_tokens:  1000
      })
    });

    const groqData = await groqRes.json();
    if (!groqRes.ok) throw new Error(groqData.error?.message || "Groq error");

    const raw2    = groqData.choices?.[0]?.message?.content || "";
    const clean2  = raw2.replace(/```json|```/g, "").trim();
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

  if (!base64)    return res.status(400).json({ error: "No image data" });
  if (!authToken) return res.status(400).json({ error: "Auth token required" });

  // Strip "data:image/jpeg;base64," prefix
  const matches = base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches)  return res.status(400).json({ error: "Invalid base64 format" });

  const mimeType  = matches[1];
  const buffer    = Buffer.from(matches[2], "base64");
  const safeName  = fileName || "cover.jpg";

  console.log(`\n━━━ IMAGE UPLOAD ━━━`);
  console.log(`File: ${safeName} | MIME: ${mimeType} | Size: ${Math.round(buffer.length / 1024)}KB`);

  try {
    const form = new FormData();
    form.append("file", buffer, {
      filename:    safeName,
      contentType: mimeType
    });

    const uploadRes = await fetch("https://infinix.club/v5/content/imageUpload", {
      method:  "POST",
      headers: {
        ...form.getHeaders(),
        "xclub-authorization": authToken,
        "cookie":              cookie || "",
        "user-agent":          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        "referer":             "https://infinix.club/note/thread",
        "origin":              "https://infinix.club",
        "accept":              "application/json, text/plain, */*",
        "accept-language":     "en-US,en;q=0.9",
        "accept-language-api": "en",
        "sec-ch-ua-platform":  '"Windows"',
        "sec-ch-ua-mobile":    "?0",
        "sec-ch-ua":           '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
        "sec-fetch-dest":      "empty",
        "sec-fetch-mode":      "cors",
        "sec-fetch-site":      "same-origin"
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
        aid:     String(data.data.aid),   // covers array uses string aid
        url:     data.data.fileUrl         // CDN URL for preview
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
  if (!authToken)          return res.status(400).json({ error: "Auth token required" });

  // Build BBCode — image first as [attach], then text
  // Split content by [b] headings and format each section properly
  const lines = content.split(/(\[b\].*?\[\/b\])/g).filter(l => l.trim());

  let bbParts = [];
  if (imageAid) bbParts.push(`[p][attach]${imageAid}[/attach][/p]`);

  lines.forEach(line => {
    line = line.trim();
    if (!line) return;
    if (line.startsWith('[b]') && line.endsWith('[/b]')) {
      // Heading — add blank line before, then heading on its own line
      bbParts.push(`[p][br][/p]`);
      bbParts.push(`[p]${line}[/p]`);
    } else {
      // Regular text — split by sentences/newlines
      line.split('\n').filter(l => l.trim()).forEach(l => {
        bbParts.push(`[p]${l.trim()}[/p]`);
      });
    }
  });

  const fullMessage = `[div]${bbParts.join('')}[/div]`;

  // aids = "12848129," (aid + comma), covers = [] when image in body
  const aids   = imageAid ? `${imageAid},` : "";
  const covers = [];

  const payload = {
    at_list_current: "",
    push_time:       Math.floor(Date.now() / 1000),
    message:         fullMessage,
    aids,
    subject:         title,
    typeid:          0,
    thread_tag:      1,
    activity:        0,
    spu_id:          "",
    phonetype:       "pc",
    covers,
    country_fid:     parseInt(fid) || 293,
    is_author_only:  0,
    topid:           topid ? parseInt(topid) : 6675163
  };

  console.log("\n━━━ PUBLISH REQUEST ━━━");
  console.log("Payload:", JSON.stringify(payload));
  console.log("Token (first 40):", authToken.substring(0, 40) + "...");
  console.log("Cookie (first 40):", (cookie||"").substring(0, 40) + "...");

  try {
    const response = await fetch("https://infinix.club/v5/content/thread", {
      method: "POST",
      headers: {
        "content-type":        "application/json",
        "accept":              "application/json, text/plain, */*",
        "accept-language":     "en-US,en;q=0.9,ur;q=0.8",
        "accept-language-api": "en",
        "xclub-authorization": authToken,
        "cookie":              cookie || "",
        "user-agent":          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        "referer":             "https://infinix.club/note/thread",
        "origin":              "https://infinix.club",
        "sec-ch-ua":           '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
        "sec-ch-ua-mobile":    "?0",
        "sec-ch-ua-platform":  '"Windows"',
        "sec-fetch-dest":      "empty",
        "sec-fetch-mode":      "cors",
        "sec-fetch-site":      "same-origin",
        "priority":            "u=1, i"
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
        tid:     data?.data?.tid,
        pid:     data?.data?.pid,
        url:     `https://www.infinix.club/t/${data?.data?.tid}`
      });
    } else {
      res.status(400).json({
        error:          data.msg || data.message || "Infinix Club ne reject kar diya",
        infinix_status: data.status,
        infinix_code:   data.code,
        raw:            data
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
    "Authorization":       `Bearer ${authToken || ""}`,
    "Cookie":              cookie || "",
    "User-Agent":          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    "Accept":              "application/json, text/plain, */*",
    "Accept-Language":     "en-US,en;q=0.9",
    "Referer":             "https://www.infinix.club/note/thread",
  };

  try {
    const r1   = await fetch(`https://www.infinix.club/v5/content/category?fid=${fid}`, { headers: HEADERS });
    const txt1 = await r1.text();
    console.log("Category raw:", txt1.slice(0, 500));
    const d1   = JSON.parse(txt1);

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

    return res.json({
      success:  true,
      fallback: true,
      topics: [
        { topid: 6675164, name: "PlayStation Universe", icon: "", desc: "Sony's PlayStation revolutionized 3D gaming in 1994." },
        { topid: 6675163, name: "Daily Thread",         icon: "", desc: "Rozana ki baat cheet" },
        { topid: 6674907, name: "V4 GAMES",             icon: "", desc: "V4 Games gaming fans ke liye" },
        { topid: 0,       name: "No Topic",             icon: "", desc: "Koi tag nahi" },
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
        "Cookie":              cookie || "",
        "User-Agent":          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        "Accept":              "application/json, text/plain, */*",
        "accept-language":     "en-US,en;q=0.9,ur;q=0.8",
        "accept-language-api": "en",
        "Referer":             "https://infinix.club/foryou",
        "sec-ch-ua":           '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
        "sec-ch-ua-mobile":    "?0",
        "sec-ch-ua-platform":  '"Windows"',
        "sec-fetch-dest":      "empty",
        "sec-fetch-mode":      "cors",
        "sec-fetch-site":      "same-origin",
      }
    });
    const text = await r.text();
    console.log("Debug auth response:", text.slice(0, 300));
    res.json({ httpStatus: r.status, body: text.slice(0, 800) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 6. Add post to For You / Recommend ───
app.post("/api/recommend", async (req, res) => {
  const { authToken, cookie, fid, tid } = req.body;

  if (!authToken) return res.status(400).json({ error: "Auth token required" });

  const payload = { fid: parseInt(fid) || 293 };
  if (tid) payload.tid = parseInt(tid);

  console.log("\n━━━ RECOMMEND REQUEST ━━━");
  console.log("Payload:", JSON.stringify(payload));
  console.log("Token (first 40):", authToken.substring(0, 40) + "...");

  try {
    const response = await fetch(`https://www.infinix.club/v5/extend/forYouRecommon?fid=${parseInt(fid) || 293}`, {
      method: "POST",
      headers: {
        "content-type":        "application/json",
        "accept":              "application/json, text/plain, */*",
        "accept-language":     "en-US,en;q=0.9,ur;q=0.8",
        "accept-language-api": "en",
        "xclub-authorization": authToken,
        "cookie":              cookie || "",
        "user-agent":          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        "referer":             "https://www.infinix.club/foryou",
        "origin":              "https://www.infinix.club",
        "sec-ch-ua":           '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
        "sec-ch-ua-mobile":    "?0",
        "sec-ch-ua-platform":  '"Windows"',
        "sec-fetch-dest":      "empty",
        "sec-fetch-mode":      "cors",
        "sec-fetch-site":      "same-origin",
        "priority":            "u=1, i"
      },
      body: JSON.stringify(payload)
    });

    const rawText = await response.text();
    console.log("━━━ RECOMMEND RESPONSE ━━━");
    console.log("HTTP:", response.status);
    console.log("Body:", rawText);

    let data;
    try { data = JSON.parse(rawText); }
    catch { return res.status(502).json({ error: "Non-JSON: " + rawText.slice(0, 200) }); }

    res.json({ success: data.status === 1, raw: data, httpStatus: response.status });

  } catch (err) {
    console.error("Recommend error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 7. User Personal Info Lookup ─────────
app.get("/api/user-info", async (req, res) => {
  const { uuid, authToken, cookie } = req.query;
  if (!authToken) return res.status(400).json({ error: "Auth token required" });

  try {
    const r = await fetch(`https://www.infinix.club/v5/user/personalInfo?uuid=${uuid || ""}`, {
      headers: {
        "xclub-authorization": authToken,
        "cookie":              cookie || "",
        "accept":              "application/json, text/plain, */*",
        "accept-language":     "en-US,en;q=0.9",
        "accept-language-api": "en",
        "user-agent":          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        "referer":             "https://www.infinix.club/foryou",
        "sec-ch-ua":           '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
        "sec-ch-ua-mobile":    "?0",
        "sec-ch-ua-platform":  '"Windows"',
        "sec-fetch-dest":      "empty",
        "sec-fetch-mode":      "cors",
        "sec-fetch-site":      "same-origin"
      }
    });
    const text = await r.text();
    console.log("PersonalInfo:", text.slice(0, 300));
    let data;
    try { data = JSON.parse(text); } catch { return res.status(502).json({ error: "Non-JSON" }); }
    res.json({ httpStatus: r.status, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 8. Auto Image Search ─────────────────
app.post("/api/auto-image", async (req, res) => {
  const { topic, authToken, cookie } = req.body;
  if (!authToken) return res.status(400).json({ error: "Auth token required" });

  const keyword = topic
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ').slice(0, 4).join('+');

  console.log(`\n━━━ AUTO IMAGE: "${keyword}" ━━━`);

  let imageBuffer = null;

  // Source 1: Pixabay — random from top 10 results
  try {
    const r = await fetch(
      `https://pixabay.com/api/?key=49103461-c0f4b57db193c22b8b3b5a9f7&q=${keyword}&image_type=photo&orientation=horizontal&per_page=20&safesearch=true&order=popular`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const d = await r.json();
    if (d?.hits?.length > 0) {
      const pick = d.hits[Math.floor(Math.random() * Math.min(10, d.hits.length))];
      const url  = pick.largeImageURL || pick.webformatURL;
      const dl   = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (dl.ok) {
        imageBuffer = await dl.buffer();
        console.log(`✓ Pixabay: ${pick.tags} | ${Math.round(imageBuffer.length/1024)}KB`);
      }
    }
  } catch(e) { console.warn('Pixabay failed:', e.message); }

  // Source 2: Bing scrape — random from results
  if (!imageBuffer || imageBuffer.length < 5000) {
    try {
      const r = await fetch(
        `https://www.bing.com/images/search?q=${keyword}&first=1&count=20&mkt=en-US`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept-Language': 'en-US' } }
      );
      const html = await r.text();
      const matches = [...html.matchAll(/murl&quot;:&quot;(https?:\/\/[^&"]+\.(?:jpg|jpeg|png))/gi)];
      const urls = matches
        .map(m => m[1])
        .filter(u => !u.includes('bing.com') && !u.includes('microsoft.com') && u.length < 300)
        .sort(() => Math.random() - 0.5)
        .slice(0, 8);

      console.log(`Bing found ${urls.length} URLs`);
      for (const url of urls) {
        try {
          const dl = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (dl.ok && (dl.headers.get('content-type')||''). startsWith('image/')) {
            imageBuffer = await dl.buffer();
            if (imageBuffer.length > 10000) {
              console.log(`✓ Bing: ${url.slice(0,60)} | ${Math.round(imageBuffer.length/1024)}KB`);
              break;
            }
          }
        } catch(e) {}
      }
    } catch(e) { console.warn('Bing failed:', e.message); }
  }

  // Source 3: Picsum RANDOM (different every time — no seed)
  if (!imageBuffer || imageBuffer.length < 5000) {
    try {
      const randId = Math.floor(Math.random() * 1000) + 1;
      const r = await fetch(`https://picsum.photos/id/${randId}/800/500`, {
        redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (r.ok) {
        imageBuffer = await r.buffer();
        console.log(`✓ Picsum random id=${randId}`);
      }
    } catch(e) { console.warn('Picsum failed:', e.message); }
  }

  if (!imageBuffer || imageBuffer.length < 1000) {
    return res.status(500).json({ error: "Could not fetch image from any source" });
  }

  // Upload to Infinix CDN
  const safeName = keyword.replace(/\+/g, '_').slice(0, 20) + '.jpg';
  const form     = new FormData();
  form.append("file", imageBuffer, { filename: safeName, contentType: 'image/jpeg' });

  try {
    const uploadRes = await fetch("https://infinix.club/v5/content/imageUpload", {
      method:  "POST",
      headers: {
        ...form.getHeaders(),
        "xclub-authorization": authToken,
        "cookie":              cookie || "",
        "user-agent":          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        "referer":             "https://infinix.club/note/thread",
        "origin":              "https://infinix.club",
        "accept":              "application/json, text/plain, */*",
        "accept-language-api": "en",
        "sec-fetch-dest":      "empty",
        "sec-fetch-mode":      "cors",
        "sec-fetch-site":      "same-origin"
      },
      body: form
    });
    const uploadData = JSON.parse(await uploadRes.text());
    if (uploadData.status === 1 && uploadData.data?.aid) {
      console.log(`✓ Uploaded — aid: ${uploadData.data.aid}`);
      return res.json({ success: true, aid: String(uploadData.data.aid), url: uploadData.data.fileUrl });
    }
    throw new Error(uploadData.msg || 'Infinix upload failed');
  } catch(err) {
    console.error("Upload error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 9. Fetch user's posts with views ─────
app.get("/api/my-posts", async (req, res) => {
  const { authToken, cookie, page = 1, limit = 20 } = req.query;
  if (!authToken) return res.status(400).json({ error: "Auth token required" });

  try {
    // Extract uid from JWT token
    let uid = '';
    try {
      const payload = JSON.parse(Buffer.from(authToken.split('.')[1], 'base64').toString());
      uid = payload?.jti?.id || '';
    } catch(e) {}

    console.log(`\n━━━ MY POSTS (uid: ${uid}) ━━━`);

    const r = await fetch(
      `https://www.infinix.club/v5/content/thread/userThread?page=${page}&limit=${limit}&uid=${uid}`,
      {
        headers: {
          "xclub-authorization": authToken,
          "cookie":              cookie || "",
          "accept":              "application/json, text/plain, */*",
          "accept-language":     "en-US,en;q=0.9",
          "accept-language-api": "en",
          "user-agent":          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
          "referer":             "https://www.infinix.club/foryou",
          "sec-fetch-dest":      "empty",
          "sec-fetch-mode":      "cors",
          "sec-fetch-site":      "same-origin"
        }
      }
    );

    const text = await r.text();
    console.log("My posts response:", text.slice(0, 400));
    let data;
    try { data = JSON.parse(text); } catch { return res.status(502).json({ error: "Non-JSON" }); }
    res.json({ httpStatus: r.status, data });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 10b. Like a post ───────────────────────
app.post("/api/like", async (req, res) => {
  const { pid, authToken, cookie } = req.body;
  if (!pid)       return res.status(400).json({ error: "pid required" });
  if (!authToken) return res.status(400).json({ error: "Auth token required" });

  console.log(`\n━━━ LIKE REQUEST — pid: ${pid} ━━━`);

  try {
    const r = await fetch("https://infinix.club/v5/content/post/like", {
      method:  "POST",
      headers: {
        "content-type":        "application/json",
        "accept":              "application/json, text/plain, */*",
        "accept-language-api": "en",
        "xclub-authorization": authToken,
        "cookie":              cookie || "",
        "user-agent":          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
        "referer":             "https://infinix.club/foryou",
        "origin":              "https://infinix.club",
        "sec-fetch-dest":      "empty",
        "sec-fetch-mode":      "cors",
        "sec-fetch-site":      "same-origin"
      },
      body: JSON.stringify({ pid: parseInt(pid) })
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { return res.status(502).json({ error: "Non-JSON: " + text.slice(0,200) }); }
    console.log(`Like response for pid ${pid}:`, JSON.stringify(data));
    res.json({ success: data.status === 1, raw: data });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 10c. Comment on a thread ───────────────
app.post("/api/comment", async (req, res) => {
  const { tid, message, authToken, cookie } = req.body;
  if (!tid || !message) return res.status(400).json({ error: "tid and message required" });
  if (!authToken)        return res.status(400).json({ error: "Auth token required" });

  try {
    const r = await fetch("https://infinix.club/v5/content/post/newReply", {
      method:  "POST",
      headers: {
        "content-type":        "application/json",
        "accept":              "application/json, text/plain, */*",
        "accept-language-api": "en",
        "xclub-authorization": authToken,
        "cookie":              cookie || "",
        "user-agent":          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
        "referer":             `https://infinix.club/forum/209/${tid}`,
        "origin":              "https://infinix.club",
        "sec-fetch-dest":      "empty",
        "sec-fetch-mode":      "cors",
        "sec-fetch-site":      "same-origin"
      },
      body: JSON.stringify({ tid: String(tid), message })
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { return res.status(502).json({ error: "Non-JSON: " + text.slice(0,200) }); }
    res.json({ success: data.status === 1, raw: data });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 10. Single thread views ───────────────
app.get("/api/thread/:tid", async (req, res) => {
  const { tid } = req.params;
  const { authToken, cookie } = req.query;

  try {
    const r = await fetch(`https://infinix.club/v5/content/thread/${tid}`, {
      headers: {
        "xclub-authorization": authToken || "",
        "cookie":              cookie || "",
        "accept":              "application/json, text/plain, */*",
        "accept-language-api": "en",
        "user-agent":          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        "referer":             "https://infinix.club/foryou",
        "sec-fetch-dest":      "empty",
        "sec-fetch-mode":      "cors",
        "sec-fetch-site":      "same-origin"
      }
    });
    const data = JSON.parse(await r.text());
    const d    = data?.data || {};
    console.log(`Thread lookup: tid=${tid} → pid=${d.pid}, subject="${d.subject}"`);
    res.json({
      success: true,
      tid:      d.tid,
      pid:      d.pid,
      subject:  d.subject,
      views:    d.views    || 0,
      replies:  d.replies  || 0,
      likes:    d.like     || 0,
      shares:   d.share_num|| 0,
      dateline: d.dateline || 0,
      fid:      d.fid      || 0,
      topid:    d.topid    || 0
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Start ─────────────────────────────────
const os = require("os");

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

app.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log(`\n✓ Infinix Club Proxy Server running`);
  console.log(`\n  💻 PC:     http://localhost:${PORT}`);
  console.log(`  📱 Mobile: http://${localIP}:${PORT}`);
  console.log(`\n  Dashboard (PC):     http://localhost:${PORT}/login.html`);
  console.log(`  Dashboard (Mobile): http://${localIP}:${PORT}/login.html\n`);
});
