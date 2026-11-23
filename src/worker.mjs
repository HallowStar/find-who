import { ASSETS } from "./assets.mjs";
import { PROMPTS, TEAMS } from "./game-data.mjs";

const PAGES_ORIGIN = "https://hallowstar.github.io";
const PLAYER_COOKIE = "findwho_player";
const OWNER_COOKIE = "findwho_owner_bookmark";
const OWNER_TTL = 30 * 24 * 60 * 60;
const encoder = new TextEncoder();
const PLAYER_TTL = 30 * 24 * 60 * 60;
const groupIds = new Set(TEAMS.map(({ id }) => id));

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
};

const ownerHeaders = {
  ...securityHeaders,
  "Cache-Control": "private, no-store",
  "Content-Type": "text/html; charset=utf-8",
  "X-Robots-Tag": "noindex, nofollow",
};

function json(value, status = 200, headers = {}) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers },
  });
}

const fail = (error, status) => json({ error }, status);

function getCookie(request, name) {
  const prefix = name + "=";
  const part = (request.headers.get("Cookie") || "").split(";").map((piece) => piece.trim())
    .find((piece) => piece.startsWith(prefix));
  return part?.slice(prefix.length);
}

function cookie(request, name, value, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure}`;
}

function fitName(value) {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/gu, " ");
  return name.length >= 1 && name.length <= 70 && !/[\u0000-\u001F\u007F]/u.test(name) ? name : null;
}

async function readFields(request) {
  try {
    if (!request.headers.get("Content-Type")?.startsWith("application/json")) return {};
    const body = await request.text();
    if (body.length > 2048) return {};
    const fields = JSON.parse(body);
    return fields && typeof fields === "object" ? fields : {};
  } catch {
    return {};
  }
}

function writeAllowed(request) {
  const origin = request.headers.get("Origin");
  if (origin === PAGES_ORIGIN) return true;
  return request.headers.get("Sec-Fetch-Site") !== "cross-site" &&
    (!origin || origin === new URL(request.url).origin);
}

async function currentPlayer(request, db) {
  const id = request.headers.get("Origin") === PAGES_ORIGIN
    ? request.headers.get("Authorization")?.match(/^Bearer ([0-9a-f-]{36})$/)?.[1]
    : getCookie(request, PLAYER_COOKIE);
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return null;
  return db.prepare("SELECT id, name, team FROM players WHERE id = ?").bind(id).first();
}

const playerView = ({ name, team }) => ({ name, team });

async function loadPlayer(request, db) {
  const player = await currentPlayer(request, db);
  if (!player) return json({ player: null, answers: [] });
  const { results } = await db.prepare(
    "SELECT prompt_id, match_name, match_team FROM answers WHERE player_id = ? ORDER BY prompt_id",
  ).bind(player.id).all();
  return json({ player: playerView(player), answers: results });
}

async function join(request, db) {
  const existing = await currentPlayer(request, db);
  if (existing) return loadPlayer(request, db);

  const { name: rawName, team } = await readFields(request);
  const name = fitName(rawName);
  if (!name || !groupIds.has(team)) return fail("Enter your name and choose a group.", 400);
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO players (id, name, team, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, name, team, Date.now()).run();
  if (request.headers.get("Origin") === PAGES_ORIGIN) {
    return json({ player: { name, team }, answers: [], token: id }, 201);
  }
  return json({ player: { name, team }, answers: [] }, 201, {
    "Set-Cookie": cookie(request, PLAYER_COOKIE, id, PLAYER_TTL),
  });
}

async function saveAnswer(request, db, promptId) {
  const player = await currentPlayer(request, db);
  if (!player) return fail("Your player session expired. Reload the game and join again.", 401);
  const { name: rawName, team } = await readFields(request);
  const name = fitName(rawName);
  if (!name || !groupIds.has(team)) return fail("Enter their name and choose their group.", 400);
  await db.prepare(`
    INSERT INTO answers (player_id, prompt_id, match_name, match_team, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (player_id, prompt_id) DO UPDATE
    SET match_name = excluded.match_name, match_team = excluded.match_team, updated_at = excluded.updated_at
  `).bind(player.id, promptId, name, team, Date.now()).run();
  return json({ answer: { prompt_id: promptId, match_name: name, match_team: team } });
}

async function scores(db) {
  const { results } = await db.prepare(`
    SELECT p.id, p.name, p.team, a.prompt_id, a.match_name, a.match_team
    FROM players p LEFT JOIN answers a ON a.player_id = p.id
    ORDER BY p.created_at, p.id, a.prompt_id
  `).all();
  const players = new Map();
  const teams = Object.fromEntries(TEAMS.map(({ id }) => [id, { players: 0, answers: 0, points: 0 }]));
  for (const { id, name, team, prompt_id, match_name, match_team } of results) {
    const totals = teams[team];
    if (!players.has(id)) {
      players.set(id, { name, team, points: 0, answers: [] });
      totals.players++;
    }
    if (prompt_id == null) continue;
    const entry = players.get(id);
    const points = team === match_team ? 1 : 2;
    entry.points += points;
    entry.answers.push({ prompt_id, match_name, match_team, points });
    totals.points += points;
    totals.answers++;
  }
  const ranked = Array.from(players.values()).sort((first, second) =>
    second.points - first.points || first.name.localeCompare(second.name));
  return { teams, players: ranked };
}

const teamName = (id) => TEAMS.find((team) => team.id === id).name;
const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

function renderOwner({ teams, players }) {
  const totals = TEAMS.map(({ id, icon, name }) => {
    const { points, players: count, answers } = teams[id];
    return `<div class="summary team-${id}">
      <h2><span aria-hidden="true">${icon}</span> ${name}</h2>
      <strong>${points.toLocaleString("en-SG")} pts</strong>
      <p>${count} ${count === 1 ? "player" : "players"} · ${answers} logged</p>
    </div>`;
  }).join("");
  const rows = players.map(({ name, team, points, answers }) => {
    const matches = answers.map(({ prompt_id, match_name, match_team, points: earned }) => `
      <li><span>${escapeHtml(PROMPTS[prompt_id - 1].title)}</span><span>${escapeHtml(match_name)} · ${teamName(match_team)}</span><strong>+${earned}</strong></li>
    `).join("");
    return `<details class="player-row">
      <summary><strong>${escapeHtml(name)}</strong><span> · ${teamName(team)} · ${points} pts · ${answers.length} / ${PROMPTS.length} logged</span></summary>
      ${matches ? `<ul class="answer-list">${matches}</ul>` : '<p class="muted no-answers">No answers yet.</p>'}
    </details>`;
  }).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#100e1b">
  <title>Owner Dashboard · Find Someone Who?</title>
  <link rel="icon" href="/assets/icon.png" type="image/png">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="site-header">
    <a class="skip" href="#owner">Skip to scores</a>
    <div class="wrap masthead">
      <a href="/" class="wordmark"><span class="brand-icon" aria-hidden="true">?</span><span>FIND WHO</span></a>
    </div>
  </header>
  <main id="owner" class="wrap">
    <div class="owner-head">
      <div><h1>Owner dashboard</h1><p class="muted">Same group +1 point · Different group +2 points</p></div>
      <div><a class="quiet owner-tools" href="/owner">Refresh scores</a></div>
    </div>
    <div class="summary-grid" role="group" aria-label="Group totals">${totals}</div>
    <h2 class="owner-list-title">Player scores</h2>
    ${rows || '<p class="empty-message">Players and scores will appear as people join the game.</p>'}
  </main>
</body>
</html>`;
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index++) diff |= left[index] ^ right[index];
  return diff === 0;
}

