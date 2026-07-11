"use strict";

// ---- Small utilities -------------------------------------------------------

function el(tag, props, children) {
  const e = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (k === "dataset" && v) Object.assign(e.dataset, v); // dataset is read-only; assign into it
      else e[k] = v;
    }
  }
  (children || []).forEach((c) => e.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
  return e;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw Object.assign(new Error((data && data.error) || res.statusText), { status: res.status, data });
  return data;
}

let toastTimer = null;
function toast(msg, isError) {
  let t = document.querySelector(".toast");
  if (!t) { t = el("div", { className: "toast" }); document.body.appendChild(t); }
  t.className = "toast" + (isError ? " err" : "");
  t.textContent = msg;
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

function band(v, low, mid, high) { return v < 34 ? low : v < 67 ? mid : high; }

// ---- App state -------------------------------------------------------------

const state = {
  config: null,   // { ADJECTIVES, FADERS, MUTES, SOLOS, ROUTES, mode }
  user: null,
  styles: [],
  activeId: null,
  pending: [],    // pending writing samples not yet analyzed
  lastSummary: "",
};

const appEl = () => document.getElementById("app");
const activeStyle = () => state.styles.find((s) => s.id === state.activeId);

// ---- Bootstrap -------------------------------------------------------------

(async function boot() {
  // Gonemo ribbon dismiss
  const ribbon = document.getElementById("gonemoRibbon");
  const close = document.getElementById("gonemoRibbonClose");
  if (localStorage.getItem("vt_ribbon_dismissed")) ribbon.classList.add("hidden");
  close.addEventListener("click", () => {
    ribbon.classList.add("hidden");
    localStorage.setItem("vt_ribbon_dismissed", "1");
  });

  const shareMatch = location.pathname.match(/^\/s\/([^/]+)$/);
  if (shareMatch) return renderShare(decodeURIComponent(shareMatch[1]));

  try {
    state.config = await api("GET", "/api/config");
  } catch {
    appEl().innerHTML = "<div class='wrap'>Couldn't reach the server.</div>";
    return;
  }

  const resetMatch = location.pathname.match(/^\/reset\/([^/]+)$/);
  if (resetMatch) return renderReset(decodeURIComponent(resetMatch[1]));

  try {
    const me = await api("GET", "/api/auth/me");
    state.user = me.user;
    await loadStyles();
    renderApp();
  } catch {
    renderAuth();
  }
})();

// ---- Auth screen -----------------------------------------------------------

function renderAuth() {
  let tab = "login"; // login | signup | forgot
  const root = el("div", { className: "auth-screen" });

  function draw() {
    if (tab === "forgot") return drawForgot();
    root.innerHTML = `
      <div class="auth-card">
        <div class="auth-brand"><span class="power-led"></span><h1>Voice Tuner</h1></div>
        <div class="auth-sub">Find the writing voice that's actually yours</div>
        <div class="auth-tabs">
          <div class="auth-tab ${tab === "login" ? "active" : ""}" data-tab="login">Sign in</div>
          <div class="auth-tab ${tab === "signup" ? "active" : ""}" data-tab="signup">Create account</div>
        </div>
        <form id="authForm">
          <div class="field"><label>Email</label><input type="email" id="email" autocomplete="username" required></div>
          <div class="field"><label>Password</label><input type="password" id="password" autocomplete="${tab === "signup" ? "new-password" : "current-password"}" required></div>
          <div class="auth-error" id="authError"></div>
          <button class="btn-primary" type="submit">${tab === "signup" ? "Create account" : "Sign in"}</button>
        </form>
        ${tab === "login" ? '<div class="auth-hint"><a href="#" id="forgotLink">Forgot password?</a></div>' : ""}
        <div class="auth-hint">A Gonemo project · <a href="https://www.gonemo.ai" target="_blank" rel="noopener">gonemo.ai</a></div>
      </div>`;
    root.querySelectorAll(".auth-tab").forEach((t) =>
      t.addEventListener("click", () => { tab = t.dataset.tab; draw(); }));
    root.querySelector("#authForm").addEventListener("submit", onSubmit);
    const forgot = root.querySelector("#forgotLink");
    if (forgot) forgot.addEventListener("click", (e) => { e.preventDefault(); tab = "forgot"; draw(); });
  }

  function drawForgot() {
    root.innerHTML = `
      <div class="auth-card">
        <div class="auth-brand"><span class="power-led"></span><h1>Voice Tuner</h1></div>
        <div class="auth-sub">Reset your password</div>
        <form id="forgotForm">
          <div class="field"><label>Email</label><input type="email" id="email" autocomplete="username" required></div>
          <div class="auth-error" id="authError"></div>
          <button class="btn-primary" type="submit">Email me a reset link</button>
        </form>
        <div class="auth-hint"><a href="#" id="backLink">← Back to sign in</a></div>
      </div>`;
    root.querySelector("#backLink").addEventListener("click", (e) => { e.preventDefault(); tab = "login"; draw(); });
    root.querySelector("#forgotForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = root.querySelector("#email").value.trim();
      const btn = root.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        await api("POST", "/api/auth/forgot", { email });
      } catch { /* ignore — response is intentionally uniform */ }
      root.querySelector(".auth-card").innerHTML = `
        <div class="auth-brand"><span class="power-led"></span><h1>Voice Tuner</h1></div>
        <div class="auth-sub">Check your email</div>
        <p style="font-size:13.5px;color:var(--cream-dim);line-height:1.6">If an account exists for <strong>${escapeHtml(email)}</strong>, a reset link is on its way. It expires in 1 hour.</p>
        <div class="auth-hint"><a href="/">← Back to sign in</a></div>`;
    });
  }

  async function onSubmit(e) {
    e.preventDefault();
    const email = root.querySelector("#email").value.trim();
    const password = root.querySelector("#password").value;
    const errEl = root.querySelector("#authError");
    const btn = root.querySelector("button[type=submit]");
    errEl.textContent = "";
    btn.disabled = true;
    try {
      const data = await api("POST", `/api/auth/${tab}`, { email, password });
      state.user = data.user;
      await loadStyles();
      renderApp();
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false;
    }
  }

  appEl().innerHTML = "";
  appEl().appendChild(root);
  draw();
}

