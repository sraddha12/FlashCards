import { useState, useEffect, useCallback, useRef } from "react";

// ── Utility helpers ──────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();
const fmtDate = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const DIFFICULTIES = ["Beginner", "Intermediate", "Advanced"];
const COLORS = ["#7C3AED", "#0891B2", "#059669", "#D97706", "#DC2626", "#7C2D12"];

// ── Storage helpers ──────────────────────────────────────────────────────────
const load = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// ── Spaced Repetition (SM-2 simplified) ─────────────────────────────────────
const srNextInterval = (card, quality) => {
  const ef = Math.max(1.3, (card.ef || 2.5) + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  const interval = quality < 3 ? 1 : card.interval ? Math.round(card.interval * ef) : 1;
  return { ef, interval, nextReview: Date.now() + interval * 86400000, reviews: (card.reviews || 0) + 1 };
};

// ── Toast system ─────────────────────────────────────────────────────────────
let _setToasts;
const toast = (msg, type = "info") => _setToasts?.(t => [...t, { id: uid(), msg, type }]);

// ── Claude API call ───────────────────────────────────────────────────────────
async function callClaude(prompt, system = "") {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      system: system || "You are an expert educator and flashcard creator. Always respond with valid JSON only, no markdown, no explanation.",
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  return data.content.map(b => b.text || "").join("");
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [user, setUser] = useState(() => load("fc_user", null));
  const [decks, setDecks] = useState(() => load("fc_decks", []));
  const [cards, setCards] = useState(() => load("fc_cards", []));
  const [history, setHistory] = useState(() => load("fc_history", []));
  const [toasts, setToasts] = useState([]);
  const [page, setPage] = useState("dashboard");
  const [activeDeck, setActiveDeck] = useState(null);
  const [darkMode, setDarkMode] = useState(() => load("fc_dark", false));
  const [studySession, setStudySession] = useState(null);

  _setToasts = setToasts;

  useEffect(() => { save("fc_decks", decks); }, [decks]);
  useEffect(() => { save("fc_cards", cards); }, [cards]);
  useEffect(() => { save("fc_history", history); }, [history]);
  useEffect(() => { save("fc_user", user); }, [user]);
  useEffect(() => { save("fc_dark", darkMode); }, [darkMode]);

  useEffect(() => {
    const t = setTimeout(() => setToasts(ts => ts.slice(1)), 3500);
    return () => clearTimeout(t);
  }, [toasts]);

  const addDeck = (deck) => setDecks(d => [{ ...deck, id: uid(), createdAt: now(), color: COLORS[d.length % COLORS.length] }, ...d]);
  const addCards = (newCards) => setCards(c => [...newCards.map(x => ({ ...x, id: uid(), createdAt: now() })), ...c]);
  const deleteDeck = (id) => { setDecks(d => d.filter(x => x.id !== id)); setCards(c => c.filter(x => x.deckId !== id)); };
  const logHistory = (entry) => setHistory(h => [{ ...entry, id: uid(), date: now() }, ...h].slice(0, 200));

  const deckCards = (deckId) => cards.filter(c => c.deckId === deckId);

  if (!user) return <AuthScreen onAuth={setUser} darkMode={darkMode} />;

  const startStudy = (deck) => {
    const dc = deckCards(deck.id);
    if (!dc.length) { toast("No cards in this deck!", "warn"); return; }
    setActiveDeck(deck);
    setStudySession({ cards: dc, index: 0, correct: 0, mode: "flip" });
    setPage("study");
  };

  return (
    <div style={{ minHeight: "100vh", background: darkMode ? "#0f1117" : "#f5f3ff", fontFamily: "'DM Sans', 'Segoe UI', sans-serif", color: darkMode ? "#e2e8f0" : "#1e1b4b" }}>
      {/* Google Font */}
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet" />

      {/* Toasts */}
      <div style={{ position: "fixed", top: 16, right: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8 }}>
        {toasts.map(t => (
          <div key={t.id} style={{ padding: "10px 16px", borderRadius: 10, fontSize: 14, fontWeight: 500, background: t.type === "error" ? "#fecaca" : t.type === "warn" ? "#fef9c3" : t.type === "success" ? "#bbf7d0" : "#e0e7ff", color: t.type === "error" ? "#991b1b" : t.type === "warn" ? "#854d0e" : t.type === "success" ? "#166534" : "#3730a3", boxShadow: "0 4px 12px rgba(0,0,0,0.12)", animation: "slideIn 0.3s ease" }}>
            {t.msg}
          </div>
        ))}
      </div>

      <style>{`
        @keyframes slideIn { from { transform: translateX(40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes flipIn { from { transform: rotateY(90deg); opacity: 0; } to { transform: rotateY(0); opacity: 1; } }
        @keyframes fadeUp { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .card-flip { animation: flipIn 0.35s ease; }
        .fade-up { animation: fadeUp 0.4s ease; }
        .hover-lift:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(124,58,237,0.15) !important; transition: all 0.2s ease; }
        .btn-primary { background: linear-gradient(135deg, #7c3aed, #6d28d9); color: white; border: none; padding: 10px 20px; border-radius: 10px; cursor: pointer; font-size: 14px; font-weight: 600; transition: all 0.2s; }
        .btn-primary:hover { background: linear-gradient(135deg, #6d28d9, #5b21b6); transform: translateY(-1px); }
        .btn-secondary { background: transparent; color: #7c3aed; border: 1.5px solid #7c3aed; padding: 9px 20px; border-radius: 10px; cursor: pointer; font-size: 14px; font-weight: 600; transition: all 0.2s; }
        .btn-secondary:hover { background: #f5f3ff; }
        input, textarea, select { outline: none; font-family: inherit; }
        input:focus, textarea:focus, select:focus { border-color: #7c3aed !important; box-shadow: 0 0 0 3px rgba(124,58,237,0.1); }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-thumb { background: #c4b5fd; border-radius: 3px; }
        .nav-item { padding: 10px 14px; border-radius: 10px; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.15s; display: flex; align-items: center; gap: 10px; }
        .nav-item:hover { background: rgba(124,58,237,0.08); }
        .nav-item.active { background: linear-gradient(135deg, #7c3aed, #6d28d9); color: white; }
      `}</style>

      <div style={{ display: "flex", minHeight: "100vh" }}>
        {/* Sidebar */}
        <Sidebar page={page} setPage={setPage} user={user} setUser={setUser} darkMode={darkMode} setDarkMode={setDarkMode} decks={decks} setActiveDeck={setActiveDeck} />

        {/* Main */}
        <main style={{ flex: 1, padding: "28px 32px", overflowY: "auto", maxHeight: "100vh" }}>
          {page === "dashboard" && <Dashboard user={user} decks={decks} cards={cards} history={history} setPage={setPage} setActiveDeck={setActiveDeck} startStudy={startStudy} darkMode={darkMode} />}
          {page === "generate" && <GenerateCards decks={decks} addDeck={addDeck} addCards={addCards} setPage={setPage} setActiveDeck={setActiveDeck} darkMode={darkMode} />}
          {page === "decks" && <DecksPage decks={decks} cards={cards} addDeck={addDeck} deleteDeck={deleteDeck} setActiveDeck={setActiveDeck} setPage={setPage} startStudy={startStudy} darkMode={darkMode} />}
          {page === "deck-detail" && activeDeck && <DeckDetail deck={activeDeck} cards={deckCards(activeDeck.id)} setCards={setCards} setPage={setPage} startStudy={startStudy} darkMode={darkMode} />}
          {page === "study" && studySession && activeDeck && <StudyMode session={studySession} setSession={setStudySession} deck={activeDeck} setCards={setCards} logHistory={logHistory} setPage={setPage} darkMode={darkMode} />}
          {page === "chat" && <AIChat decks={decks} cards={cards} darkMode={darkMode} />}
        </main>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTH SCREEN
// ══════════════════════════════════════════════════════════════════════════════
function AuthScreen({ onAuth, darkMode }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);

  const handle = async (e) => {
    e.preventDefault();
    if (!form.email || !form.password) { toast("Fill all fields", "warn"); return; }
    setLoading(true);
    await new Promise(r => setTimeout(r, 600));
    const users = load("fc_users_db", []);
    if (mode === "signup") {
      if (users.find(u => u.email === form.email)) { toast("Email already exists", "error"); setLoading(false); return; }
      const u = { id: uid(), name: form.name || form.email.split("@")[0], email: form.email, password: form.password, joinedAt: now(), streak: 0, totalStudied: 0 };
      save("fc_users_db", [...users, u]);
      onAuth(u); toast("Welcome aboard! 🎉", "success");
    } else {
      const u = users.find(u => u.email === form.email && u.password === form.password);
      if (!u) { toast("Invalid credentials", "error"); setLoading(false); return; }
      onAuth(u); toast(`Welcome back, ${u.name}!`, "success");
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #1e1b4b 0%, #4c1d95 50%, #1e1b4b 100%)" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet" />
      <style>{`.btn-primary{background:linear-gradient(135deg,#7c3aed,#6d28d9);color:white;border:none;padding:12px 20px;border-radius:10px;cursor:pointer;font-size:15px;font-weight:600;width:100%;transition:all 0.2s;}input{outline:none;font-family:inherit;}input:focus{border-color:#7c3aed!important;box-shadow:0 0 0 3px rgba(124,58,237,0.2);}`}</style>
      <div className="fade-up" style={{ background: "white", borderRadius: 20, padding: "40px 44px", width: "100%", maxWidth: 420, boxShadow: "0 24px 80px rgba(0,0,0,0.4)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg, #7c3aed, #6d28d9)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: 26 }}>🃏</div>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, color: "#1e1b4b", margin: "0 0 6px" }}>FlashMind AI</h1>
          <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>AI-powered flashcard learning</p>
        </div>
        <div style={{ display: "flex", gap: 0, marginBottom: 28, borderRadius: 10, overflow: "hidden", border: "1.5px solid #e2e8f0" }}>
          {["login", "signup"].map(m => (
            <button key={m} onClick={() => setMode(m)} style={{ flex: 1, padding: "10px", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, background: mode === m ? "#7c3aed" : "white", color: mode === m ? "white" : "#64748b", transition: "all 0.2s" }}>
              {m === "login" ? "Log In" : "Sign Up"}
            </button>
          ))}
        </div>
        <form onSubmit={handle} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {mode === "signup" && <input placeholder="Your name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ padding: "11px 14px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 14 }} />}
          <input type="email" placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={{ padding: "11px 14px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 14 }} />
          <input type="password" placeholder="Password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} style={{ padding: "11px 14px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 14 }} />
          <button className="btn-primary" type="submit" disabled={loading} style={{ marginTop: 6 }}>
            {loading ? "Please wait..." : mode === "login" ? "Log In" : "Create Account"}
          </button>
        </form>
        <p style={{ textAlign: "center", fontSize: 12, color: "#94a3b8", marginTop: 20 }}>Demo: use any email + password</p>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SIDEBAR
// ══════════════════════════════════════════════════════════════════════════════
function Sidebar({ page, setPage, user, setUser, darkMode, setDarkMode, decks }) {
  const bg = darkMode ? "#16192a" : "#1e1b4b";
  const items = [
    { id: "dashboard", icon: "⊞", label: "Dashboard" },
    { id: "generate", icon: "✦", label: "AI Generate" },
    { id: "decks", icon: "◫", label: "My Decks" },
    { id: "chat", icon: "◎", label: "AI Tutor" },
  ];
  return (
    <aside style={{ width: 220, background: bg, display: "flex", flexDirection: "column", padding: "20px 14px", gap: 4, minHeight: "100vh", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 10px 20px" }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #a78bfa, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🃏</div>
        <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, color: "white", fontWeight: 700 }}>FlashMind</span>
      </div>
      {items.map(item => (
        <div key={item.id} className="nav-item" onClick={() => setPage(item.id)} style={{ color: page === item.id ? "white" : "#a5b4fc", background: page === item.id ? "rgba(124,58,237,0.4)" : "transparent" }}>
          <span style={{ fontSize: 16 }}>{item.icon}</span>
          <span>{item.label}</span>
        </div>
      ))}
      <div style={{ flex: 1 }} />
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="nav-item" onClick={() => setDarkMode(d => !d)} style={{ color: "#a5b4fc", fontSize: 13 }}>
          <span>{darkMode ? "☀" : "◑"}</span>
          <span>{darkMode ? "Light Mode" : "Dark Mode"}</span>
        </div>
        <div className="nav-item" onClick={() => { setUser(null); toast("Logged out"); }} style={{ color: "#f87171", fontSize: 13 }}>
          <span>↩</span><span>Log Out</span>
        </div>
        <div style={{ padding: "8px 10px", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,#a78bfa,#7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "white", fontWeight: 700 }}>
            {user.name[0].toUpperCase()}
          </div>
          <div style={{ overflow: "hidden" }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "white", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.name}</p>
            <p style={{ margin: 0, fontSize: 10, color: "#7c6fb0" }}>{decks.length} decks</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════
function Dashboard({ user, decks, cards, history, setPage, setActiveDeck, startStudy, darkMode }) {
  const c = darkMode;
  const totalCards = cards.length;
  const recentDecks = decks.slice(0, 3);
  const streak = Math.min(history.filter(h => new Date(h.date) > Date.now() - 7 * 86400000).length, 7);
  const accuracy = history.length ? Math.round(history.reduce((a, h) => a + (h.accuracy || 0), 0) / history.length) : 0;

  const statCard = (label, value, icon, color) => (
    <div className="hover-lift" style={{ background: c ? "#1e2235" : "white", borderRadius: 16, padding: "20px 24px", flex: 1, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", border: `1px solid ${c ? "#2d3555" : "#ede9fe"}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p style={{ margin: "0 0 4px", fontSize: 12, color: c ? "#7c6fb0" : "#94a3b8", fontWeight: 500 }}>{label}</p>
          <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: color }}>{value}</p>
        </div>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: color + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{icon}</div>
      </div>
    </div>
  );

  return (
    <div className="fade-up">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
        <div>
          <h1 style={{ margin: "0 0 4px", fontSize: 26, fontFamily: "'Playfair Display', serif", color: c ? "#e2e8f0" : "#1e1b4b" }}>Good day, {user.name.split(" ")[0]} 👋</h1>
          <p style={{ margin: 0, color: c ? "#7c6fb0" : "#64748b", fontSize: 14 }}>Ready to learn something new today?</p>
        </div>
        <button className="btn-primary" onClick={() => setPage("generate")}>+ AI Generate</button>
      </div>

      <div style={{ display: "flex", gap: 16, marginBottom: 28 }}>
        {statCard("Total Cards", totalCards, "📚", "#7c3aed")}
        {statCard("Total Decks", decks.length, "🗂", "#0891b2")}
        {statCard("Study Streak", `${streak}d`, "🔥", "#f59e0b")}
        {statCard("Accuracy", `${accuracy}%`, "🎯", "#059669")}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ background: c ? "#1e2235" : "white", borderRadius: 16, padding: "22px 24px", border: `1px solid ${c ? "#2d3555" : "#ede9fe"}` }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600, color: c ? "#e2e8f0" : "#1e1b4b" }}>Recent Decks</h3>
          {recentDecks.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 0", color: c ? "#7c6fb0" : "#94a3b8" }}>
              <p style={{ fontSize: 32, margin: "0 0 8px" }}>🃏</p>
              <p style={{ fontSize: 14, margin: 0 }}>No decks yet. Generate some!</p>
              <button className="btn-primary" onClick={() => setPage("generate")} style={{ marginTop: 12 }}>Get Started</button>
            </div>
          ) : recentDecks.map(d => (
            <div key={d.id} className="hover-lift" onClick={() => { setActiveDeck(d); setPage("deck-detail"); }} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderRadius: 10, cursor: "pointer", marginBottom: 8, border: `1px solid ${c ? "#2d3555" : "#f0f0ff"}`, background: c ? "#262d45" : "#fafafe" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: d.color }} />
                <div>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: c ? "#c4b5fd" : "#3730a3" }}>{d.name}</p>
                  <p style={{ margin: 0, fontSize: 11, color: c ? "#7c6fb0" : "#94a3b8" }}>{cards.filter(x => x.deckId === d.id).length} cards · {fmtDate(d.createdAt)}</p>
                </div>
              </div>
              <button onClick={e => { e.stopPropagation(); startStudy(d); }} style={{ background: "#7c3aed22", color: "#7c3aed", border: "none", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Study</button>
            </div>
          ))}
          {decks.length > 3 && <p onClick={() => setPage("decks")} style={{ margin: "8px 0 0", fontSize: 13, color: "#7c3aed", cursor: "pointer", textAlign: "center" }}>View all {decks.length} decks →</p>}
        </div>

        <div style={{ background: c ? "#1e2235" : "white", borderRadius: 16, padding: "22px 24px", border: `1px solid ${c ? "#2d3555" : "#ede9fe"}` }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600, color: c ? "#e2e8f0" : "#1e1b4b" }}>Study History</h3>
          {history.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 0", color: c ? "#7c6fb0" : "#94a3b8" }}>
              <p style={{ fontSize: 32, margin: "0 0 8px" }}>📊</p>
              <p style={{ fontSize: 14, margin: 0 }}>Study a deck to see history</p>
            </div>
          ) : history.slice(0, 6).map(h => (
            <div key={h.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${c ? "#2d3555" : "#f5f3ff"}` }}>
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: c ? "#c4b5fd" : "#3730a3" }}>{h.deckName}</p>
                <p style={{ margin: 0, fontSize: 11, color: c ? "#7c6fb0" : "#94a3b8" }}>{fmtDate(h.date)} · {h.cards} cards</p>
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: (h.accuracy || 0) >= 70 ? "#059669" : "#f59e0b" }}>{h.accuracy || 0}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// AI GENERATE CARDS
// ══════════════════════════════════════════════════════════════════════════════
function GenerateCards({ decks, addDeck, addCards, setPage, setActiveDeck, darkMode }) {
  const c = darkMode;
  const [form, setForm] = useState({ topic: "", notes: "", difficulty: "Intermediate", count: 10, newDeckName: "", existingDeckId: "", deckChoice: "new" });
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [progress, setProgress] = useState("");

  const generate = async () => {
    if (!form.topic.trim()) { toast("Enter a topic", "warn"); return; }
    if (form.deckChoice === "new" && !form.newDeckName.trim()) { toast("Enter deck name", "warn"); return; }
    if (form.deckChoice === "existing" && !form.existingDeckId) { toast("Select a deck", "warn"); return; }

    setLoading(true);
    setProgress("Connecting to AI...");
    try {
      setProgress("Generating flashcards...");
      const prompt = `Create ${form.count} flashcards for "${form.topic}" at ${form.difficulty} level.
${form.notes ? `Additional context: ${form.notes.slice(0, 500)}` : ""}
Return ONLY a JSON array like:
[{"question":"...","answer":"...","keyConcept":"...","hint":"...","tags":["tag1","tag2"]}]
Make questions clear and answers concise. Include practical examples where helpful.`;

      const raw = await callClaude(prompt);
      const clean = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setPreview(parsed);
      setProgress("");
      toast(`Generated ${parsed.length} cards!`, "success");
    } catch (err) {
      toast("Generation failed: " + err.message, "error");
      setProgress("");
    }
    setLoading(false);
  };

  const save = () => {
    let deckId;
    if (form.deckChoice === "new") {
      const deck = { name: form.newDeckName, subject: form.topic, difficulty: form.difficulty };
      const id = uid();
      deckId = id;
      addDeck({ ...deck, id });
    } else {
      deckId = form.existingDeckId;
    }
    const newCards = preview.map(c => ({ ...c, deckId, difficulty: form.difficulty, flipped: false, ef: 2.5, interval: 0, reviews: 0, correct: 0, incorrect: 0 }));
    addCards(newCards);
    const deck = form.deckChoice === "new" ? { id: deckId, name: form.newDeckName } : decks.find(d => d.id === deckId);
    setActiveDeck(deck);
    setPreview(null);
    toast("Cards saved! 🎉", "success");
    setPage("deck-detail");
  };

  const inputStyle = { width: "100%", padding: "11px 14px", borderRadius: 10, border: `1.5px solid ${c ? "#2d3555" : "#e2e8f0"}`, fontSize: 14, background: c ? "#262d45" : "white", color: c ? "#e2e8f0" : "#1e1b4b", boxSizing: "border-box" };

  return (
    <div className="fade-up">
      <h1 style={{ margin: "0 0 6px", fontSize: 26, fontFamily: "'Playfair Display', serif", color: c ? "#e2e8f0" : "#1e1b4b" }}>AI Flashcard Generator</h1>
      <p style={{ margin: "0 0 28px", color: c ? "#7c6fb0" : "#64748b", fontSize: 14 }}>Describe your topic and let AI create perfect study cards</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <div style={{ background: c ? "#1e2235" : "white", borderRadius: 16, padding: "24px", border: `1px solid ${c ? "#2d3555" : "#ede9fe"}` }}>
          <h3 style={{ margin: "0 0 20px", fontSize: 16, color: c ? "#e2e8f0" : "#1e1b4b" }}>Configure Generation</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: c ? "#a78bfa" : "#7c3aed", marginBottom: 6, display: "block" }}>TOPIC *</label>
              <input style={inputStyle} placeholder="e.g. Photosynthesis, World War II, React Hooks..." value={form.topic} onChange={e => setForm(f => ({ ...f, topic: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: c ? "#a78bfa" : "#7c3aed", marginBottom: 6, display: "block" }}>ADDITIONAL NOTES (optional)</label>
              <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 90 }} placeholder="Paste your notes, textbook excerpt, or additional context..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: c ? "#a78bfa" : "#7c3aed", marginBottom: 6, display: "block" }}>DIFFICULTY</label>
                <select style={inputStyle} value={form.difficulty} onChange={e => setForm(f => ({ ...f, difficulty: e.target.value }))}>
                  {DIFFICULTIES.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: c ? "#a78bfa" : "#7c3aed", marginBottom: 6, display: "block" }}>CARD COUNT</label>
                <select style={inputStyle} value={form.count} onChange={e => setForm(f => ({ ...f, count: +e.target.value }))}>
                  {[5, 10, 15, 20, 25].map(n => <option key={n}>{n}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: c ? "#a78bfa" : "#7c3aed", marginBottom: 8, display: "block" }}>SAVE TO DECK</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                {["new", "existing"].map(v => (
                  <label key={v} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, color: c ? "#c4b5fd" : "#3730a3" }}>
                    <input type="radio" name="deckChoice" value={v} checked={form.deckChoice === v} onChange={() => setForm(f => ({ ...f, deckChoice: v }))} />
                    {v === "new" ? "New Deck" : "Existing Deck"}
                  </label>
                ))}
              </div>
              {form.deckChoice === "new" ? (
                <input style={inputStyle} placeholder="New deck name..." value={form.newDeckName} onChange={e => setForm(f => ({ ...f, newDeckName: e.target.value }))} />
              ) : (
                <select style={inputStyle} value={form.existingDeckId} onChange={e => setForm(f => ({ ...f, existingDeckId: e.target.value }))}>
                  <option value="">Select deck...</option>
                  {decks.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              )}
            </div>
            <button className="btn-primary" onClick={generate} disabled={loading} style={{ marginTop: 4 }}>
              {loading ? progress || "Generating..." : "✦ Generate with AI"}
            </button>
          </div>
        </div>

        <div style={{ background: c ? "#1e2235" : "white", borderRadius: 16, padding: "24px", border: `1px solid ${c ? "#2d3555" : "#ede9fe"}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 16, color: c ? "#e2e8f0" : "#1e1b4b" }}>Preview</h3>
            {preview && <button className="btn-primary" onClick={save} style={{ padding: "8px 16px", fontSize: 13 }}>Save {preview.length} Cards</button>}
          </div>
          {loading ? (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ width: 48, height: 48, border: "3px solid #ede9fe", borderTopColor: "#7c3aed", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              <p style={{ color: c ? "#a78bfa" : "#7c3aed", fontSize: 14 }}>{progress}</p>
            </div>
          ) : preview ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 500, overflowY: "auto" }}>
              {preview.map((card, i) => (
                <div key={i} style={{ padding: "12px 14px", borderRadius: 10, background: c ? "#262d45" : "#fafafe", border: `1px solid ${c ? "#2d3555" : "#ede9fe"}` }}>
                  <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 600, color: c ? "#c4b5fd" : "#3730a3" }}>Q: {card.question}</p>
                  <p style={{ margin: "0 0 4px", fontSize: 12, color: c ? "#7c6fb0" : "#64748b" }}>A: {card.answer}</p>
                  {card.tags?.length > 0 && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                      {card.tags.map((t, j) => <span key={j} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: "#7c3aed22", color: "#7c3aed", fontWeight: 600 }}>{t}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "40px 20px", color: c ? "#7c6fb0" : "#94a3b8" }}>
              <p style={{ fontSize: 40, margin: "0 0 12px" }}>✦</p>
              <p style={{ fontSize: 14 }}>Generated cards will appear here</p>
              <p style={{ fontSize: 12, marginTop: 6 }}>Configure your settings and click Generate</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// DECKS PAGE
// ══════════════════════════════════════════════════════════════════════════════
function DecksPage({ decks, cards, addDeck, deleteDeck, setActiveDeck, setPage, startStudy, darkMode }) {
  const c = darkMode;
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newDeck, setNewDeck] = useState({ name: "", subject: "", difficulty: "Beginner" });

  const filtered = decks.filter(d => d.name.toLowerCase().includes(search.toLowerCase()) || d.subject?.toLowerCase().includes(search.toLowerCase()));

  const create = () => {
    if (!newDeck.name) { toast("Enter deck name", "warn"); return; }
    addDeck(newDeck);
    setNewDeck({ name: "", subject: "", difficulty: "Beginner" });
    setShowCreate(false);
    toast("Deck created!", "success");
  };

  return (
    <div className="fade-up">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontFamily: "'Playfair Display', serif", color: c ? "#e2e8f0" : "#1e1b4b" }}>My Decks</h1>
        <div style={{ display: "flex", gap: 10 }}>
          <input placeholder="Search decks..." value={search} onChange={e => setSearch(e.target.value)} style={{ padding: "9px 14px", borderRadius: 10, border: `1.5px solid ${c ? "#2d3555" : "#e2e8f0"}`, fontSize: 13, background: c ? "#1e2235" : "white", color: c ? "#e2e8f0" : "#1e1b4b", width: 200 }} />
          <button className="btn-primary" onClick={() => setShowCreate(true)}>+ New Deck</button>
        </div>
      </div>

      {showCreate && (
        <div style={{ background: c ? "#1e2235" : "white", borderRadius: 16, padding: 20, marginBottom: 20, border: `1px solid #7c3aed44` }}>
          <h3 style={{ margin: "0 0 14px", fontSize: 15, color: c ? "#e2e8f0" : "#1e1b4b" }}>Create New Deck</h3>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
            <input placeholder="Deck name *" value={newDeck.name} onChange={e => setNewDeck(n => ({ ...n, name: e.target.value }))} style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${c ? "#2d3555" : "#e2e8f0"}`, fontSize: 13, background: c ? "#262d45" : "white", color: c ? "#e2e8f0" : "#1e1b4b" }} />
            <input placeholder="Subject" value={newDeck.subject} onChange={e => setNewDeck(n => ({ ...n, subject: e.target.value }))} style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${c ? "#2d3555" : "#e2e8f0"}`, fontSize: 13, background: c ? "#262d45" : "white", color: c ? "#e2e8f0" : "#1e1b4b" }} />
            <select value={newDeck.difficulty} onChange={e => setNewDeck(n => ({ ...n, difficulty: e.target.value }))} style={{ padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${c ? "#2d3555" : "#e2e8f0"}`, fontSize: 13, background: c ? "#262d45" : "white", color: c ? "#e2e8f0" : "#1e1b4b" }}>
              {DIFFICULTIES.map(d => <option key={d}>{d}</option>)}
            </select>
            <button className="btn-primary" onClick={create}>Create</button>
            <button className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: c ? "#7c6fb0" : "#94a3b8" }}>
          <p style={{ fontSize: 40 }}>🗂</p>
          <p style={{ fontSize: 16 }}>{search ? "No decks match your search" : "No decks yet"}</p>
          <button className="btn-primary" onClick={() => setPage("generate")} style={{ marginTop: 12 }}>Generate with AI</button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {filtered.map(d => {
            const dc = cards.filter(x => x.deckId === d.id);
            return (
              <div key={d.id} className="hover-lift" style={{ background: c ? "#1e2235" : "white", borderRadius: 16, padding: "20px", border: `1px solid ${c ? "#2d3555" : "#ede9fe"}`, cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: d.color + "33", border: `2px solid ${d.color}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📚</div>
                  <button onClick={e => { e.stopPropagation(); if (confirm("Delete this deck?")) { deleteDeck(d.id); toast("Deck deleted"); } }} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 16, color: c ? "#7c6fb0" : "#cbd5e1" }}>🗑</button>
                </div>
                <h3 onClick={() => { setActiveDeck(d); setPage("deck-detail"); }} style={{ margin: "12px 0 4px", fontSize: 16, fontWeight: 700, color: c ? "#c4b5fd" : "#1e1b4b" }}>{d.name}</h3>
                <p style={{ margin: "0 0 14px", fontSize: 12, color: c ? "#7c6fb0" : "#94a3b8" }}>{d.subject || "General"} · {d.difficulty || "—"}</p>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: c ? "#a78bfa" : "#7c3aed" }}>{dc.length} cards</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => { setActiveDeck(d); setPage("deck-detail"); }} style={{ background: "transparent", border: `1px solid ${c ? "#2d3555" : "#e2e8f0"}`, borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12, color: c ? "#c4b5fd" : "#64748b" }}>View</button>
                    <button onClick={() => startStudy(d)} style={{ background: "#7c3aed22", border: "none", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#7c3aed" }}>Study</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// DECK DETAIL
// ══════════════════════════════════════════════════════════════════════════════
function DeckDetail({ deck, cards, setCards, setPage, startStudy, darkMode }) {
  const c = darkMode;
  const [search, setSearch] = useState("");
  const [editCard, setEditCard] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newCard, setNewCard] = useState({ question: "", answer: "", keyConcept: "", hint: "", tags: "" });
  const [aiLoading, setAiLoading] = useState(false);

  const filtered = cards.filter(x => x.question?.toLowerCase().includes(search.toLowerCase()) || x.answer?.toLowerCase().includes(search.toLowerCase()));

  const deleteCard = (id) => setCards(all => all.filter(x => x.id !== id));
  const updateCard = (id, upd) => setCards(all => all.map(x => x.id === id ? { ...x, ...upd } : x));

  const addCard = () => {
    if (!newCard.question || !newCard.answer) { toast("Fill question and answer", "warn"); return; }
    const card = { ...newCard, id: uid(), deckId: deck.id, createdAt: now(), tags: newCard.tags.split(",").map(t => t.trim()).filter(Boolean), ef: 2.5, interval: 0, reviews: 0 };
    setCards(all => [card, ...all]);
    setNewCard({ question: "", answer: "", keyConcept: "", hint: "", tags: "" });
    setShowAdd(false);
    toast("Card added!", "success");
  };

  const genSummary = async () => {
    if (!cards.length) { toast("No cards to summarize", "warn"); return; }
    setAiLoading(true);
    try {
      const topics = cards.slice(0, 15).map(c => c.question).join("; ");
      const raw = await callClaude(`Summarize the key concepts covered in these flashcard questions in 3-4 sentences: ${topics}`);
      toast(raw.slice(0, 200), "info");
    } catch { toast("Failed", "error"); }
    setAiLoading(false);
  };

  const inputStyle = { width: "100%", padding: "9px 12px", borderRadius: 8, border: `1.5px solid ${c ? "#2d3555" : "#e2e8f0"}`, fontSize: 13, background: c ? "#262d45" : "white", color: c ? "#e2e8f0" : "#1e1b4b", boxSizing: "border-box" };

  return (
    <div className="fade-up">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setPage("decks")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: c ? "#a78bfa" : "#7c3aed" }}>←</button>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontFamily: "'Playfair Display', serif", color: c ? "#e2e8f0" : "#1e1b4b" }}>{deck.name}</h1>
            <p style={{ margin: 0, fontSize: 13, color: c ? "#7c6fb0" : "#64748b" }}>{cards.length} cards · {deck.difficulty}</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-secondary" onClick={genSummary} disabled={aiLoading} style={{ fontSize: 13 }}>{aiLoading ? "..." : "✦ AI Summary"}</button>
          <button className="btn-secondary" onClick={() => setShowAdd(s => !s)} style={{ fontSize: 13 }}>+ Add Card</button>
          <button className="btn-primary" onClick={() => startStudy(deck)}>Study Now</button>
        </div>
      </div>

      {showAdd && (
        <div style={{ background: c ? "#1e2235" : "white", borderRadius: 14, padding: 20, marginBottom: 20, border: "1px solid #7c3aed44" }}>
          <h3 style={{ margin: "0 0 14px", fontSize: 15, color: c ? "#e2e8f0" : "#1e1b4b" }}>Add New Card</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#7c3aed", display: "block", marginBottom: 4 }}>QUESTION *</label>
              <textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} placeholder="Question..." value={newCard.question} onChange={e => setNewCard(n => ({ ...n, question: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#7c3aed", display: "block", marginBottom: 4 }}>ANSWER *</label>
              <textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} placeholder="Answer..." value={newCard.answer} onChange={e => setNewCard(n => ({ ...n, answer: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#7c3aed", display: "block", marginBottom: 4 }}>KEY CONCEPT</label>
              <input style={inputStyle} placeholder="Core idea..." value={newCard.keyConcept} onChange={e => setNewCard(n => ({ ...n, keyConcept: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#7c3aed", display: "block", marginBottom: 4 }}>TAGS (comma-separated)</label>
              <input style={inputStyle} placeholder="biology, cell, science..." value={newCard.tags} onChange={e => setNewCard(n => ({ ...n, tags: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn-primary" onClick={addCard}>Add Card</button>
            <button className="btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <input placeholder="Search cards..." value={search} onChange={e => setSearch(e.target.value)} style={{ padding: "9px 14px", borderRadius: 10, border: `1.5px solid ${c ? "#2d3555" : "#e2e8f0"}`, fontSize: 13, background: c ? "#1e2235" : "white", color: c ? "#e2e8f0" : "#1e1b4b", width: "100%", boxSizing: "border-box" }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
        {filtered.map(card => (
          <div key={card.id} style={{ background: c ? "#1e2235" : "white", borderRadius: 14, padding: "16px", border: `1px solid ${c ? "#2d3555" : "#ede9fe"}` }}>
            {editCard === card.id ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <textarea defaultValue={card.question} id={`q-${card.id}`} style={{ ...inputStyle, minHeight: 60, resize: "none" }} />
                <textarea defaultValue={card.answer} id={`a-${card.id}`} style={{ ...inputStyle, minHeight: 60, resize: "none" }} />
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => { updateCard(card.id, { question: document.getElementById(`q-${card.id}`).value, answer: document.getElementById(`a-${card.id}`).value }); setEditCard(null); toast("Updated!"); }} style={{ background: "#7c3aed", color: "white", border: "none", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 12 }}>Save</button>
                  <button onClick={() => setEditCard(null)} style={{ background: "transparent", color: c ? "#7c6fb0" : "#64748b", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 12 }}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <p style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600, color: c ? "#c4b5fd" : "#1e1b4b" }}>{card.question}</p>
                <p style={{ margin: "0 0 10px", fontSize: 13, color: c ? "#7c6fb0" : "#64748b" }}>{card.answer}</p>
                {card.keyConcept && <p style={{ margin: "0 0 8px", fontSize: 11, color: c ? "#a78bfa" : "#7c3aed", fontWeight: 600 }}>💡 {card.keyConcept}</p>}
                {card.tags?.length > 0 && (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
                    {card.tags.map((t, i) => <span key={i} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: "#7c3aed22", color: "#7c3aed", fontWeight: 600 }}>{t}</span>)}
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: c ? "#7c6fb0" : "#94a3b8" }}>Reviews: {card.reviews || 0}</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => setEditCard(card.id)} style={{ background: "transparent", border: `1px solid ${c ? "#2d3555" : "#e2e8f0"}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11, color: c ? "#c4b5fd" : "#64748b" }}>Edit</button>
                    <button onClick={() => { deleteCard(card.id); toast("Deleted"); }} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 14 }}>🗑</button>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// STUDY MODE
// ══════════════════════════════════════════════════════════════════════════════
function StudyMode({ session, setSession, deck, setCards, logHistory, setPage, darkMode }) {
  const c = darkMode;
  const [flipped, setFlipped] = useState(false);
  const [mode, setMode] = useState("flip");
  const [mcqOptions, setMcqOptions] = useState(null);
  const [mcqSelected, setMcqSelected] = useState(null);
  const [showHint, setShowHint] = useState(false);

  const current = session.cards[session.index];
  const isLast = session.index === session.cards.length - 1;
  const progress = ((session.index + 1) / session.cards.length) * 100;

  const genMCQ = useCallback(async () => {
    if (!current) return;
    const otherAnswers = session.cards.filter((_, i) => i !== session.index).slice(0, 6).map(x => x.answer);
    const opts = [current.answer, ...otherAnswers.slice(0, 3)].sort(() => Math.random() - 0.5);
    setMcqOptions(opts);
    setMcqSelected(null);
  }, [current, session]);

  useEffect(() => { if (mode === "mcq") genMCQ(); }, [mode, session.index]);

  const answer = (quality) => {
    const sr = srNextInterval(current, quality);
    setCards(all => all.map(x => x.id === current.id ? { ...x, ...sr, correct: (x.correct || 0) + (quality >= 3 ? 1 : 0), incorrect: (x.incorrect || 0) + (quality < 3 ? 1 : 0) } : x));
    const newCorrect = session.correct + (quality >= 3 ? 1 : 0);
    if (isLast) {
      const accuracy = Math.round((newCorrect / session.cards.length) * 100);
      logHistory({ deckName: deck.name, deckId: deck.id, cards: session.cards.length, correct: newCorrect, accuracy });
      setSession({ ...session, done: true, accuracy });
    } else {
      setSession(s => ({ ...s, index: s.index + 1, correct: newCorrect }));
      setFlipped(false);
      setShowHint(false);
      setMcqSelected(null);
    }
  };

  if (session.done) {
    const acc = session.accuracy;
    const emoji = acc >= 80 ? "🎉" : acc >= 60 ? "👍" : "📚";
    return (
      <div className="fade-up" style={{ textAlign: "center", padding: "60px 20px" }}>
        <p style={{ fontSize: 60, margin: "0 0 16px" }}>{emoji}</p>
        <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 28, color: c ? "#e2e8f0" : "#1e1b4b" }}>Session Complete!</h2>
        <p style={{ fontSize: 16, color: c ? "#7c6fb0" : "#64748b", marginBottom: 8 }}>You studied {session.cards.length} cards</p>
        <p style={{ fontSize: 36, fontWeight: 700, color: acc >= 70 ? "#059669" : "#f59e0b", marginBottom: 28 }}>{acc}% accuracy</p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button className="btn-primary" onClick={() => { setSession({ cards: session.cards.sort(() => Math.random() - 0.5), index: 0, correct: 0 }); setFlipped(false); }}>Study Again</button>
          <button className="btn-secondary" onClick={() => setPage("decks")}>Back to Decks</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-up">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <button onClick={() => setPage("deck-detail")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: c ? "#a78bfa" : "#7c3aed" }}>←</button>
          <span style={{ fontSize: 14, color: c ? "#7c6fb0" : "#64748b", marginLeft: 8 }}>{deck.name}</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {["flip", "mcq"].map(m => (
            <button key={m} onClick={() => { setMode(m); setFlipped(false); }} style={{ padding: "7px 16px", borderRadius: 8, border: `1.5px solid ${mode === m ? "#7c3aed" : (c ? "#2d3555" : "#e2e8f0")}`, background: mode === m ? "#7c3aed" : "transparent", color: mode === m ? "white" : (c ? "#a78bfa" : "#64748b"), cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              {m === "flip" ? "Flip Card" : "MCQ Quiz"}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 13, color: c ? "#7c6fb0" : "#64748b", fontWeight: 600 }}>{session.index + 1} / {session.cards.length}</span>
      </div>

      <div style={{ background: c ? "#2d3555" : "#ede9fe", borderRadius: 8, height: 6, marginBottom: 24, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg, #7c3aed, #6d28d9)", borderRadius: 8, transition: "width 0.4s ease" }} />
      </div>

      {mode === "flip" ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div className="card-flip" onClick={() => setFlipped(f => !f)} style={{ width: "100%", maxWidth: 600, minHeight: 240, background: flipped ? (c ? "#3b2d6e" : "#4c1d95") : (c ? "#1e2235" : "white"), borderRadius: 20, padding: "40px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", border: `2px solid ${flipped ? "#7c3aed" : (c ? "#2d3555" : "#ede9fe")}`, boxShadow: "0 8px 40px rgba(124,58,237,0.12)", transition: "background 0.3s", textAlign: "center" }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: flipped ? "#c4b5fd" : (c ? "#7c6fb0" : "#94a3b8"), marginBottom: 16 }}>{flipped ? "ANSWER" : "QUESTION"}</p>
            <p style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.5, color: flipped ? "white" : (c ? "#e2e8f0" : "#1e1b4b"), margin: 0 }}>
              {flipped ? current.answer : current.question}
            </p>
            {flipped && current.keyConcept && <p style={{ fontSize: 12, color: "#c4b5fd", marginTop: 16 }}>💡 {current.keyConcept}</p>}
            {!flipped && <p style={{ fontSize: 12, color: c ? "#7c6fb0" : "#94a3b8", marginTop: 20 }}>Click to reveal answer</p>}
          </div>

          {current.hint && (
            <button onClick={() => setShowHint(h => !h)} style={{ marginTop: 12, background: "transparent", border: "1px dashed #a78bfa", borderRadius: 8, padding: "6px 16px", cursor: "pointer", fontSize: 12, color: "#7c3aed" }}>
              {showHint ? current.hint : "💡 Show Hint"}
            </button>
          )}

          {flipped && (
            <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
              {[["Again", 1, "#fee2e2", "#991b1b"], ["Hard", 2, "#fef3c7", "#92400e"], ["Good", 4, "#d1fae5", "#065f46"], ["Easy", 5, "#ede9fe", "#4c1d95"]].map(([label, q, bg, col]) => (
                <button key={label} onClick={() => answer(q)} style={{ padding: "12px 20px", borderRadius: 10, background: bg, color: col, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, transition: "all 0.2s" }}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ maxWidth: 600, margin: "0 auto" }}>
          <div style={{ background: c ? "#1e2235" : "white", borderRadius: 20, padding: "32px", marginBottom: 20, border: `1px solid ${c ? "#2d3555" : "#ede9fe"}` }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: c ? "#7c6fb0" : "#94a3b8", marginBottom: 12 }}>QUESTION</p>
            <p style={{ fontSize: 17, fontWeight: 600, color: c ? "#e2e8f0" : "#1e1b4b", margin: 0 }}>{current.question}</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {(mcqOptions || []).map((opt, i) => {
              const selected = mcqSelected === i;
              const correct = opt === current.answer;
              const showResult = mcqSelected !== null;
              return (
                <button key={i} onClick={() => { if (mcqSelected !== null) return; setMcqSelected(i); setTimeout(() => answer(correct ? 5 : 1), 800); }} style={{ padding: "14px 18px", borderRadius: 12, border: `2px solid ${showResult && selected ? (correct ? "#059669" : "#dc2626") : showResult && correct ? "#059669" : (c ? "#2d3555" : "#e2e8f0")}`, background: showResult && selected ? (correct ? "#d1fae5" : "#fee2e2") : showResult && correct ? "#d1fae5" : (c ? "#1e2235" : "white"), color: showResult && (selected || correct) ? (correct ? "#065f46" : "#991b1b") : (c ? "#e2e8f0" : "#1e1b4b"), cursor: "pointer", fontSize: 14, textAlign: "left", fontWeight: selected || (showResult && correct) ? 600 : 400, transition: "all 0.2s" }}>
                  {String.fromCharCode(65 + i)}. {opt}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// AI CHAT TUTOR
// ══════════════════════════════════════════════════════════════════════════════
function AIChat({ decks, cards, darkMode }) {
  const c = darkMode;
  const [messages, setMessages] = useState([{ role: "assistant", content: "Hi! I'm your AI study tutor. Ask me anything about your flashcard topics, get explanations, or quiz yourself. What would you like to explore today?" }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: "user", content: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const context = cards.slice(0, 30).map(c => `Q: ${c.question}\nA: ${c.answer}`).join("\n\n");
      const system = `You are an expert AI study tutor. The student has these flashcards:\n${context}\n\nHelp them understand concepts, answer questions, and quiz them. Be encouraging, clear, and educational. Keep responses concise (2-3 paragraphs max).`;
      const history = newMessages.slice(-10).map(m => ({ role: m.role, content: m.content }));
      const raw = await callClaude(history[history.length - 1].content, system);
      setMessages(m => [...m, { role: "assistant", content: raw }]);
    } catch (err) {
      setMessages(m => [...m, { role: "assistant", content: "Sorry, I had trouble connecting. Please try again." }]);
    }
    setLoading(false);
  };

  return (
    <div className="fade-up" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 56px)" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 26, fontFamily: "'Playfair Display', serif", color: c ? "#e2e8f0" : "#1e1b4b" }}>AI Study Tutor</h1>
        <p style={{ margin: 0, fontSize: 14, color: c ? "#7c6fb0" : "#64748b" }}>Powered by Claude · Ask anything about your study material</p>
      </div>
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, paddingBottom: 12, minHeight: 0 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            {m.role === "assistant" && (
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#7c3aed,#6d28d9)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0, marginRight: 10, alignSelf: "flex-start", marginTop: 4 }}>🤖</div>
            )}
            <div style={{ maxWidth: "75%", padding: "12px 16px", borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px", background: m.role === "user" ? "linear-gradient(135deg,#7c3aed,#6d28d9)" : (c ? "#1e2235" : "white"), color: m.role === "user" ? "white" : (c ? "#e2e8f0" : "#1e1b4b"), fontSize: 14, lineHeight: 1.6, border: m.role === "user" ? "none" : `1px solid ${c ? "#2d3555" : "#ede9fe"}` }}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#7c3aed,#6d28d9)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🤖</div>
            <div style={{ display: "flex", gap: 4, padding: "12px 16px", background: c ? "#1e2235" : "white", borderRadius: 18, border: `1px solid ${c ? "#2d3555" : "#ede9fe"}` }}>
              {[0, 1, 2].map(i => <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#7c3aed", animation: `bounce 1s ${i * 0.2}s infinite` }} />)}
              <style>{`@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}`}</style>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div style={{ display: "flex", gap: 10, paddingTop: 12, borderTop: `1px solid ${c ? "#2d3555" : "#ede9fe"}` }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder="Ask me anything about your study material..." style={{ flex: 1, padding: "12px 16px", borderRadius: 14, border: `1.5px solid ${c ? "#2d3555" : "#e2e8f0"}`, fontSize: 14, background: c ? "#1e2235" : "white", color: c ? "#e2e8f0" : "#1e1b4b" }} />
        <button className="btn-primary" onClick={send} disabled={loading || !input.trim()} style={{ padding: "12px 20px" }}>Send</button>
      </div>
    </div>
  );
}
