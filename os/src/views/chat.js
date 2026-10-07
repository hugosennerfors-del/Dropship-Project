// The research chat.

import { store, row } from "../state.js";
import { esc, attr, icon, md, money, pct, scoreChip } from "../ui/dom.js";
import { ask, session, resetChat, ERROR_COPY } from "../chat/engine.js";
import { MARKETS } from "../core/markets.js";
import { plink } from "./shared.js";

let busy = null; // AbortController while answering
const KEY = "planvy-intel-chat";

function load() {
  if (session.messages.length) return;
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (s && Array.isArray(s.messages)) { session.messages = s.messages.slice(-40); session.turns = s.turns?.slice(-12) || []; session.lastResultIds = s.last || []; }
  } catch { /* convenience only */ }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ messages: session.messages.slice(-40), turns: session.turns.slice(-12), last: session.lastResultIds })); } catch { /* ignore */ }
}

const SUGGESTIONS = [
  "Show products with margin > 60, price < £80, competition < 40, trend > 70 and brandability > 60",
  "Which products have high margin and low competition?",
  "Find products that cost under £30 and sell for at least £60",
  "Emerging products with strong TikTok potential",
  "Which products have the best long-term brand potential?",
  "Which product would you choose with a £2,000 budget?",
];

function stepText(t) {
  const mk = MARKETS[t.market]?.code || t.market;
  switch (t.kind) {
    case "query": return `${t.within ? "Filtered the previous list" : `Searched ${mk} products`}${t.applied?.length ? `: ${t.applied.join(", ")}` : ""}${t.budget ? `, launch budget £${t.budget}` : ""} · ${t.sort || "opportunity"} → ${t.total} result${t.total === 1 ? "" : "s"}`;
    case "product": return `Read the full analysis of ${t.id} (${mk})`;
    case "compare": return `Compared ${t.ids.join(", ")} (${mk})`;
    case "economics": return `Calculated unit economics for ${t.id}${t.overrides?.length ? ` with ${t.overrides.join(", ")} changed` : ""}`;
    case "niches": return `Grouped ${mk} products by ${t.by}`;
    default: return t.kind;
  }
}

function msgHTML(msg) {
  if (msg.role === "user") return `<div class="msg user"><div class="bubble">${esc(msg.text)}</div></div>`;
  const link = (id) => plink(id);
  return `<div class="msg" data-msg="${attr(msg.id)}">
    <div class="who">${icon(msg.mode === "claude" ? "spark" : "data", 13)} ${msg.mode === "claude" ? "Claude, using the database" : "Answered from the database"}</div>
    ${msg.trace?.length ? `<div class="steps">${msg.trace.map((t) => `<div class="step">${icon("search", 12)}<span>${esc(stepText(t))}</span></div>`).join("")}</div>` : ""}
    <div class="prose" data-body>${msg.pending && !msg.text ? '<span class="thinking"><i></i><i></i><i></i>&nbsp;Thinking</span>' : md(msg.text, link)}</div>
    ${msg.note ? `<div class="callout">${icon("info", 16)}<span>${esc(msg.note)}</span></div>` : ""}
    ${msg.truncated ? '<p class="xs muted">The answer was cut short. Ask for less at a time.</p>' : ""}
  </div>`;
}

function sidePanel() {
  const m = store.market;
  const ids = session.lastResultIds;
  const rs = ids.map((id) => row(id, m)).filter(Boolean);
  return `<div class="stack" style="gap:6px"><h3>In focus</h3><p class="xs muted">Follow-ups like “number 2” or “which one is the safest?” refer to this list.</p></div>
    ${rs.length ? `<div class="list" style="border:1px solid var(--border);border-radius:var(--r-md)">${rs.map((r, i) => `<a class="li" href="#/p/${attr(r.id)}" style="padding:9px 12px"><span class="rank">${i + 1}</span><span class="body"><b style="font-size:13px">${esc(r.name.split(/:\s/)[0])}</b><small>${pct(r.margin, 0)} margin · ${money(r.profit, r.currency)}/order · risk ${r.risk}</small></span>${scoreChip(r.opportunity)}</a>`).join("")}</div>`
      : '<div class="empty" style="border:1px dashed var(--border);border-radius:var(--r-md)">Ask a question to start a list.</div>'}
    <div class="stack" style="gap:6px;margin-top:6px"><h3>How answers are made</h3>
      <p class="xs muted">${store.sampleState === "ready" ? (store.tools ? "Claude queries the database through page tools and cites products from the results. Every number comes from the database." : "The page runs the query, and Claude writes the explanation from the rows it found.")
        : "Claude is not connected here, so the page parses your question and answers from the same query engine Discover uses."}</p>
      <p class="xs muted">Market: ${esc(MARKETS[m].name)}. Write “in Sweden” or “in the UK” to switch for one question.</p></div>
    <button class="btn sm" data-act="reset" style="justify-self:start">${icon("plus", 13)}New conversation</button>`;
}