// Reset-password view (visited via the emailed /reset/:token link).
function renderReset(token) {
  const root = el("div", { className: "auth-screen" });
  appEl().innerHTML = "";
  appEl().appendChild(root);
  root.innerHTML = `
    <div class="auth-card">
      <div class="auth-brand"><span class="power-led"></span><h1>Voice Tuner</h1></div>
      <div class="auth-sub">Choose a new password</div>
      <form id="resetForm">
        <div class="field"><label>New password</label><input type="password" id="password" autocomplete="new-password" required></div>
        <div class="auth-error" id="authError"></div>
        <button class="btn-primary" type="submit">Set password & sign in</button>
      </form>
      <div class="auth-hint"><a href="/">← Back to sign in</a></div>
    </div>`;
  root.querySelector("#resetForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = root.querySelector("#password").value;
    const errEl = root.querySelector("#authError");
    const btn = root.querySelector("button[type=submit]");
    errEl.textContent = "";
    btn.disabled = true;
    try {
      const data = await api("POST", "/api/auth/reset", { token, password });
      state.user = data.user;
      history.replaceState(null, "", "/"); // drop the token from the URL
      await loadStyles();
      renderApp();
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false;
    }
  });
}

// ---- Load / ensure styles --------------------------------------------------

async function loadStyles() {
  const data = await api("GET", "/api/styles");
  state.styles = data.styles;
  if (state.styles.length === 0) {
    const created = await api("POST", "/api/styles", { name: "My voice" });
    state.styles = [created.style];
  }
  state.activeId = state.styles[0].id;
}

// ---- Main app shell --------------------------------------------------------

function renderApp() {
  state.pending = [];
  state.lastSummary = "";
  const root = el("div", { className: "wrap" });
  root.appendChild(renderDeck());
  root.appendChild(renderStyleBar());
  root.appendChild(renderConsole());
  const cardWrap = el("div", { id: "card-wrap" });
  cardWrap.appendChild(el("div", { className: "card", id: "card" }));
  root.appendChild(cardWrap);
  appEl().innerHTML = "";
  appEl().appendChild(root);
}

function renderDeck() {
  const deck = el("header", { className: "deck" });
  const left = el("div");
  left.innerHTML = `<div class="brand"><span class="power-led"></span><h1>Voice Tuner</h1></div>
    <div class="subtitle">Dial in your writing voice</div>`;
  const right = el("div", { className: "deck-right" });
  const mode = state.config.mode;
  right.innerHTML = `<span class="mode-pill ${mode}">${mode === "live" ? "Live · Claude" : "Demo mode"}</span>
    <span class="user-email">${escapeHtml(state.user.email)}</span>`;
  const logout = el("button", { className: "link-btn", textContent: "Sign out" });
  logout.addEventListener("click", async () => {
    await api("POST", "/api/auth/logout");
    state.user = null; state.styles = []; state.activeId = null;
    renderAuth();
  });
  right.appendChild(logout);
  deck.appendChild(left);
  deck.appendChild(right);
  return deck;
}

function renderStyleBar() {
  const bar = el("div", { className: "style-bar" });
  state.styles.forEach((s) => {
    const tab = el("div", { className: "style-tab" + (s.id === state.activeId ? " active" : "") });
    tab.appendChild(el("span", { className: "tab-led" }));
    tab.appendChild(el("span", { textContent: s.name }));
    tab.addEventListener("click", () => {
      if (s.id === state.activeId) return;
      state.activeId = s.id;
      state.pending = []; state.lastSummary = "";
      renderApp();
    });
    bar.appendChild(tab);
  });
  const add = el("button", { className: "style-add", textContent: "+ New style" });
  add.addEventListener("click", async () => {
    const name = prompt("Name this style (e.g. Professional, Personal):", "");
    if (name === null) return;
    const created = await api("POST", "/api/styles", { name: name.trim() || "Untitled style" });
    state.styles.unshift(created.style);
    state.activeId = created.style.id;
    renderApp();
  });
  bar.appendChild(add);
  return bar;
}

// ---- Console ---------------------------------------------------------------

let saveTimer = null;
function scheduleSave() {
  const status = document.getElementById("saveStatus");
  if (status) status.textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const s = activeStyle();
    try {
      await api("PUT", `/api/styles/${s.id}`, { name: s.name, state: s.state });
      if (document.getElementById("saveStatus")) document.getElementById("saveStatus").textContent = "Saved";
    } catch {
      if (document.getElementById("saveStatus")) document.getElementById("saveStatus").textContent = "Save failed";
    }
  }, 600);
}

function renderConsole() {
  const s = activeStyle();
  const st = s.state;
  const console_ = el("div", { className: "console" });

  // Plain-language explainer for first-timers (dismissible).
  console_.appendChild(renderIntro());

  // Guided, top-to-bottom: learn → who you are → the board → do's/don'ts → words.
  console_.appendChild(renderIngest());   // Step 1
  console_.appendChild(renderPersona());  // Step 2
  console_.appendChild(renderBoard());    // Step 3 — the board (screen + levels + switches)
  console_.appendChild(renderMatrix());   // Step 4
  console_.appendChild(renderWords());    // Step 5

  // Engage row
  const engage = el("div", { className: "engage-wrap" });
  const printBtn = el("button", { className: "engage-btn", textContent: "Print voice guide" });
  printBtn.addEventListener("click", buildCard);
  const shareBtn = el("button", { className: "engage-btn ghost", textContent: s.shareId ? "Sharing on — copy link" : "Share this voice" });
  shareBtn.addEventListener("click", toggleShare);
  engage.appendChild(printBtn);
  engage.appendChild(shareBtn);
  console_.appendChild(engage);
  console_.appendChild(el("div", { className: "engage-note", id: "engageNote",
    textContent: engageNoteText(st) }));

  return console_;
}

// The console's "screen": the style name on a spinning record, mid-recording.
function renderScreen(name) {
  const screen = el("div", { className: "rec-screen" });
  screen.innerHTML = `
    <div class="rec-disc"><div class="rec-grooves"></div><div class="rec-spindle"></div></div>
    <div class="rec-readout">
      <div class="rec-meta"><span class="rec-dot"></span><span>REC · TONE OF VOICE</span></div>
      <div class="rec-title" id="recTitle"></div>
      <div class="rec-sub">now laying down the master</div>
      <div class="rec-vu">${"<span></span>".repeat(9)}</div>
    </div>`;
  screen.querySelector("#recTitle").textContent = name || "Untitled voice";
  return screen;
}

function updateScreenTitle(name) {
  const t = document.getElementById("recTitle");
  if (t) t.textContent = name || "Untitled voice";
}

