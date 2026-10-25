import { createScene } from "/scene.js";
import { AudioEngine } from "/audio.js";

const $ = (id) => document.getElementById(id);
const defaults = {
  name: "Incognito",
  layout: "azerty",
  sensitivity: 50,
  volume: 60,
  quality: "high",
  invertY: false,
  muted: false,
};
let settings = { ...defaults };
try {
  settings = {
    ...defaults,
    ...JSON.parse(localStorage.getItem("crowd-cover-settings") || "{}"),
  };
} catch {}
settings.name =
  typeof settings.name === "string"
    ? settings.name.slice(0, 18)
    : defaults.name;
for (const key of ["volume", "sensitivity"])
  settings[key] = Number.isFinite(Number(settings[key]))
    ? Math.max(key === "volume" ? 0 : 10, Math.min(100, Number(settings[key])))
    : defaults[key];
settings.layout = settings.layout === "qwerty" ? "qwerty" : "azerty";
settings.quality = settings.quality === "low" ? "low" : "high";
const audio = new AudioEngine();
let graphics;
try {
  graphics = createScene($("world"));
} catch (error) {
  $("fatal").hidden = false;
  $("fatal-message").textContent =
    "Le rendu 3D n’a pas pu démarrer. Active l’accélération graphique de ton navigateur et réessaie. " +
    error.message;
  throw error;
}
let socket,
  id,
  room = null,
  serverOffset = 0,
  previousPhase,
  previousRound = 0;
let yaw = 0,
  pitch = -0.08,
  lastFrame = performance.now(),
  time = 0,
  busyUntil = 0,
  notificationTimer;
let cameraInitialized = false,
  seenEvents = new Set(),
  lastToast = "",
  toastUntil = 0;
let lastActionSent = 0,
  lastUI = 0,
  pendingInvite = new URLSearchParams(location.search).get("room");
const keys = new Set();
const view = {
  yaw: 0,
  pitch: -0.08,
  playing: false,
  firstPerson: false,
  quality: settings.quality,
};
const me = () => room?.players.find((p) => p.id === id);
const now = () => Date.now() + serverOffset;
const locked = () => document.pointerLockElement === $("world");
const save = () => {
  try {
    localStorage.setItem("crowd-cover-settings", JSON.stringify(settings));
  } catch {}
};
function notify(message) {
  $("notification").textContent = message;
  $("notification").hidden = false;
  clearTimeout(notificationTimer);
  notificationTimer = setTimeout(() => ($("notification").hidden = true), 5000);
}
function send(message) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}
function sound(name = "click") {
  audio.unlock().then(() => audio.play(name));
}
function modalOpen(id) {
  keys.clear();
  $("" + id).hidden = false;
}
function closeModal(id) {
  $(id).hidden = true;
  sound();
}
function exitLock() {
  keys.clear();
  if (locked()) document.exitPointerLock();
}
function requestLock() {
  if (room?.phase !== "playing") return;
  sound("confirm");
  try {
    const result = $("world").requestPointerLock();
    result?.catch(() => {
      $("pause").hidden = false;
      notify("Clique sur « Entrer en jeu » pour activer la souris.");
    });
  } catch {
    notify(
      "Ce navigateur ne permet pas de capturer la souris. Utilise Chrome, Edge ou Firefox sur ordinateur.",
    );
  }
}
function applySettings() {
  audio.setVolume(settings.volume / 100);
  audio.setMuted(settings.muted);
  view.quality = settings.quality;
  $("sound-toggle").textContent = settings.muted ? "♪̸" : "♫";
  $("sound-toggle").setAttribute(
    "aria-label",
    settings.muted ? "Activer le son" : "Couper le son",
  );
  $("sound-toggle").title = settings.muted ? "Activer le son" : "Couper le son";
  $("movement-keys").textContent =
    settings.layout === "azerty" ? "Z Q S D" : "W A S D";
  $("sensitivity-label").textContent = settings.sensitivity;
  $("volume-label").textContent = `${settings.volume} %`;
}
for (const [key, field] of [
  ["name", "player-name"],
  ["layout", "layout"],
  ["sensitivity", "sensitivity"],
  ["volume", "volume"],
  ["quality", "quality"],
  ["invertY", "invert-y"],
]) {
  const element = $(field);
  if (element.type === "checkbox") element.checked = settings[key];
  else element.value = settings[key];
  element.addEventListener("input", () => {
    settings[key] =
      element.type === "checkbox"
        ? element.checked
        : element.type === "range"
          ? Number(element.value)
          : element.value;
    save();
    applySettings();
  });
}
applySettings();
$("sound-toggle").onclick = () => {
  settings.muted = !settings.muted;
  save();
  applySettings();
  if (!settings.muted) sound("confirm");
};
$("settings-open").onclick = $("pause-settings").onclick = () => {
  exitLock();
  modalOpen("settings");
  sound();
};
$("how-open").onclick = () => {
  modalOpen("how");
  sound();
};
$("show-join").onclick = () => {
  modalOpen("join-panel");
  $("join-code").focus();
  sound();
};
for (const button of document.querySelectorAll("[data-close]"))
  button.onclick = () => closeModal(button.dataset.close);
