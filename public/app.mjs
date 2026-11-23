import { PROMPTS, TEAMS } from "./game-data.mjs";

const lobby = document.querySelector("#lobby");
const board = document.querySelector("#board");
const loadFailure = document.querySelector("#load-failure");
const joinForm = document.querySelector("#join-form");
const dialog = document.querySelector("#answer-dialog");
const answerForm = document.querySelector("#answer-form");
const toast = document.querySelector("#toast");
const apiOrigin = document.querySelector('meta[name="game-api-origin"]')?.content || "";
const tokenKey = "find-who-player-token";
let playerToken = apiOrigin ? localStorage.getItem(tokenKey) : null;

let player = null;
let answers = new Map();
let filter = "all";
let selectedPrompt;
let toastTimer;

const teamInfo = (id) => TEAMS.find((team) => team.id === id);
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);

async function api(path, method = "GET", payload) {
  let response;
  try {
    response = await fetch(apiOrigin + "/api/" + path, {
      method,
      cache: "no-store",
      headers: {
        ...(payload ? { "Content-Type": "application/json" } : {}),
        ...(playerToken ? { Authorization: "Bearer " + playerToken } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
  } catch {
    throw new Error("Connection lost. Check your internet and try again.");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || "Something went wrong. Try again in a moment.");
    error.status = response.status;
    throw error;
  }
  if (apiOrigin && result.token) {
    playerToken = result.token;
    localStorage.setItem(tokenKey, playerToken);
  }
  return result;
}

function pickPage(section) {
  for (const page of [lobby, board, loadFailure]) page.hidden = page !== section;
}

function focusHeading(el) {
  if (!el) return;
  el.tabIndex = -1;
  el.focus({ preventScroll: true });
}

function notify(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toastTimer = window.setTimeout(() => { toast.textContent = ""; }, 2800);
}

function renderTeamOptions(container, full, current) {
  container.innerHTML = TEAMS.map((team) => `
    <label class="team-option team-${team.id}">
      <input type="radio" name="team" value="${team.id}" aria-label="Group ${team.number} ${team.name}" required ${team.id === current ? "checked" : ""}>
      <span class="team-content">
        <span class="team-emoji" aria-hidden="true">${team.icon}</span>
        <span>
          ${full ? `<span class="team-meta">Group ${team.number}</span>` : ""}
          <span class="team-name">${team.name}</span>
        </span>
      </span>
    </label>`).join("");
}

function setResult(result) {
  player = result.player;
  answers = new Map((result.answers || []).map((answer) => [answer.prompt_id, answer]));
}

async function submitForm(form, errorNode, action) {
  const submit = form.querySelector("[type=submit]");
  const fields = Object.fromEntries(new FormData(form));
  errorNode.textContent = "";
  submit.disabled = true;
  try {
    await action(fields);
  } catch (error) {
    errorNode.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}

renderTeamOptions(document.querySelector("#join-teams"), true);
joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitForm(joinForm, document.querySelector("#join-error"), async (fields) => {
    setResult(await api("player", "POST", fields));
    renderBoard();
    focusHeading(document.querySelector("#board-title"));
  });
});

function renderBoard() {
  const team = teamInfo(player.team);
  const prompts = PROMPTS.filter(({ id }) => filter === "all" || answers.has(id) === (filter === "logged"));
  const count = answers.size;
  board.innerHTML = `
    <div class="board-head">
      <div>
        <p class="eyebrow"><span aria-hidden="true">${team.icon}</span> GROUP ${team.number} · ${team.name.toUpperCase()}</p>
        <h1 id="board-title">Find someone who?</h1>
        <p class="muted">Hi, ${escape(player.name)}! Tap a prompt to log someone you’ve found.</p>
      </div>
      <div class="progress-panel">
        <p class="progress-label"><span id="progress-label">Prompts logged</span><strong>${count} / ${PROMPTS.length}</strong></p>
        <progress aria-labelledby="progress-label" value="${count}" max="${PROMPTS.length}"></progress>
      </div>
    </div>
    <div class="chips" role="group" aria-label="Filter prompts">
      ${[["all", "All prompts"], ["open", "To find"], ["logged", "Logged"]].map(([id, title]) =>
        `<button type="button" class="chip" data-filter="${id}" aria-pressed="${filter === id}">${title}</button>`).join("")}
    </div>
    <div class="prompt-grid">
      ${prompts.length ? prompts.map((prompt) => {
        const answer = answers.get(prompt.id);
        return `<button type="button" class="prompt-card ${answer ? "logged" : ""}" data-prompt="${prompt.id}">
          <span class="prompt-card-top"><span class="prompt-icon" aria-hidden="true">${prompt.icon}</span><span class="card-action" aria-hidden="true">${answer ? "✓" : "+"}</span></span>
          <span class="prompt-title">${escape(prompt.title)}</span>
          ${answer ? `<span class="answer-preview">${escape(answer.match_name)} · ${teamInfo(answer.match_team).name}</span>` : ""}
        </button>`;
      }).join("") : `<p class="empty-message">${filter === "logged" ? "Your matches will appear here as you log them." : "You’ve found a match for every prompt."}</p>`}
    </div>`;
  pickPage(board);
}

board.addEventListener("click", (event) => {
  const filterButton = event.target.closest("[data-filter]");
  if (filterButton) {
    filter = filterButton.dataset.filter;
    renderBoard();
    board.querySelector(`[data-filter="${filter}"]`).focus({ preventScroll: true });
    return;
  }
  const promptButton = event.target.closest("[data-prompt]");
  if (promptButton) openAnswer(Number(promptButton.dataset.prompt));
});

function openAnswer(id) {
  selectedPrompt = PROMPTS[id - 1];
  const current = answers.get(id);
  document.querySelector("#answer-title").textContent = selectedPrompt.title;
  document.querySelector("#answer-icon").textContent = selectedPrompt.icon;
  document.querySelector("#answer-hint").textContent = selectedPrompt.hint || "";
  document.querySelector("#answer-error").textContent = "";
  document.querySelector("#match-name").value = current?.match_name || "";
  renderTeamOptions(document.querySelector("#answer-teams"), false, current?.match_team);
  dialog.showModal();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  focusHeading(document.querySelector("#answer-title"));
}

document.querySelector("#close-answer").addEventListener("click", () => dialog.close());
answerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const id = selectedPrompt.id;
  submitForm(answerForm, document.querySelector("#answer-error"), async (fields) => {
    let answer;
    try {
      ({ answer } = await api("answer/" + id, "PUT", fields));
    } catch (error) {
      if (error.status !== 401) throw error;
      if (apiOrigin) localStorage.removeItem(tokenKey);
      playerToken = null;
      filter = "all";
      setResult({ player: null, answers: [] });
      dialog.close();
      joinForm.reset();
      pickPage(lobby);
      window.scrollTo(0, 0);
      focusHeading(document.querySelector("#game-title"));
      notify("Join the game again to start a fresh board.");
      return;
    }
    answers.set(id, answer);
    dialog.close();
    renderBoard();
    const nextFocus = board.querySelector(`[data-prompt="${id}"]`) || board.querySelector(`[data-filter="${filter}"]`);
    nextFocus.focus({ preventScroll: true });
    notify("Answer saved");
  });
});

async function start() {
  try {
    const result = await api("player");
    if (result.player) {
      setResult(result);
      renderBoard();
    } else {
      pickPage(lobby);
    }
  } catch (error) {
    loadFailure.innerHTML = `<h1 id="load-title">Couldn’t load the game</h1>
      <p class="muted">${escape(error.message)}</p>
      <button type="button" class="primary load-actions">Try again</button>`;
    loadFailure.querySelector("button").addEventListener("click", start);
    pickPage(loadFailure);
  }
}

start();