// Dismissible plain-language intro — what a tone of voice is and the 3 steps.
function renderIntro() {
  const wrap = el("div", { className: "intro-card" });
  if (localStorage.getItem("vt_intro_dismissed")) wrap.classList.add("hidden");
  wrap.innerHTML = `
    <button class="intro-close" type="button" aria-label="Dismiss">×</button>
    <div class="intro-title">New here? Tone of voice, in 20 seconds.</div>
    <p class="intro-lead">Your <strong>tone of voice</strong> is simply how your brand sounds when it writes — friendly or formal, playful or serious, chatty or precise. Pin it down once and every email, post and page (and every AI tool you use) can sound like <em>you</em>.</p>
    <div class="intro-steps">
      <div class="intro-step"><span class="istep-n">1</span><div><strong>Feed it a sample.</strong> Paste something you've already written and we'll set the dials for you. No sample? Just set them yourself.</div></div>
      <div class="intro-step"><span class="istep-n">2</span><div><strong>Adjust the board.</strong> Slide the dials and flip the switches until it sounds right. Unsure? The middle is a safe default.</div></div>
      <div class="intro-step"><span class="istep-n">3</span><div><strong>Print or share.</strong> Out comes a one-page guide your team — and your tools — can follow.</div></div>
    </div>`;
  wrap.querySelector(".intro-close").addEventListener("click", () => {
    wrap.classList.add("hidden");
    localStorage.setItem("vt_intro_dismissed", "1");
  });
  return wrap;
}

// The board — the console's single physical unit. One chassis holds the LED
// screen, the editable name, the level faders and the style-rule switches.
function renderBoard() {
  const s = activeStyle();
  const mod = el("section", { className: "module" });
  mod.innerHTML = `<div class="module-label">Step 3 · How you sound</div>
    <div class="module-hint">This is your board. Slide the faders and flip the switches until it sounds like you — or paste a sample in Step 1 and we'll set it for you.</div>`;
  const board = el("section", { className: "board" });

  const brand = el("div", { className: "board-brand" });
  brand.innerHTML = `<span class="board-screw"></span><span>VOICE BOARD · GONEMO</span><span class="board-screw"></span>`;
  board.appendChild(brand);

  const face = el("div", { className: "board-face" });
  face.appendChild(renderScreen(s.name));
  const nameRow = el("div", { className: "name-row" });
  const nameField = el("div", { className: "name-field" });
  nameField.appendChild(el("label", { textContent: "Style name" }));
  const nameInput = el("input", { className: "style-name-input", value: s.name, type: "text" });
  nameInput.addEventListener("input", () => {
    s.name = nameInput.value; renderStyleBarNames(); updateScreenTitle(nameInput.value); scheduleSave();
  });
  nameField.appendChild(nameInput);
  nameRow.appendChild(nameField);
  nameRow.appendChild(el("span", { className: "save-status", id: "saveStatus", textContent: "Saved" }));
  face.appendChild(nameRow);
  board.appendChild(face);

  board.appendChild(renderLevels());
  board.appendChild(renderSwitchBank());
  mod.appendChild(board);
  return mod;
}

// Level faders (the four tone dimensions) — a recessed well on the board.
function renderLevels() {
  const well = el("div", { className: "board-well" });
  well.appendChild(el("div", { className: "well-label", textContent: "Levels — how you sound" }));
  well.appendChild(el("div", { className: "well-hint", textContent: "Slide each fader toward the word that fits your brand. Not sure? Leave it near the middle." }));
  const bank = el("div", { className: "fader-bank" });
  const st = activeStyle().state;
  state.config.DIMENSIONS.forEach((f) => {
    const options = f.options;
    const maxIdx = options.length - 1;
    const curIdx = dimIndex(f.key, st.dimensions[f.key]);
    const wrap = el("div", { className: "fader" });
    wrap.style.setProperty("--accent", DIM_ACCENTS[f.key] || "#38BDF8");

    const scribble = el("div", { className: "scribble" });
    scribble.innerHTML = f.label.replace("\n", "<br>");
    wrap.appendChild(scribble);

    const body = el("div", { className: "fader-body" });
    const trackWrap = el("div", { className: "fader-track-wrap" });
    const ticks = el("div", { className: "fader-ticks" });
    for (let i = 0; i < options.length; i++) ticks.appendChild(el("span", { className: "tick" }));
    trackWrap.appendChild(ticks);
    const input = el("input", { type: "range", min: 0, max: maxIdx, step: 1, value: curIdx, className: "vslider" });
    input.dataset.key = f.key;
    trackWrap.appendChild(input);
    body.appendChild(trackWrap);
    body.appendChild(buildMeter());
    wrap.appendChild(body);

    const valEl = el("div", { className: "fader-value", textContent: options[curIdx] });
    input.addEventListener("input", () => {
      const idx = Number(input.value);
      activeStyle().state.dimensions[f.key] = options[idx];
      valEl.textContent = options[idx];
      updateMeter(wrap, maxIdx ? (idx / maxIdx) * 100 : 0);
      scheduleSave();
    });
    wrap.appendChild(valEl);

    const bottom = el("div", { className: "fader-bottom-label" });
    bottom.innerHTML = escapeHtml(f.lowHint) + " &nbsp;—&nbsp; " + escapeHtml(f.highHint);
    wrap.appendChild(bottom);

    bank.appendChild(wrap);
    updateMeter(wrap, maxIdx ? (curIdx / maxIdx) * 100 : 0);
  });
  well.appendChild(bank);
  return well;
}

function renderStyleBarNames() {
  const bar = document.querySelector(".style-bar");
  if (!bar) return;
  const tabs = bar.querySelectorAll(".style-tab");
  tabs.forEach((tab, i) => {
    const s = state.styles[i];
    if (s) tab.querySelector("span:last-child").textContent = s.name;
  });
}

// ---- Ingest panel ----------------------------------------------------------