for (const element of document.querySelectorAll(".modal-backdrop"))
  element.addEventListener("click", (event) => {
    if (
      event.target === element &&
      ["settings", "how", "join-panel"].includes(element.id)
    )
      closeModal(element.id);
  });
function connect() {
  $("connection").textContent = "CONNEXION";
  socket = new WebSocket(
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`,
  );
  socket.onopen = () => {
    $("connection").textContent = "SERVEUR EN LIGNE";
  };
  socket.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "welcome") {
      id = message.id;
      if (pendingInvite) {
        $("join-code").value = pendingInvite.slice(0, 5);
        modalOpen("join-panel");
        pendingInvite = null;
      }
    } else if (message.type === "joined") {
      busyUntil = 0;
      room = null;
      previousPhase = null;
      previousRound = 0;
      cameraInitialized = false;
      seenEvents.clear();
      $("join-panel").hidden = true;
      const url = new URL(location.href);
      url.searchParams.set("room", message.code);
      history.replaceState(null, "", url);
    } else if (message.type === "left") {
      resetMenu();
    } else if (message.type === "state") {
      const next = message.room;
      serverOffset = next.serverTime - Date.now();
      room = next;
      if (!cameraInitialized || room.round !== previousRound) {
        yaw = me()?.yaw || 0;
        pitch = -0.08;
        cameraInitialized = true;
      }
      if (room.phase !== previousPhase || room.round !== previousRound)
        phaseChanged();
      previousPhase = room.phase;
      previousRound = room.round;
      for (const event of room.events) {
        if (seenEvents.has(event.id)) continue;
        seenEvents.add(event.id);
        if (now() - event.at > 2500) continue;
        if (event.type === "caught")
          toast(
            event.targetId === id
              ? "Repéré ! Le chasseur t’a démasqué."
              : event.playerId === id
                ? "Bien vu. Un masque tombe."
                : "Un infiltré a été démasqué.",
          );
        if (event.type === "mistake")
          toast(
            event.playerId === id
              ? "Un civil… +10 secondes pour les infiltrés."
              : "Le chasseur a touché un civil.",
          );
        if (event.type === "decoy" && event.playerId === id)
          toast("Diversion lancée. Reste naturel.");
      }
      if (seenEvents.size > 600)
        seenEvents = new Set([...seenEvents].slice(-200));
    } else if (message.type === "error") {
      busyUntil = 0;
      notify(message.message);
    } else if (message.type === "pong") {
      $("ping").textContent = Math.max(0, Date.now() - message.at) + " ms";
    }
  };
  socket.onclose = () => {
    resetMenu();
    $("connection").textContent = "HORS LIGNE";
    notify("Connexion au serveur perdue. Reconnexion en cours…");
    setTimeout(connect, 2000);
  };
  socket.onerror = () => {
    $("connection").textContent = "SERVEUR INACCESSIBLE";
  };
}
function resetMenu() {
  exitLock();
  room = null;
  previousPhase = null;
  previousRound = 0;
  cameraInitialized = false;
  busyUntil = 0;
  for (const name of [
    "lobby",
    "game-hud",
    "pause",
    "results",
    "join-panel",
    "settings",
    "how",
  ])
    $(name).hidden = true;
  $("menu").hidden = false;
  document.body.classList.remove("in-game");
  history.replaceState(null, "", location.pathname);
}
function phaseChanged() {
  const phase = room.phase;
  $("menu").hidden = true;
  $("lobby").hidden = phase !== "lobby";
  $("game-hud").hidden = phase !== "playing";
  $("results").hidden = phase !== "ended";
  document.body.classList.toggle("in-game", phase === "playing");
  if (phase === "playing") {
    $("pause").hidden = locked();
    $("resume").textContent = "ENTRER EN JEU";
  } else {
    exitLock();
    $("pause").hidden = true;
  }
  if (phase === "ended") {
    const result = room.result;
    $("result-title").textContent =
      result.winner === "hunter" ? "Les masques tombent." : "Ni vu, ni connu.";
    $("result-description").textContent = result.text;
    $("result-symbol").textContent = result.winner === "hunter" ? "⌖" : "◎";
  }
}
function create(practice = false) {
  if (performance.now() < busyUntil) return;
  if (
    !send({
      type: "create",
      name: settings.name.trim() || "Incognito",
      practice,
    })
  ) {
    notify("Le serveur n’est pas encore connecté. Patiente un instant.");
    return;
  }
  busyUntil = performance.now() + 3000;
  sound("confirm");
}
$("create").onclick = () => create(false);
$("practice").onclick = () => create(true);
$("join-form").onsubmit = (event) => {
  event.preventDefault();
  if (
    send({
      type: "join",
      code: $("join-code").value.trim().toUpperCase(),
      name: settings.name.trim() || "Incognito",
    })
  )
    sound("confirm");
  else notify("Le serveur est hors ligne.");
};
$("start-round").onclick = $("next-round").onclick = () => {
  sound("confirm");
  send({ type: "start" });
};
function leave() {
  sound();
  send({ type: "leave" });
  resetMenu();
}
for (const button of ["leave-lobby", "leave-game", "leave-results"])
  $(button).onclick = leave;
$("resume").onclick = requestLock;
$("copy-invite").onclick = async () => {
  const url = new URL(location.href);
  url.searchParams.set("room", room.code);
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    notify(
      `Code : ${room.code}. Pour un ami sur un autre PC, utilise l’adresse IP réseau du serveur, pas localhost.`,
    );
    return;
  }
  try {
    await navigator.clipboard.writeText(url.href);
    notify("Lien d’invitation copié !");
    sound("confirm");
  } catch {
    notify("Lien à partager : " + url.href);
  }
};
function currentInput() {
  const active =
    locked() && room?.phase === "playing" && !($("settings").hidden === false);
  const forwardCode = "KeyW"; // Physical W is labelled Z on AZERTY.

  // KeyboardEvent.code describes the physical key: the same four keys work on both layouts.
  return {
    type: "input",
    forward: active
      ? Number(keys.has(forwardCode) || keys.has("ArrowUp")) -
        Number(keys.has("KeyS") || keys.has("ArrowDown"))
      : 0,
    right: active
      ? Number(keys.has("KeyD") || keys.has("ArrowRight")) -
        Number(keys.has("KeyA") || keys.has("ArrowLeft"))
      : 0,
    yaw,
    pitch,
    react: active && keys.has("Space"),
    interact: active && keys.has("KeyE"),
    sprint: active && (keys.has("ShiftLeft") || keys.has("ShiftRight")),
  };
}
function action(action) {
  if (!locked() || room?.phase !== "playing" || !me()?.alive) return;
  const t = performance.now();
  if (t - lastActionSent < 100) return;
  lastActionSent = t;
  send(currentInput());
  send({ type: "action", action });
}
window.addEventListener("keydown", (event) => {
  if (event.target.matches("input,select")) return;
  if (
    locked() &&
    [
      "Space",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Tab",
    ].includes(event.code)
  )
    event.preventDefault();
  keys.add(event.code);
  if (!event.repeat) {
    if (event.code === "KeyG") action("pulse");
    if (event.code === "KeyF") action("decoy");
  }
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
window.addEventListener("blur", () => {
  keys.clear();
  send(currentInput());
});
document.addEventListener("mousemove", (event) => {
  if (!locked()) return;
  const sensitivity = 0.0005 + settings.sensitivity * 0.000035;
  yaw -= event.movementX * sensitivity;
  yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
  pitch -= event.movementY * sensitivity * (settings.invertY ? -1 : 1);
  pitch = Math.max(-1.05, Math.min(1.05, pitch));
});
$("world").addEventListener("mousedown", (event) => {
  if (event.button === 0) action("tag");
});
document.addEventListener("pointerlockchange", () => {
  keys.clear();
  if (room?.phase === "playing") {
    $("pause").hidden = locked();
    $("resume").textContent = "REPRENDRE";
  }
  if (!locked()) send(currentInput());
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    keys.clear();
    send(currentInput());
  }
});
setInterval(() => {
  if (room) send(currentInput());
}, 50);
setInterval(() => {
  if (socket?.readyState === 1) send({ type: "ping", at: Date.now() });
}, 2000);
function toast(text) {
  lastToast = text;
  toastUntil = now() + 3000;
}
function renderRoster() {
  $("roster").replaceChildren();
  for (const player of room.players) {
    const row = document.createElement("div");
    row.className = "roster-row";
    const face = document.createElement("span");
    face.className = "roster-face";
    face.textContent = "◉";
    const name = document.createElement("span");
    name.className = "roster-name";
    name.textContent = player.name + (player.id === id ? " (toi)" : "");
    const badge = document.createElement("span");
    badge.className = "roster-badge";
    badge.textContent = player.id === room.hostId ? "HÔTE" : "PRÊT";
    row.append(face, name, badge);
    $("roster").append(row);
  }
}
function ability(key, symbol, title, status, ratio = 1) {
  return `<div class="ability${ratio < 1 ? " cooling" : ""}"><div class="ability-top"><span class="ability-symbol">${symbol}</span><kbd>${key}</kbd></div><span class="ability-title">${title}</span><small class="ability-status">${status}</small><div class="ability-bar" style="width:${Math.max(0, Math.min(1, ratio)) * 100}%"></div></div>`;
}
function updateUI() {
  for (const button of ["create", "practice"])
    $(button).disabled =
      performance.now() < busyUntil || socket?.readyState !== 1;
  if (!room) return;
  const player = me();
  if (!player) return;
  const host = room.hostId === id;
  if (room.phase === "lobby") {
    $("room-code").textContent = room.code;
    renderRoster();
    $("start-round").disabled = !host || room.players.length < 2;
    $("start-round").textContent = host
      ? "LANCER LA MANCHE"
      : "L’HÔTE PRÉPARE LA PARTIE";
    $("lobby-hint").textContent =
      room.players.length < 2
        ? "Invite au moins un ami pour lancer la partie."
        : `${room.players.length}/8 joueurs · ${host ? "À toi de lancer." : "En attente de l’hôte."}`;
  }
  if (room.phase === "ended") {
    $("next-round").disabled = !host;
    $("result-hint").textContent = host
      ? "Le rôle du chasseur change à la prochaine manche."
      : "En attente de l’hôte pour la prochaine manche.";
    $("scoreboard").replaceChildren();
    for (const p of [...room.players].sort((a, b) => b.score - a.score)) {
      const row = document.createElement("div");
      row.className = "score-row";
      const name = document.createElement("span");
      name.textContent = p.name + (p.id === id ? " (toi)" : "");
      const score = document.createElement("strong");
      score.textContent = p.score + " pts";
      row.append(name, score);
      $("scoreboard").append(row);
    }
  }
  if (room.phase !== "playing") return;
  const hunter = player.role === "hunter",
    countdown = Math.max(0, Math.ceil((room.startsAt - now()) / 1000));
  $("countdown-curtain").hidden = !hunter || countdown === 0;
  $("curtain-seconds").textContent = countdown;
  $("role-label").textContent = room.practice
    ? "ENTRAÎNEMENT / CHASSEUR"
    : hunter
      ? "01 / LE CHASSEUR"
      : "02 / L’INFILTRÉ";
  $("mission-title").textContent = hunter
    ? "Repère l’imposteur."
    : "Deviens invisible.";
  $("mission-subtitle").textContent = room.practice
    ? "Trois imposteurs réagissent trop tard à la panique. Observe-les et capture-les."
    : hunter
      ? "Provoque une réaction. Observe qui hésite. Trois civils touchés : tu perds."
      : "Imite les passants. Réagis à la panique. Survis au chronomètre.";
  $("pause-title").textContent = hunter
    ? "Chaque détail compte."
    : "Un visage parmi les autres.";
  $("pause-eyebrow").textContent = hunter
    ? "TU ES LE CHASSEUR"
    : "TU ES UN INFILTRÉ";
  $("pause-description").textContent = hunter
    ? "Souris : regarder. Clic : capturer. G : onde de panique. Échap : menu. La manche continue pendant ce menu."
    : "Souris : regarder. ZQSD / WASD : bouger. E : discuter. Espace : paniquer. F : diversion. La manche continue pendant ce menu.";
  const seconds = Math.max(0, Math.ceil((room.endsAt - now()) / 1000));
  $("timer").textContent = `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  $("timer").classList.toggle("urgent", seconds <= 30);
  $("phase-label").textContent = countdown
    ? `DISPERSION · ${countdown}`
    : `MANCHE ${room.round}`;
  const remaining = room.practice
    ? room.npcs.filter((n) => n.practiceTarget && n.alive).length
    : room.players.filter((p) => p.role === "hidden" && p.alive).length;
  $("remaining").textContent = hunter
    ? `${remaining} infiltré${remaining > 1 ? "s" : ""} · ${player.mistakes || 0}/3 erreurs`
    : `${remaining} infiltré${remaining > 1 ? "s" : ""} encore caché${remaining > 1 ? "s" : ""}`;
  $("reticle").hidden = !hunter || !player.alive;
  $("spectator").hidden = player.alive;
  $("hud-code").textContent = room.code;
  const cd = player.cooldowns || {};
  if (hunter)
    $("abilities").innerHTML =
      ability(
        "CLIC",
        "⌖",
        "DÉMASQUER",
        cd.tag > 0 ? "Recharge…" : "Viser un suspect",
        1 - (cd.tag || 0) / 0.75,
      ) +
      ability(
        "G",
        "◎",
        "ONDE DE PANIQUE",
        cd.pulse > 0 ? `${Math.ceil(cd.pulse)} s` : "Prête · zone de 8 m",
        1 - (cd.pulse || 0) / 10,
      );
  else
    $("abilities").innerHTML =
      ability("E", "♧", "DISCUTER", "Maintenir") +
      ability("ESPACE", "⚡", "PANIQUER", "Maintenir") +
      ability(
        "F",
        "◇",
        "DIVERSION",
        cd.decoy > 0 ? `${Math.ceil(cd.decoy)} s` : "Prête",
        1 - (cd.decoy || 0) / 20,
      );
  const danger =
    !hunter &&
    player.alive &&
    room.events.some(
      (e) =>
        e.type === "pulse" &&
        now() - e.at < 3000 &&
        Math.hypot(e.x - player.x, e.z - player.z) < 8,
    );
  $("reaction-alert").hidden = !danger;
  $("event-toast").textContent = countdown
    ? hunter
      ? `Laisse-les se cacher… ${countdown}`
      : `Fonds-toi dans la foule · ${countdown}`
    : toastUntil > now()
      ? lastToast
      : "";
}
connect();
function frame(timestamp) {
  requestAnimationFrame(frame);
  const dt = Math.min((timestamp - lastFrame) / 1000, 0.08);
  lastFrame = timestamp;
  time += dt;
  view.yaw = yaw;
  view.pitch = pitch;
  view.playing = room?.phase === "playing";
  view.firstPerson = me()?.role === "hunter";
  graphics.update(room, me(), view, dt, time);
  const input = currentInput();
  audio.update(room, me(), dt, !!(input.forward || input.right));
  if (timestamp - lastUI > 100) {
    updateUI();
    lastUI = timestamp;
  }
}
requestAnimationFrame(frame);
window.addEventListener("resize", () => graphics.resize());

// Render decorative diagonal arrows with CSS instead of relying on the OS symbol font.
for (const node of document.querySelectorAll(
  "button, .location-bottom .text-button",
)) {
  for (const child of [...node.childNodes])
    if (child.nodeType === Node.TEXT_NODE && child.textContent.includes("↗")) {
      const [before, ...after] = child.textContent.split("↗");
      child.textContent = before;
      const arrow = document.createElement("span");
      arrow.className = "arrow-icon";
      arrow.setAttribute("aria-hidden", "true");
      node.append(arrow);
      if (after.join("")) node.append(document.createTextNode(after.join("")));
    }
}