export function render() {
  load();
  const empty = !session.messages.length;
  return {
    title: "Ask",
    full: true,
    html: `<div class="chat">
      <div class="chat-main">
        <div class="chat-log" id="log">
          ${empty ? `<div class="msg" style="margin-top:6vh;gap:16px">
            <h1 style="font-size:24px">Ask the product database</h1>
            <p class="muted">Filter, rank and explain products in plain English or Swedish. Then ask follow-up questions about the results.</p>
            <div class="suggest">${SUGGESTIONS.map((s) => `<button data-suggest="${attr(s)}">${esc(s)}</button>`).join("")}</div>
          </div>` : session.messages.map(msgHTML).join("")}
        </div>
        <div class="composer">
          <form id="chatForm">
            <label for="q" class="sr">Your question</label>
            <textarea id="q" rows="1" placeholder="Ask about products, margins, niches… (Enter to send)"></textarea>
            ${busy ? `<button class="btn" type="button" data-act="stop" title="Stop">${icon("stop", 15)}</button>` : `<button class="btn primary" type="submit" title="Send">${icon("send", 15)}</button>`}
          </form>
          <div class="hint"><span>${store.sampleState === "ready" ? "Answers by Claude from the live database." : "Answers from the database (Claude not connected)."}</span><span>Market: ${esc(MARKETS[store.market].name)}</span></div>
        </div>
      </div>
      <aside class="chat-side" id="side">${sidePanel()}</aside>
    </div>`,
  };
}

export function mount(root, { rerender: rerender0 }) {
  const log = () => root.querySelector("#log");
  const scroll = () => { const l = log(); if (l) l.scrollTop = l.scrollHeight; };
  const rerender = () => { rerender0(); scroll(); if (!busy) root.querySelector("#q")?.focus({ preventScroll: true }); };
  requestAnimationFrame(scroll);
  root.addEventListener("input", (e) => {
    if (e.target.id !== "q") return;
    const q = e.target;
    q.style.height = "auto"; q.style.height = Math.min(180, q.scrollHeight) + "px";
  });
  root.addEventListener("keydown", (e) => {
    if (e.target.id === "q" && e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); root.querySelector("#chatForm").requestSubmit(); }
  });

  async function send(text) {
    if (!text.trim() || busy) return;
    session.messages.push({ role: "user", text });
    const msg = { id: "m" + Date.now(), role: "assistant", text: "", pending: true, trace: [], mode: store.sampleState === "ready" ? "claude" : "local" };
    session.messages.push(msg);
    busy = new AbortController();
    rerender();
    const body = () => root.querySelector(`[data-msg="${msg.id}"] [data-body]`);
    const paintTrace = () => {
      const el = root.querySelector(`[data-msg="${msg.id}"]`);
      if (el) el.outerHTML = msgHTML(msg);
      scroll();
    };
    try {
      const res = await ask(text, {
        market: store.market, signal: busy.signal,
        onText: ({ text: t }) => { msg.text = t; const b = body(); if (b) { b.innerHTML = md(t, (id) => plink(id)); scroll(); } },
        onTrace: (tr) => { msg.trace = tr; paintTrace(); },
      });
      msg.text = res.text; msg.trace = res.trace || msg.trace; msg.mode = res.mode; msg.truncated = res.truncated;
      if (res.error) msg.note = ERROR_COPY[res.error] || ERROR_COPY.upstream_error;
    } catch (e) {
      if (e?.code === "cancelled") { msg.text = msg.text || e.text || "Stopped."; }
      else { msg.text = msg.text || "Something went wrong while answering."; }
    }
    msg.pending = false;
    busy = null;
    save();
    rerender();
  }

  root.addEventListener("submit", (e) => {
    if (e.target.id !== "chatForm") return;
    e.preventDefault();
    const q = root.querySelector("#q");
    const t = q.value;
    q.value = "";
    send(t);
  });
  root.addEventListener("click", (e) => {
    const s = e.target.closest("[data-suggest]");
    if (s) { send(s.dataset.suggest); return; }
    if (e.target.closest("[data-act=stop]")) { busy?.abort(); return; }
    if (e.target.closest("[data-act=reset]")) { resetChat(); save(); rerender(); }
  });
  if (!busy) root.querySelector("#q")?.focus({ preventScroll: true });
}