function renderIngest() {
  let tab = "paste";
  const mod = el("section", { className: "module" });
  mod.innerHTML = `<div class="module-label">Step 1 · Learn from your writing</div>
    <div class="module-hint">Paste a few things you've already written (or upload files / add links) and ${state.config.mode === "live" ? "Claude" : "the offline analyzer"} sets every dial below for you. No sample handy? Skip this and set them yourself.</div>`;
  const box = el("div", { className: "ingest" });

  const tabs = el("div", { className: "ingest-tabs" });
  ["paste", "upload", "url"].forEach((t) => {
    const b = el("div", { className: "ingest-tab" + (t === tab ? " active" : ""), textContent: t === "paste" ? "Paste text" : t === "upload" ? "Upload files" : "Add URL", dataset: { t } });
    b.addEventListener("click", () => { tab = t; drawInput(); tabs.querySelectorAll(".ingest-tab").forEach((x) => x.classList.toggle("active", x.dataset.t === t)); });
    tabs.appendChild(b);
  });
  box.appendChild(tabs);

  const inputArea = el("div", { id: "ingestInput" });
  box.appendChild(inputArea);

  const pendingList = el("ul", { className: "pending-list", id: "pendingList" });
  box.appendChild(pendingList);

  const actions = el("div", { className: "ingest-actions" });
  const analyzeBtn = el("button", { className: "analyze-btn", id: "analyzeBtn", textContent: "Analyze & set console" });
  analyzeBtn.addEventListener("click", runAnalyze);
  actions.appendChild(analyzeBtn);
  actions.appendChild(el("span", { className: "ingest-note", id: "ingestNote", textContent: "Add at least one sample." }));
  box.appendChild(actions);

  const summary = el("div", { className: "analysis-summary", id: "analysisSummary", style: "display:none" });
  box.appendChild(summary);

  mod.appendChild(box);

  function drawInput() {
    inputArea.innerHTML = "";
    if (tab === "paste") {
      const ta = el("textarea", { placeholder: "Paste a few paragraphs you've written…" });
      const add = el("button", { className: "engage-btn ghost", textContent: "Add sample", style: "margin-top:10px;font-size:11px;padding:8px 16px" });
      add.addEventListener("click", () => {
        const text = ta.value.trim();
        if (text.length < 40) return toast("Paste a bit more text (at least a sentence or two).", true);
        state.pending.push({ type: "text", label: "Pasted text", content: text });
        ta.value = ""; drawPending();
      });
      inputArea.appendChild(ta);
      inputArea.appendChild(add);
    } else if (tab === "url") {
      const row = el("div", { style: "display:flex;gap:8px" });
      const inp = el("input", { type: "url", placeholder: "https://yourblog.com/a-post-you-wrote" });
      const add = el("button", { className: "engage-btn ghost", textContent: "Add", style: "font-size:11px;padding:8px 16px;white-space:nowrap" });
      const addUrl = () => {
        const url = inp.value.trim();
        if (!url) return;
        state.pending.push({ type: "url", label: url, url });
        inp.value = ""; drawPending();
      };
      add.addEventListener("click", addUrl);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addUrl(); } });
      row.appendChild(inp); row.appendChild(add);
      inputArea.appendChild(row);
    } else {
      const drop = el("div", { className: "filedrop", textContent: "Click to choose files (.pdf, .docx, .txt, .md, .html), or drop them here" });
      const file = el("input", { type: "file", accept: ".pdf,.docx,.txt,.md,.markdown,.html,.htm,text/*", multiple: true, style: "display:none" });
      drop.addEventListener("click", () => file.click());
      file.addEventListener("change", () => handleFiles(file.files));
      drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
      drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("drag"); handleFiles(e.dataTransfer.files); });
      inputArea.appendChild(drop);
      inputArea.appendChild(file);
    }
  }

  function handleFiles(files) {
    Array.from(files).forEach((f) => {
      if (f.size > 8_000_000) return toast(`${f.name} is too large (max 8 MB).`, true);
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      const reader = new FileReader();
      if (ext === "pdf" || ext === "docx") {
        // Binary: send to the server as base64 for extraction.
        reader.onload = () => {
          const b64 = String(reader.result || "").split(",")[1] || "";
          if (!b64) return toast(`Couldn't read ${f.name}.`, true);
          state.pending.push({ type: "file", label: f.name, filename: f.name, dataBase64: b64, size: f.size });
          drawPending();
        };
        reader.readAsDataURL(f);
      } else {
        reader.onload = () => {
          const content = String(reader.result || "").trim();
          if (content.length < 40) return toast(`${f.name} has too little text.`, true);
          state.pending.push({ type: "file", label: f.name, content });
          drawPending();
        };
        reader.readAsText(f);
      }
    });
  }

  drawInput();
  return mod;
}

function drawPending() {
  const list = document.getElementById("pendingList");
  const note = document.getElementById("ingestNote");
  if (!list) return;
  list.innerHTML = "";
  state.pending.forEach((p, i) => {
    const li = el("li", { className: "pending-item" });
    li.appendChild(el("span", { className: "ptype", textContent: p.type }));
    li.appendChild(el("span", { textContent: p.label.length > 60 ? p.label.slice(0, 60) + "…" : p.label }));
    const metaText = p.content ? `${p.content.length.toLocaleString()} chars`
      : p.dataBase64 ? `${Math.round((p.size || 0) / 1024).toLocaleString()} KB`
      : "URL";
    const meta = el("span", { className: "pmeta", textContent: metaText });
    li.appendChild(meta);
    const rm = el("button", { className: "premove", textContent: "×" });
    rm.addEventListener("click", () => { state.pending.splice(i, 1); drawPending(); });
    li.appendChild(rm);
    list.appendChild(li);
  });
  if (note) note.textContent = state.pending.length ? `${state.pending.length} sample${state.pending.length > 1 ? "s" : ""} ready.` : "Add at least one sample.";
}