const digest = async (input) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(input)));

async function ownerSignature(key, payload) {
  const signingKey = await crypto.subtle.importKey(
    "raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", signingKey, encoder.encode(payload)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createOwnerSession(request, key) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    return fail("Open the private dashboard link directly.", 403);
  }
  if (!key) return fail("Owner access is being set up. Try again shortly.", 503);
  const { key: entered } = await readFields(request);
  if (typeof entered !== "string" || entered.length > 120 ||
      !equalBytes(await digest(entered.trim()), await digest(key))) {
    return fail("This private link is invalid.", 401);
  }
  const expires = Math.floor(Date.now() / 1000) + OWNER_TTL;
  const payload = `owner.${expires}.${crypto.randomUUID()}`;
  const signature = await ownerSignature(key, payload);
  return json({ signedIn: true }, 200, {
    "Set-Cookie": cookie(request, OWNER_COOKIE, `${payload}.${signature}`, OWNER_TTL),
  });
}

async function ownerAuthorized(request, key) {
  const value = getCookie(request, OWNER_COOKIE);
  if (!key || !value || !/^owner\.\d{1,12}\.[0-9a-f-]{36}\.[0-9a-f]{64}$/.test(value)) return false;
  const [, expires] = value.split(".");
  if (Number(expires) <= Date.now() / 1000) return false;
  const parts = value.lastIndexOf(".");
  const expected = await ownerSignature(key, value.slice(0, parts));
  return equalBytes(encoder.encode(expected), encoder.encode(value.slice(parts + 1)));
}

