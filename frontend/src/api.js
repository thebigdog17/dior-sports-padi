// src/api.js  — all calls to the Go backend
import { auth } from "./firebase";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:8080";

async function headers(withAuth = false) {
  const h = { "Content-Type": "application/json" };
  if (withAuth && auth.currentUser) {
    const token = await auth.currentUser.getIdToken();
    h["Authorization"] = "Bearer " + token;
  }
  return h;
}

async function get(path, auth = false) {
  const r = await fetch(BASE + path, { headers: await headers(auth) });
  if (!r.ok) throw new Error((await r.json()).error || r.statusText);
  return r.json();
}

async function post(path, body, needAuth = false) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: await headers(needAuth),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json()).error || r.statusText);
  return r.json();
}

// ── Scores ──────────────────────────────────────────────────────
export const getScores     = (date)   => get(`/api/scores?date=${date}`);
export const getLiveScores = ()        => get("/api/scores/live");
export const getFixture    = (id)     => get(`/api/scores/fixture/${id}`);
export const getStandings  = (league) => get(`/api/standings?league=${league}&season=2024`);

// ── AI ──────────────────────────────────────────────────────────
export const askAI = (prompt, markets, date) =>
  post("/api/ai", { prompt, markets, date });

// ── Auth / Profile ──────────────────────────────────────────────
export const saveProfile = (name)    => post("/api/auth/profile", { name }, true);
export const getProfile  = ()        => get("/api/auth/me", true);

// ── Tickets ─────────────────────────────────────────────────────
export const saveTicket = (ticket)   => post("/api/tickets", ticket, true);
export const getTickets = ()         => get("/api/tickets", true);