async function runAnalyze() {
  if (state.pending.length === 0) return toast("Add a writing sample first.", true);
  const btn = document.getElementById("analyzeBtn");
  const note = document.getElementById("ingestNote");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Analyzing…';
  try {
    const s = activeStyle();
    const data = await api("POST", `/api/styles/${s.id}/analyze`, { samples: state.pending });
    applyAnalysis(data.analysis);
    s.sources = data.sources;
    state.pending = [];
    state.lastSummary = data.analysis.summary || "";
    scheduleSave();
    toast(data.mode === "live" ? "Console set by Claude." : "Console set (offline estimate).");
  } catch (err) {
    toast(err.message || "Analysis failed.", true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Analyze & set console";
    drawPending();
    const sum = document.getElementById("analysisSummary");
    if (sum && state.lastSummary) { sum.style.display = "block"; sum.textContent = state.lastSummary; }
    if (note) note.textContent = "Add at least one sample.";
  }
}

// Replace a console module's DOM in place (used after an analysis fills fields).
function refreshModule(name, fn) {
  const cur = document.querySelector(`[data-mod="${name}"]`);
  if (cur) cur.replaceWith(fn());
}

function applyAnalysis(a) {
  const st = activeStyle().state;
  st.persona = {
    archetype: a.persona.archetype || st.persona.archetype,
    audience: a.persona.audience || st.persona.audience,
    mission: a.persona.mission || st.persona.mission,
    values: a.persona.values && a.persona.values.length ? a.persona.values.slice(0, 3) : st.persona.values,
  };
  st.dimensions = { ...st.dimensions, ...a.dimensions };
  if (a.matrix && a.matrix.length) st.matrix = a.matrix.slice(0, 3);
  st.vocab = { ...st.vocab, ...a.vocab };
  // Text modules re-render outright; the dimension faders animate to their new
  // settings so the change reads on the console.
  refreshModule("persona", renderPersona);
  refreshModule("matrix", renderMatrix);
  refreshModule("words", renderWords);
  refreshModule("switches", renderSwitchBank);
  state.config.DIMENSIONS.forEach((d) => animateDimension(d.key, dimIndex(d.key, st.dimensions[d.key])));
  updateEngageNote();
}

function dimDef(key) {
  return state.config.DIMENSIONS.find((d) => d.key === key);
}

function dimIndex(key, value) {
  const def = dimDef(key);
  const i = def ? def.options.indexOf(value) : -1;
  return i < 0 ? 0 : i;
}

function animateDimension(key, targetIndex) {
  const input = document.querySelector(`input.vslider[data-key="${key}"]`);
  if (!input) return;
  const fader = input.closest(".fader");
  const def = dimDef(key);
  const maxIdx = def ? def.options.length - 1 : 1;
  const start = Number(input.value);
  const t0 = performance.now();
  const dur = 550;
  function step(now) {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    const v = start + (targetIndex - start) * eased;
    input.value = v;
    const idx = Math.round(v);
    const valEl = fader.querySelector(".fader-value");
    if (valEl && def) valEl.textContent = def.options[idx];
    updateMeter(fader, maxIdx ? (v / maxIdx) * 100 : 0);
    if (p < 1) requestAnimationFrame(step);
    else input.value = targetIndex; // land exactly on the detent
  }
  requestAnimationFrame(step);
}

// ---- 1. Brand persona (master section) -------------------------------------

const DIM_ACCENTS = { humor: "#F472B6", formality: "#FBBF24", respectfulness: "#38BDF8", enthusiasm: "#46E08A" };
const DIM_NAMES = { humor: "Humor", formality: "Formality", respectfulness: "Respectfulness", enthusiasm: "Enthusiasm" };
const DIM_ORDER = ["humor", "formality", "respectfulness", "enthusiasm"];

function engageNoteText(st) {
  const p = st.persona;
  if (!p.archetype || !p.audience) return "Tip: name your archetype and audience up top — or analyze a sample to auto-fill the whole guide.";
  return "Ready — your tone-of-voice guide is built from every field above.";
}

function updateEngageNote() {
  const note = document.getElementById("engageNote");
  if (note) note.textContent = engageNoteText(activeStyle().state);
}

function suggestChips(items, onPick) {
  const row = el("div", { className: "suggest-row" });
  (items || []).forEach((v) => {
    const c = el("button", { className: "suggest-chip", textContent: v, type: "button" });
    c.addEventListener("click", () => onPick(v));
    row.appendChild(c);
  });
  return row;
}

// Reusable tag input: current values + optional suggestions, capped at `max`.
function tagInput(values, suggestions, max, onChange) {
  const wrap = el("div", { className: "tag-input" });
  const chips = el("div", { className: "tag-chips" });
  const input = el("input", { type: "text", className: "tag-entry" });
  const suggestRow = el("div", { className: "suggest-row" });
  const vals = values.slice();

  function drawSuggest() {
    suggestRow.innerHTML = "";
    if (vals.length >= max) return;
    (suggestions || [])
      .filter((s) => !vals.some((v) => v.toLowerCase() === s.toLowerCase()))
      .slice(0, 8)
      .forEach((s) => {
        const c = el("button", { className: "suggest-chip", textContent: s, type: "button" });
        c.addEventListener("click", () => add(s));
        suggestRow.appendChild(c);
      });
  }
  function draw() {
    chips.innerHTML = "";
    vals.forEach((v, i) => {
      const chip = el("span", { className: "tag-chip" });
      chip.appendChild(el("span", { textContent: v }));
      const x = el("button", { className: "tag-x", textContent: "×", type: "button" });
      x.addEventListener("click", () => { vals.splice(i, 1); commit(); });
      chip.appendChild(x);
      chips.appendChild(chip);
    });
    input.disabled = vals.length >= max;
    input.placeholder = vals.length >= max ? `Max ${max} reached` : "Type and press Enter…";
    drawSuggest();
  }
  function commit() { onChange(vals.slice()); draw(); }
  function add(v) {
    v = (v || "").trim();
    if (!v || vals.length >= max || vals.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    vals.push(v); commit();
  }
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); add(input.value); input.value = ""; }
  });

  wrap.appendChild(chips);
  wrap.appendChild(input);
  wrap.appendChild(suggestRow);
  draw();
  return wrap;
}

function renderPersona() {
  const mod = el("section", { className: "module", dataset: { mod: "persona" } });
  const p = activeStyle().state.persona;
  mod.innerHTML = `<div class="module-label">Step 2 · Who you are</div>
    <div class="module-hint">Say who your brand is and who it's for, in plain words. This one line anchors everything else.</div>`;
  const grid = el("div", { className: "persona-grid" });

  const archField = el("div", { className: "persona-field" });
  archField.appendChild(el("label", { textContent: "Who we are — archetype" }));
  const arch = el("input", { type: "text", value: p.archetype, placeholder: "e.g. Trusted Guide" });
  arch.addEventListener("input", () => { activeStyle().state.persona.archetype = arch.value; updateEngageNote(); scheduleSave(); });
  archField.appendChild(arch);
  archField.appendChild(suggestChips(state.config.ARCHETYPES, (v) => {
    arch.value = v; activeStyle().state.persona.archetype = v; updateEngageNote(); scheduleSave();
  }));
  grid.appendChild(archField);

  const audField = el("div", { className: "persona-field" });
  audField.appendChild(el("label", { textContent: "…for (target audience)" }));
  const aud = el("input", { type: "text", value: p.audience, placeholder: "e.g. early-stage founders" });
  aud.addEventListener("input", () => { activeStyle().state.persona.audience = aud.value; updateEngageNote(); scheduleSave(); });
  audField.appendChild(aud);
  grid.appendChild(audField);

  const misField = el("div", { className: "persona-field wide" });
  misField.appendChild(el("label", { textContent: "Our mission" }));
  const mis = el("textarea", { value: p.mission, placeholder: "We help [audience] [primary benefit] by [how you do it]." });
  mis.addEventListener("input", () => { activeStyle().state.persona.mission = mis.value; scheduleSave(); });
  misField.appendChild(mis);
  grid.appendChild(misField);

  const valField = el("div", { className: "persona-field wide" });
  valField.appendChild(el("label", { textContent: "Core values (up to 3)" }));
  valField.appendChild(tagInput(p.values, state.config.VALUE_POOL, 3, (vals) => {
    activeStyle().state.persona.values = vals; scheduleSave();
  }));
  grid.appendChild(valField);

  mod.appendChild(grid);
  return mod;
}