async function ownerRoute(request, env) {
  const authorized = await ownerAuthorized(request, env.OWNER_BOOKMARK_SECRET);
  const lockedPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Owner Dashboard · Find Someone Who?</title>
  <link rel="stylesheet" href="/styles.css">
  <script type="module" src="/owner-access.mjs"></script>
</head>
<body>
  <main id="owner" class="wrap">
    <h1>Owner dashboard</h1>
    <p id="owner-status" class="muted" role="status">Open your private dashboard link to view the scores.</p>
  </main>
</body>
</html>`;
  const html = request.method === "HEAD" ? null : authorized ? renderOwner(await scores(env.DB)) : lockedPage;
  return new Response(html, { headers: ownerHeaders });
}

async function handleApi(request, env, pathname) {
  const { method } = request;
  if (method !== "GET" && !writeAllowed(request)) return fail("This request must come from the game site.", 403);

  if (pathname === "/api/owner/access" && method === "POST") {
    return createOwnerSession(request, env.OWNER_BOOKMARK_SECRET);
  }
  if (pathname === "/api/player") {
    if (method === "GET") return loadPlayer(request, env.DB);
    if (method === "POST") return join(request, env.DB);
  }
  const match = /^\/api\/answer\/(\d{1,2})$/.exec(pathname);
  const promptId = Number(match?.[1]);
  if (method === "PUT" && Number.isInteger(promptId) && PROMPTS[promptId - 1]) {
    return saveAnswer(request, env.DB, promptId);
  }
  return fail("This game action could not be found.", 404);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname.startsWith("/api/")) {
        const pagesRequest = request.headers.get("Origin") === PAGES_ORIGIN &&
          (pathname === "/api/player" || /^\/api\/answer\/\d{1,2}$/.test(pathname));
        const corsHeaders = {
          "Access-Control-Allow-Origin": PAGES_ORIGIN,
          Vary: "Origin",
        };
        if (pagesRequest && request.method === "OPTIONS") {
          return new Response(null, {
            status: 204,
            headers: {
              ...corsHeaders,
              "Access-Control-Allow-Methods": "GET, POST, PUT",
              "Access-Control-Allow-Headers": "Authorization, Content-Type",
            },
          });
        }
        const response = await handleApi(request, env, pathname);
        if (pagesRequest) {
          for (const [key, value] of Object.entries(corsHeaders)) response.headers.set(key, value);
        }
        return response;
      }
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
      if (pathname === "/owner" || pathname === "/owner/") return await ownerRoute(request, env);
      const page = pathname === "/";
      const asset = Object.hasOwn(ASSETS, pathname) ? ASSETS[pathname] : null;
      const file = page ? ASSETS["/index.html"] : asset;
      if (!file) return new Response("Page not found", { status: 404, headers: securityHeaders });
      const [contentType, encoded] = file;
      return new Response(request.method === "HEAD" ? null : Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)), {
        headers: {
          ...securityHeaders,
          "Content-Type": contentType,
          "Cache-Control": page ? "no-store" : "public, max-age=300",
        },
      });
    } catch (error) {
      console.error("Find Who request failed", pathname, error instanceof Error ? error.message : "Unknown error");
      return fail("The game is temporarily unavailable. Try again shortly.", 503);
    }
  },
};
