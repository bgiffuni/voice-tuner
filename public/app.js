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
  let tab = "login";
  const root = el("div", { className: "auth-screen" });

  function draw() {
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
        <div class="auth-hint">A Gonemo project · <a href="https://www.gonemo.ai" target="_blank" rel="noopener">gonemo.ai</a></div>
      </div>`;
    root.querySelectorAll(".auth-tab").forEach((t) =>
      t.addEventListener("click", () => { tab = t.dataset.tab; draw(); }));
    root.querySelector("#authForm").addEventListener("submit", onSubmit);
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

  // Head: editable name + save status
  const head = el("div", { className: "console-head" });
  const nameInput = el("input", { className: "style-name-input", value: s.name, type: "text" });
  nameInput.addEventListener("input", () => { s.name = nameInput.value; renderStyleBarNames(); scheduleSave(); });
  head.appendChild(nameInput);
  head.appendChild(el("span", { className: "save-status", id: "saveStatus", textContent: "Saved" }));
  console_.appendChild(head);

  console_.appendChild(renderIngest());
  console_.appendChild(renderIdentity());
  console_.appendChild(renderFaders());
  console_.appendChild(renderToggles());
  console_.appendChild(renderRouting());

  // Engage row
  const engage = el("div", { className: "engage-wrap" });
  const printBtn = el("button", { className: "engage-btn", textContent: "Print voice card" });
  printBtn.addEventListener("click", buildCard);
  const shareBtn = el("button", { className: "engage-btn ghost", textContent: s.shareId ? "Sharing on — copy link" : "Share this style" });
  shareBtn.addEventListener("click", toggleShare);
  engage.appendChild(printBtn);
  engage.appendChild(shareBtn);
  console_.appendChild(engage);
  console_.appendChild(el("div", { className: "engage-note", id: "engageNote",
    textContent: st.adjectives.length < 3 ? `Tip: pick 3 identity words (${st.adjectives.length}/3), or analyze a sample to auto-fill.` : "Ready — this card is built from every dial above." }));

  return console_;
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
  mod.innerHTML = `<div class="module-label">Auto-tune — learn from your writing</div>
    <div class="module-hint">Paste text, upload files, or add URLs of things you've written. ${state.config.mode === "live" ? "Claude" : "The offline analyzer"} sets the console from them.</div>`;
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
      const drop = el("div", { className: "filedrop", textContent: "Click to choose text files (.txt, .md, .html), or drop them here" });
      const file = el("input", { type: "file", accept: ".txt,.md,.markdown,.html,.htm,text/*", multiple: true, style: "display:none" });
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
      if (f.size > 2_000_000) return toast(`${f.name} is too large (max 2 MB).`, true);
      const reader = new FileReader();
      reader.onload = () => {
        const content = String(reader.result || "").trim();
        if (content.length < 40) return toast(`${f.name} has too little text.`, true);
        state.pending.push({ type: "file", label: f.name, content });
        drawPending();
      };
      reader.readAsText(f);
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
    const meta = el("span", { className: "pmeta", textContent: p.content ? `${p.content.length.toLocaleString()} chars` : "URL" });
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

function applyAnalysis(a) {
  const st = activeStyle().state;
  st.adjectives = a.adjectives.slice(0, 3);
  st.mutes = a.mutes.slice();
  st.solos = a.solos.slice();
  animateFader("tech", a.tech);
  animateFader("wit", a.wit);
  animateFader("formality", a.formality);
  animateFader("pace", a.pace);
  st.tech = a.tech; st.wit = a.wit; st.formality = a.formality; st.pace = a.pace;
  // Refresh the affected controls in place.
  refreshIdentity();
  refreshToggles();
  updateEngageNote();
}

function animateFader(key, target) {
  const input = document.querySelector(`input.vslider[data-key="${key}"]`);
  if (!input) return;
  const start = Number(input.value);
  const t0 = performance.now();
  const dur = 550;
  function step(now) {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    const v = Math.round(start + (target - start) * eased);
    input.value = v;
    const valEl = input.closest(".fader").querySelector(".fader-value");
    if (valEl) valEl.textContent = v;
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ---- Identity chips --------------------------------------------------------

function renderIdentity() {
  const mod = el("section", { className: "module" });
  mod.innerHTML = `<div class="module-label">Ch.1 — Core identity</div>
    <div class="module-hint">Pick exactly 3 words that describe how you sound at your best.</div>`;
  const row = el("div", { className: "chip-row", id: "adjRow" });
  state.config.ADJECTIVES.forEach((word) => {
    const chip = el("div", { className: "chip", textContent: word });
    chip.addEventListener("click", () => {
      const st = activeStyle().state;
      const i = st.adjectives.indexOf(word);
      if (i > -1) st.adjectives.splice(i, 1);
      else if (st.adjectives.length < 3) st.adjectives.push(word);
      refreshIdentity(); updateEngageNote(); scheduleSave();
    });
    row.appendChild(chip);
  });
  mod.appendChild(row);
  return mod;
}

function refreshIdentity() {
  const row = document.getElementById("adjRow");
  if (!row) return;
  const st = activeStyle().state;
  [...row.children].forEach((chip) => {
    const active = st.adjectives.includes(chip.textContent);
    chip.classList.toggle("active", active);
    chip.classList.toggle("disabled", !active && st.adjectives.length >= 3);
  });
}

// ---- Faders ----------------------------------------------------------------

function renderFaders() {
  const mod = el("section", { className: "module" });
  mod.innerHTML = `<div class="module-label">Ch.2 — Channel strips</div>
    <div class="module-hint">Set each dial where your voice actually sits — not where you wish it sat.</div>`;
  const bank = el("div", { className: "fader-bank" });
  const st = activeStyle().state;
  state.config.FADERS.forEach((f) => {
    const wrap = el("div", { className: "fader" });
    wrap.appendChild(el("div", { className: "fader-top-label", textContent: f.label.replace("\n", " ") }));
    const trackWrap = el("div", { className: "fader-track-wrap" });
    const input = el("input", { type: "range", min: 0, max: 100, value: st[f.key], className: "vslider" });
    input.dataset.key = f.key;
    const valEl = el("div", { className: "fader-value", textContent: st[f.key] });
    input.addEventListener("input", () => {
      st[f.key] = Number(input.value);
      valEl.textContent = input.value;
      scheduleSave();
    });
    trackWrap.appendChild(input);
    wrap.appendChild(trackWrap);
    wrap.appendChild(valEl);
    const bottom = el("div", { className: "fader-bottom-label" });
    bottom.innerHTML = f.low.replace("\n", "<br>") + " &nbsp;—&nbsp; " + f.high.replace("\n", "<br>");
    wrap.appendChild(bottom);
    bank.appendChild(wrap);
  });
  mod.appendChild(bank);
  return mod;
}

// ---- Mute / Solo toggles ---------------------------------------------------

function renderToggles() {
  const mod = el("section", { className: "module" });
  const grid = el("div", { className: "toggle-grid" });
  grid.appendChild(toggleColumn("Mute — never do this", state.config.MUTES, "mute", "mutes", "muteList"));
  grid.appendChild(toggleColumn("Solo — known for this", state.config.SOLOS, "solo", "solos", "soloList"));
  mod.appendChild(grid);
  return mod;
}

function toggleColumn(labelText, items, type, key, listId) {
  const col = el("div");
  col.appendChild(el("div", { className: "module-label", textContent: labelText }));
  const list = el("div", { className: "toggle-list", id: listId });
  const st = activeStyle().state;
  items.forEach((item) => {
    const btn = el("button", { className: `toggle-btn ${type}` + (st[key].includes(item.key) ? " active" : "") });
    btn.dataset.key = item.key;
    btn.appendChild(el("span", { className: "led" }));
    btn.appendChild(el("span", { textContent: item.label }));
    btn.addEventListener("click", () => {
      const arr = activeStyle().state[key];
      const i = arr.indexOf(item.key);
      if (i > -1) arr.splice(i, 1); else arr.push(item.key);
      btn.classList.toggle("active");
      scheduleSave();
    });
    list.appendChild(btn);
  });
  col.appendChild(list);
  return col;
}

function refreshToggles() {
  const st = activeStyle().state;
  document.querySelectorAll("#muteList .toggle-btn").forEach((b) =>
    b.classList.toggle("active", st.mutes.includes(b.dataset.key)));
  document.querySelectorAll("#soloList .toggle-btn").forEach((b) =>
    b.classList.toggle("active", st.solos.includes(b.dataset.key)));
}

// ---- Routing ---------------------------------------------------------------

function renderRouting() {
  const mod = el("section", { className: "module" });
  mod.innerHTML = `<div class="module-label">Routing — where this voice plays</div>`;
  const row = el("div", { className: "routing-row" });
  const st = activeStyle().state;
  state.config.ROUTES.forEach((r) => {
    const chip = el("div", { className: "route-chip" + (st.routes.includes(r) ? " active" : ""), textContent: r });
    chip.addEventListener("click", () => {
      const arr = activeStyle().state.routes;
      const i = arr.indexOf(r);
      if (i > -1) arr.splice(i, 1); else arr.push(r);
      chip.classList.toggle("active");
      scheduleSave();
    });
    row.appendChild(chip);
  });
  mod.appendChild(row);
  return mod;
}

function updateEngageNote() {
  const note = document.getElementById("engageNote");
  if (!note) return;
  const st = activeStyle().state;
  note.textContent = st.adjectives.length < 3
    ? `Tip: pick 3 identity words (${st.adjectives.length}/3), or analyze a sample to auto-fill.`
    : "Ready — this card is built from every dial above.";
}

// ---- Voice card ------------------------------------------------------------

function describe(st) {
  return {
    tech: band(st.tech,
      "Always plain language — every technical term gets translated or cut, no exceptions.",
      "Plain by default, technical when the reader can actually handle it.",
      "Full technical depth — assumes an informed reader and doesn't slow down to explain basics."),
    wit: band(st.wit,
      "Straightforward. Say the thing plainly — no flourishes, no reaching for a clever angle.",
      "A little wit, mostly through framing and analogy, used sparingly rather than as a running bit.",
      "Playful and bold — humor, sharp reframes, and unexpected comparisons are part of how this voice argues."),
    formality: band(st.formality,
      "Casual — like talking to a colleague, not presenting to one.",
      "Professional but approachable — polished without turning stiff.",
      "Formal and polished — measured, precise, deliberately buttoned-up."),
    pace: band(st.pace,
      "Detailed and thorough — takes the space an idea actually needs to land.",
      "Balanced — as long as it needs to be, and not one sentence longer.",
      "Tight and concise — every sentence earns its place, nothing extra survives a second pass."),
  };
}

// Build the card HTML for a given style state. All dynamic strings escaped.
function cardHtml(name, st, cfg, opts) {
  const d = describe(st);
  const muteMap = Object.fromEntries(cfg.MUTES.map((m) => [m.key, m.text]));
  const soloMap = Object.fromEntries(cfg.SOLOS.map((s) => [s.key, s.text]));
  let html = "";
  html += `<div class="card-eyebrow">Voice Card${opts && opts.date ? " — " + escapeHtml(opts.date) : ""}</div>`;
  html += `<h2>${escapeHtml(name)}</h2>`;
  if (st.adjectives.length) html += `<div class="thesis">${st.adjectives.map(escapeHtml).join(" · ")}</div>`;
  html += `<h3>Calibration</h3><ul>`;
  html += `<li><strong>Technical depth —</strong> ${escapeHtml(d.tech)}</li>`;
  html += `<li><strong>Wit —</strong> ${escapeHtml(d.wit)}</li>`;
  html += `<li><strong>Formality —</strong> ${escapeHtml(d.formality)}</li>`;
  html += `<li><strong>Pace —</strong> ${escapeHtml(d.pace)}</li></ul>`;
  if (st.mutes.length) {
    html += `<h3>Non-negotiables — never do this</h3><ul>`;
    st.mutes.forEach((k) => { if (muteMap[k]) html += `<li>${escapeHtml(muteMap[k])}</li>`; });
    html += `</ul>`;
  }
  if (st.solos.length) {
    html += `<h3>What this voice is known for</h3><ul>`;
    st.solos.forEach((k) => { if (soloMap[k]) html += `<li>${escapeHtml(soloMap[k])}</li>`; });
    html += `</ul>`;
  }
  if (st.routes.length) {
    html += `<h3>Where this voice plays</h3><ul>`;
    st.routes.forEach((r) => html += `<li>${escapeHtml(r)}</li>`);
    html += `</ul>`;
  }
  return html;
}

function plainText(name, st, cfg) {
  const d = describe(st);
  const muteMap = Object.fromEntries(cfg.MUTES.map((m) => [m.key, m.text]));
  const soloMap = Object.fromEntries(cfg.SOLOS.map((s) => [s.key, s.text]));
  let t = `# ${name} — Voice Card\n\n`;
  if (st.adjectives.length) t += `**Core identity:** ${st.adjectives.join(", ")}\n\n`;
  t += `## Calibration\n`;
  t += `- Technical depth: ${d.tech}\n- Wit: ${d.wit}\n- Formality: ${d.formality}\n- Pace: ${d.pace}\n\n`;
  if (st.mutes.length) { t += `## Non-negotiables — never do this\n`; st.mutes.forEach((k) => muteMap[k] && (t += `- ${muteMap[k]}\n`)); t += `\n`; }
  if (st.solos.length) { t += `## What this voice is known for\n`; st.solos.forEach((k) => soloMap[k] && (t += `- ${soloMap[k]}\n`)); t += `\n`; }
  if (st.routes.length) { t += `## Where this voice plays\n`; st.routes.forEach((r) => t += `- ${r}\n`); t += `\n`; }
  t += `\n— Made with Voice Tuner by Gonemo · https://www.gonemo.ai\n`;
  return t;
}

function buildCard() {
  const s = activeStyle();
  const name = s.name.trim() || "This voice";
  const card = document.getElementById("card");
  let html = cardHtml(name, s.state, state.config, { date: "printed " + new Date().toLocaleDateString() });
  html += `<div class="card-actions">
    <button id="copyBtn">Copy as text</button>
    <button id="downloadBtn" class="secondary">Download .md</button>
    <button id="shareCardBtn" class="secondary">${s.shareId ? "Copy share link" : "Share"}</button>
    <span class="status" id="cardStatus"></span></div>`;
  html += `<div class="card-gonemo"><span>Made with <strong>Voice Tuner</strong> by Gonemo</span><a href="https://www.gonemo.ai" target="_blank" rel="noopener">www.gonemo.ai →</a></div>`;
  card.innerHTML = html;
  card.classList.add("show");
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });

  const text = plainText(name, s.state, state.config);
  document.getElementById("copyBtn").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(text); setCardStatus("Copied."); }
    catch { setCardStatus("Couldn't copy — select manually."); }
  });
  document.getElementById("downloadBtn").addEventListener("click", () => {
    const blob = new Blob([text], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: `${name.replace(/\s+/g, "-").toLowerCase()}-voice-card.md` });
    a.click(); URL.revokeObjectURL(url);
  });
  document.getElementById("shareCardBtn").addEventListener("click", toggleShare);
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
    const cfg = { MUTES: data.MUTES, SOLOS: data.SOLOS };
    const st = data.style.state;
    root.innerHTML = `<a class="share-back" href="/">← Voice Tuner</a>`;
    const card = el("div", { className: "card static" });
    card.innerHTML = cardHtml(data.style.name, st, cfg, { date: "shared" }) +
      `<div class="card-gonemo"><span>Made with <strong>Voice Tuner</strong> by Gonemo — build your own voice card free.</span><a href="https://www.gonemo.ai" target="_blank" rel="noopener">www.gonemo.ai →</a></div>`;
    root.appendChild(card);
  } catch {
    root.innerHTML = `<a class="share-back" href="/">← Voice Tuner</a><div class="card static"><h2>Not found</h2><p>This shared voice card isn't available — the link may have been turned off.</p></div>`;
  }
}