// ---- 2. The 4 dimensions of tone (channel strips) --------------------------

const METER_SEGS = 14;

function buildMeter() {
  const meter = el("div", { className: "led-meter" });
  for (let i = 0; i < METER_SEGS; i++) {
    const fromBottom = METER_SEGS - 1 - i; // DOM top→bottom, so invert
    const cls = fromBottom >= METER_SEGS - 2 ? "r" : fromBottom >= METER_SEGS - 5 ? "a" : "g";
    meter.appendChild(el("div", { className: `seg ${cls}` }));
  }
  return meter;
}

function updateMeter(fader, pct) {
  const segs = fader.querySelectorAll(".seg");
  const lit = Math.round((pct / 100) * segs.length);
  segs.forEach((s, i) => s.classList.toggle("on", segs.length - 1 - i < lit));
}

// ---- Tone of voice matrix --------------------------------------------------

function renderMatrix() {
  const mod = el("section", { className: "module", dataset: { mod: "matrix" } });
  const st = activeStyle().state;
  mod.innerHTML = `<div class="module-label">Step 4 · Your do's and don'ts</div>
    <div class="module-hint">Pick a few words that describe you. For each, jot what it means — plus a quick example of what to write and what to avoid. Optional, but it makes the guide much clearer.</div>`;

  const scroll = el("div", { className: "matrix-scroll" });
  const table = el("div", { className: "matrix-table" });
  const header = el("div", { className: "matrix-row head" });
  ["Trait", "We are…", "We are NOT…", "Do write", "Don't write", ""].forEach((h) =>
    header.appendChild(el("div", { className: "matrix-cell", textContent: h })));
  table.appendChild(header);
  st.matrix.forEach((row, i) => table.appendChild(matrixRow(row, i)));
  if (st.matrix.length === 0) {
    table.appendChild(el("div", { className: "matrix-empty", textContent: "No traits yet — add one below, or analyze a sample." }));
  }
  scroll.appendChild(table);
  mod.appendChild(scroll);

  if (st.matrix.length < 3) {
    const seed = state.config.TRAIT_POOL.filter((t) => !st.matrix.some((r) => r.trait.toLowerCase() === t.toLowerCase()));
    mod.appendChild(suggestChips(seed.slice(0, 8), (v) => {
      if (st.matrix.length >= 3) return;
      st.matrix.push({ trait: v, weAre: "", weAreNot: "", doEx: "", dontEx: "" });
      refreshModule("matrix", renderMatrix); scheduleSave();
    }));
  }

  const add = el("button", { className: "engage-btn ghost small", textContent: "+ Add blank trait", type: "button" });
  add.disabled = st.matrix.length >= 3;
  add.addEventListener("click", () => {
    if (st.matrix.length >= 3) return;
    st.matrix.push({ trait: "", weAre: "", weAreNot: "", doEx: "", dontEx: "" });
    refreshModule("matrix", renderMatrix); scheduleSave();
  });
  mod.appendChild(add);
  return mod;
}

function matrixRow(row, i) {
  const rowEl = el("div", { className: "matrix-row" });
  const fields = [["trait", "Trait"], ["weAre", "Clear and direct."], ["weAreNot", "Arrogant."], ["doEx", "We can help you scale."], ["dontEx", "We're the only ones who matter."]];
  fields.forEach(([key, ph]) => {
    const cell = el("div", { className: "matrix-cell" });
    const inp = el(key === "trait" ? "input" : "textarea", { value: row[key], placeholder: ph });
    inp.addEventListener("input", () => { activeStyle().state.matrix[i][key] = inp.value; scheduleSave(); });
    cell.appendChild(inp);
    rowEl.appendChild(cell);
  });
  const rmCell = el("div", { className: "matrix-cell rm" });
  const rm = el("button", { className: "tag-x", textContent: "×", type: "button" });
  rm.addEventListener("click", () => { activeStyle().state.matrix.splice(i, 1); refreshModule("matrix", renderMatrix); scheduleSave(); });
  rmCell.appendChild(rm);
  rowEl.appendChild(rmCell);
  return rowEl;
}

// ---- Style-rule switches (on the board) ------------------------------------

function renderSwitchBank() {
  const v = activeStyle().state.vocab;
  const g = state.config.GRAMMAR;
  const well = el("div", { className: "board-well switches", dataset: { mod: "switches" } });
  well.appendChild(el("div", { className: "well-label", textContent: "Style rules — flip to taste" }));
  const row = el("div", { className: "switch-row" });
  row.appendChild(boardSwitch("Contractions", g.contractions, v.contractions, "don't vs. do not", (x) => { activeStyle().state.vocab.contractions = x; scheduleSave(); }));
  row.appendChild(boardSwitch("Emojis", g.emojis, v.emojis, "how often", (x) => { activeStyle().state.vocab.emojis = x; scheduleSave(); }));
  row.appendChild(boardSwitch("Exclamation marks", g.exclamations, v.exclamations, "energy", (x) => { activeStyle().state.vocab.exclamations = x; scheduleSave(); }));
  row.appendChild(boardSwitch("Casing", g.casing, v.casing, "Standard vs. loose", (x) => { activeStyle().state.vocab.casing = x; scheduleSave(); }));
  well.appendChild(row);
  return well;
}

// ---- Words we love / avoid (a step module) ---------------------------------

function renderWords() {
  const mod = el("section", { className: "module", dataset: { mod: "words" } });
  const v = activeStyle().state.vocab;
  mod.innerHTML = `<div class="module-label">Step 5 · Words you love &amp; avoid</div>
    <div class="module-hint">Words and phrases your brand reaches for — and ones to keep out.</div>`;
  const grid = el("div", { className: "vocab-grid" });
  const love = el("div", { className: "vocab-field" });
  love.appendChild(el("div", { className: "vocab-head love", textContent: "Words we love" }));
  love.appendChild(tagInput(v.love, [], 6, (x) => { activeStyle().state.vocab.love = x; scheduleSave(); }));
  grid.appendChild(love);

  const avoid = el("div", { className: "vocab-field" });
  avoid.appendChild(el("div", { className: "vocab-head avoid", textContent: "Words we avoid" }));
  avoid.appendChild(tagInput(v.avoid, [], 6, (x) => { activeStyle().state.vocab.avoid = x; scheduleSave(); }));
  grid.appendChild(avoid);
  mod.appendChild(grid);
  return mod;
}

// A physical-looking slide switch with 2–3 named positions.
function boardSwitch(label, options, current, help, onChange) {
  const wrap = el("div", { className: "switch-field" });
  wrap.appendChild(el("div", { className: "switch-label", textContent: label }));
  const track = el("div", { className: "switch-track" });
  const knob = el("div", { className: "switch-knob" });
  knob.style.setProperty("--n", options.length);
  track.appendChild(knob);
  wrap.appendChild(track);
  const scale = el("div", { className: "switch-scale" });

  function setPos(idx, fire) {
    knob.style.setProperty("--pos", idx);
    track.classList.toggle("lit", idx > 0);
    scale.querySelectorAll("span").forEach((s, i) => s.classList.toggle("active", i === idx));
    if (fire) onChange(options[idx]);
  }
  options.forEach((o, i) => {
    const s = el("span", { textContent: o });
    s.addEventListener("click", () => setPos(i, true));
    scale.appendChild(s);
  });
  wrap.appendChild(scale);
  if (help) wrap.appendChild(el("div", { className: "switch-help", textContent: help }));

  // Clicking the switch body advances to the next position (feels like a flick).
  track.addEventListener("click", () => {
    const cur = scale.querySelector("span.active");
    const curIdx = cur ? [...scale.children].indexOf(cur) : 0;
    setPos((curIdx + 1) % options.length, true);
  });

  setPos(Math.max(0, options.indexOf(current)), false);
  return wrap;
}

// ---- Output: Brand Tone of Voice Guide -------------------------------------

function personaLine(p) {
  if (p.archetype && p.audience) return `We are the ${p.archetype} for ${p.audience}.`;
  if (p.archetype) return `We are the ${p.archetype}.`;
  if (p.audience) return `We speak to ${p.audience}.`;
  return "";
}

function dimListHtml(st) {
  return DIM_ORDER.map((k) => `<li><span>${DIM_NAMES[k]}</span><strong>${escapeHtml(st.dimensions[k])}</strong></li>`).join("");
}

function guideHtml(name, st) {
  const p = st.persona;
  let h = `<div class="card-eyebrow">Brand Tone of Voice Guide</div><h2>${escapeHtml(name)}</h2>`;
  const who = personaLine(p);
  if (who || p.mission || p.values.length) {
    h += `<h3>1 · Brand persona</h3>`;
    if (who) h += `<p><strong>Who we are —</strong> ${escapeHtml(who)}</p>`;
    if (p.mission) h += `<p><strong>Our mission —</strong> ${escapeHtml(p.mission)}</p>`;
    if (p.values.length) h += `<p><strong>Core values —</strong> ${p.values.map(escapeHtml).join(" · ")}</p>`;
  }
  h += `<h3>2 · The 4 dimensions of tone</h3><ul class="dim-list">${dimListHtml(st)}</ul>`;
  const rows = st.matrix.filter((r) => r.trait);
  if (rows.length) {
    h += `<h3>3 · Tone of voice matrix</h3><div class="matrix-out"><table><thead><tr><th>Trait</th><th>We are…</th><th>We are NOT…</th><th>Do write</th><th>Don't write</th></tr></thead><tbody>`;
    rows.forEach((r) => h += `<tr><td><strong>${escapeHtml(r.trait)}</strong></td><td>${escapeHtml(r.weAre)}</td><td>${escapeHtml(r.weAreNot)}</td><td>${escapeHtml(r.doEx)}</td><td>${escapeHtml(r.dontEx)}</td></tr>`);
    h += `</tbody></table></div>`;
  }
  const v = st.vocab;
  h += `<h3>4 · Vocabulary & style rules</h3><ul>`;
  if (v.love.length) h += `<li><strong>Words we love —</strong> ${v.love.map(escapeHtml).join(", ")}</li>`;
  if (v.avoid.length) h += `<li><strong>Words we avoid —</strong> ${v.avoid.map(escapeHtml).join(", ")}</li>`;
  h += `<li><strong>Contractions —</strong> ${escapeHtml(v.contractions)}</li>`;
  h += `<li><strong>Emojis —</strong> ${escapeHtml(v.emojis)}</li>`;
  h += `<li><strong>Exclamation marks —</strong> ${escapeHtml(v.exclamations)}</li>`;
  h += `<li><strong>Casing —</strong> ${escapeHtml(v.casing)}</li></ul>`;
  return h;
}

function cardHtml(name, st, opts) {
  const p = st.persona;
  let h = `<div class="card-eyebrow">Voice Card${opts && opts.date ? " — " + escapeHtml(opts.date) : ""}</div><h2>${escapeHtml(name)}</h2>`;
  const who = personaLine(p);
  if (who) h += `<div class="thesis">${escapeHtml(who)}</div>`;
  else if (p.values.length) h += `<div class="thesis">${p.values.map(escapeHtml).join(" · ")}</div>`;
  h += `<h3>How we sound</h3><ul class="dim-list">${dimListHtml(st)}</ul>`;
  const v = st.vocab;
  if (v.avoid.length) h += `<h3>Words we avoid</h3><p>${v.avoid.map(escapeHtml).join(", ")}</p>`;
  if (v.love.length) h += `<h3>Words we love</h3><p>${v.love.map(escapeHtml).join(", ")}</p>`;
  return h;
}

function guideText(name, st) {
  const p = st.persona;
  let t = `# ${name} — Brand Tone of Voice Guide\n\n`;
  t += `## 1. Brand Persona\n`;
  const who = personaLine(p);
  if (who) t += `- Who We Are: ${who}\n`;
  if (p.mission) t += `- Our Mission: ${p.mission}\n`;
  if (p.values.length) t += `- Core Values: ${p.values.join(", ")}\n`;
  t += `\n## 2. The 4 Dimensions of Tone\n`;
  DIM_ORDER.forEach((k) => t += `- ${DIM_NAMES[k]}: ${st.dimensions[k]}\n`);
  const rows = st.matrix.filter((r) => r.trait);
  if (rows.length) {
    t += `\n## 3. Tone of Voice Matrix\n`;
    t += `| Trait | We Are… | We Are NOT… | Do write | Don't write |\n|---|---|---|---|---|\n`;
    rows.forEach((r) => t += `| ${r.trait} | ${r.weAre} | ${r.weAreNot} | ${r.doEx} | ${r.dontEx} |\n`);
  }
  const v = st.vocab;
  t += `\n## 4. Vocabulary & Style Rules\n`;
  if (v.love.length) t += `- Words We Love: ${v.love.join(", ")}\n`;
  if (v.avoid.length) t += `- Words We Avoid: ${v.avoid.join(", ")}\n`;
  t += `- Contractions: ${v.contractions}\n- Emojis: ${v.emojis}\n- Exclamation marks: ${v.exclamations}\n- Casing: ${v.casing}\n`;
  t += `\n— Made with Voice Tuner by Gonemo · https://www.gonemo.ai\n`;
  return t;
}

function cardText(name, st) {
  const p = st.persona;
  let t = `# ${name} — Voice Card\n\n`;
  const who = personaLine(p);
  if (who) t += `${who}\n\n`;
  t += `## How we sound\n`;
  DIM_ORDER.forEach((k) => t += `- ${DIM_NAMES[k]}: ${st.dimensions[k]}\n`);
  const v = st.vocab;
  if (v.love.length) t += `\n## Words we love\n${v.love.join(", ")}\n`;
  if (v.avoid.length) t += `\n## Words we avoid\n${v.avoid.join(", ")}\n`;
  t += `\n— Made with Voice Tuner by Gonemo · https://www.gonemo.ai\n`;
  return t;
}

function outputHtml(name, st, format) {
  return format === "guide" ? guideHtml(name, st) : cardHtml(name, st, { date: "printed " + new Date().toLocaleDateString() });
}

function outputText(name, st, format) {
  return format === "guide" ? guideText(name, st) : cardText(name, st);
}

function formatToggle(current, onChange) {
  const wrap = el("div", { className: "fmt-toggle" });
  [["guide", "Full guide"], ["card", "Voice card"]].forEach(([val, label]) => {
    const b = el("button", { className: "fmt-opt" + (val === current ? " active" : ""), textContent: label });
    b.addEventListener("click", () => onChange(val));
    wrap.appendChild(b);
  });
  return wrap;
}

let cardFormat = "guide";

function buildCard() {
  const s = activeStyle();
  const name = s.name.trim() || "This voice";
  const card = document.getElementById("card");

  function render() {
    let html = `<div class="fmt-toggle-slot"></div>`;
    html += outputHtml(name, s.state, cardFormat);
    html += `<div class="card-actions">
      <button id="copyBtn">Copy as text</button>
      <button id="downloadBtn" class="secondary">Download .md</button>
      <button id="shareCardBtn" class="secondary">${s.shareId ? "Copy share link" : "Share"}</button>
      <span class="status" id="cardStatus"></span></div>`;
    html += `<div class="card-gonemo"><span>Made with <strong>Voice Tuner</strong> by Gonemo</span><a href="https://www.gonemo.ai" target="_blank" rel="noopener">www.gonemo.ai →</a></div>`;
    card.innerHTML = html;
    card.querySelector(".fmt-toggle-slot").appendChild(
      formatToggle(cardFormat, (f) => { cardFormat = f; render(); }));

    const text = outputText(name, s.state, cardFormat);
    const suffix = cardFormat === "guide" ? "tone-of-voice-guide" : "voice-card";
    document.getElementById("copyBtn").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(text); setCardStatus("Copied."); }
      catch { setCardStatus("Couldn't copy — select manually."); }
    });
    document.getElementById("downloadBtn").addEventListener("click", () => {
      const blob = new Blob([text], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = el("a", { href: url, download: `${name.replace(/\s+/g, "-").toLowerCase()}-${suffix}.md` });
      a.click(); URL.revokeObjectURL(url);
    });
    document.getElementById("shareCardBtn").addEventListener("click", toggleShare);
  }

  render();
  card.classList.add("show");
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setCardStatus(msg) {
  const s = document.getElementById("cardStatus");
  if (s) s.textContent = msg;
}

// ---- Share -----------------------------------------------------------------

async function toggleShare() {
  const s = activeStyle();
  try {
    if (s.shareId) {
      const url = `${location.origin}/s/${s.shareId}`;
      await navigator.clipboard.writeText(url).catch(() => {});
      toast("Share link copied.");
      return;
    }
    const data = await api("POST", `/api/styles/${s.id}/share`, { enabled: true });
    s.shareId = data.shareId;
    await navigator.clipboard.writeText(data.url).catch(() => {});
    toast("Sharing on — link copied.");
    renderApp();
  } catch (err) {
    toast(err.message || "Couldn't share.", true);
  }
}

// ---- Public share view -----------------------------------------------------

async function renderShare(shareId) {
  document.getElementById("gonemoRibbon").classList.add("hidden");
  const root = el("div", { className: "share-view" });
  appEl().innerHTML = "";
  appEl().appendChild(root);
  try {
    const data = await api("GET", `/api/share/${encodeURIComponent(shareId)}`);
    const st = data.style.state;
    root.innerHTML = `<a class="share-back" href="/">← Voice Tuner</a>`;
    const card = el("div", { className: "card static" });
    let fmt = "guide";
    const gonemo = `<div class="card-gonemo"><span>Made with <strong>Voice Tuner</strong> by Gonemo — build your own voice free.</span><a href="https://www.gonemo.ai" target="_blank" rel="noopener">www.gonemo.ai →</a></div>`;
    function draw() {
      const body = fmt === "guide" ? guideHtml(data.style.name, st) : cardHtml(data.style.name, st, { date: "shared" });
      card.innerHTML = `<div class="fmt-toggle-slot"></div>` + body + gonemo;
      card.querySelector(".fmt-toggle-slot").appendChild(formatToggle(fmt, (f) => { fmt = f; draw(); }));
    }
    draw();
    root.appendChild(card);
  } catch {
    root.innerHTML = `<a class="share-back" href="/">← Voice Tuner</a><div class="card static"><h2>Not found</h2><p>This shared voice guide isn't available — the link may have been turned off.</p></div>`;
  }
}
