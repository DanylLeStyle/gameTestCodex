import { randomInt, randomUUID } from "node:crypto";
import { isWalkable, SIGHT_OBSTACLES } from "./public/world-data.js";

export const NPC_COUNT = 36;
export const MAX_PLAYERS = 8;
export const ROUND_SECONDS = 180;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const zeroInput = () => ({
  forward: 0,
  right: 0,
  yaw: 0,
  pitch: 0,
  react: false,
  interact: false,
  sprint: false,
});
export const sanitizeName = (name) =>
  String(name || "Anonyme")
    .replace(/[<>\x00-\x1f]/g, "")
    .trim()
    .slice(0, 20) || "Anonyme";
export function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    { length: 5 },
    () => alphabet[randomInt(alphabet.length)],
  ).join("");
}
function spawn() {
  for (let i = 0; i < 200; i++) {
    const p = { x: Math.random() * 36 - 18, z: Math.random() * 36 - 18 };
    if (isWalkable(p.x, p.z, 0.7)) return p;
  }
  return { x: 0, z: 17 };
}
function slide(entity, dx, dz) {
  if (isWalkable(entity.x + dx, entity.z + dz)) {
    entity.x += dx;
    entity.z += dz;
    return true;
  }
  let moved = false;
  if (isWalkable(entity.x + dx, entity.z)) {
    entity.x += dx;
    moved = true;
  }
  if (isWalkable(entity.x, entity.z + dz)) {
    entity.z += dz;
    moved = true;
  }
  return moved;
}
function lineOfSight(origin, distance, pitch) {
  const dx = -Math.sin(origin.yaw),
    dz = -Math.cos(origin.yaw);
  const slope = Math.tan(pitch);
  // Intersect a finite 3D sight ray with each solid's horizontal footprint and
  // vertical range. Benches and fountain rims do not hide visible heads.
  return !SIGHT_OBSTACLES.some((obstacle) => {
    let entry = 0,
      exit = distance - 0.2;
    if (obstacle.type === "circle") {
      const x = origin.x - obstacle.x,
        z = origin.z - obstacle.z;
      const along = x * dx + z * dz;
      const discriminant =
        along * along - (x * x + z * z - obstacle.radius ** 2);
      if (discriminant < 0) return false;
      const half = Math.sqrt(discriminant);
      entry = Math.max(entry, -along - half);
      exit = Math.min(exit, -along + half);
    } else {
      for (const [offset, direction, halfSize] of [
        [origin.x - obstacle.x, dx, obstacle.w / 2],
        [origin.z - obstacle.z, dz, obstacle.d / 2],
      ]) {
        if (Math.abs(direction) < 1e-9) {
          if (Math.abs(offset) > halfSize) return false;
        } else {
          const a = (-halfSize - offset) / direction;
          const b = (halfSize - offset) / direction;
          entry = Math.max(entry, Math.min(a, b));
          exit = Math.min(exit, Math.max(a, b));
        }
      }
    }
    if (Math.abs(slope) < 1e-9) {
      if (1.55 > obstacle.height) return false;
    } else {
      const bottom = -1.55 / slope;
      const top = (obstacle.height - 1.55) / slope;
      entry = Math.max(entry, Math.min(bottom, top));
      exit = Math.min(exit, Math.max(bottom, top));
    }
    return entry <= exit;
  });
}

export class GameRoom {
  constructor(code, hostId, { practice = false } = {}) {
    this.code = code;
    this.hostId = hostId;
    this.practice = practice;
    this.players = new Map();
    this.npcs = [];
    this.events = [];
    this.phase = "lobby";
    this.round = 0;
    this.endsAt = 0;
    this.startsAt = 0;
    this.result = null;
    this.eventId = 0;
    this.populate();
  }
  populate() {
    this.npcs = Array.from({ length: NPC_COUNT }, (_, i) => ({
      id: `npc-${i}`,
      ...spawn(),
      yaw: Math.random() * Math.PI * 2,
      state: "walk",
      alive: true,
      nextThink: 0,
      panicAt: 0,
      panicUntil: 0,
      practiceTarget: this.practice && i < 3,
      variation: i % 4,
    }));
  }
  add(id = randomUUID(), name = "Anonyme") {
    if (this.phase === "playing")
      throw new Error("La manche a commencé. Attends la suivante.");
    if (this.practice && this.players.size)
      throw new Error("Cette session est un entraînement solo.");
    if (this.players.size >= MAX_PLAYERS)
      throw new Error("Ce salon est complet (8 joueurs).");
    const player = {
      id,
      name: sanitizeName(name),
      ...spawn(),
      yaw: 0,
      role: this.players.size === 0 ? "hunter" : "hidden",
      state: "idle",
      alive: true,
      score: 0,
      mistakes: 0,
      variation: this.players.size % 4,
      cooldowns: { pulse: 0, tag: 0, decoy: 0 },
      input: zeroInput(),
      inputAt: 0,
    };
    this.players.set(id, player);
    return player;
  }
  remove(id, now = Date.now()) {
    const leaving = this.players.get(id);
    this.players.delete(id);
    if (this.hostId === id)
      this.hostId = this.players.keys().next().value || null;
    if (this.phase === "playing" && leaving?.role === "hunter")
      this.finish("hidden", "Le chasseur a quitté la partie.", now);
    else if (this.phase === "playing") this.checkVictory(now);
    if (this.phase === "lobby" && leaving?.role === "hunter") {
      const next = this.players.values().next().value;
      if (next) next.role = "hunter";
    }
  }
  event(type, data = {}, now = Date.now()) {
    this.events.push({
      id: `${this.code}-${++this.eventId}`,
      type,
      at: now,
      ...data,
    });
  }
  start(id, now = Date.now()) {
    if (id !== this.hostId)
      throw new Error("Seul l’hôte peut lancer une manche.");
    if (this.phase === "playing") return;
    if (!this.practice && this.players.size < 2)
      throw new Error(
        "Il faut au moins deux joueurs, ou lancer un entraînement solo.",
      );
    const players = [...this.players.values()];
    const hunter = players[this.round % players.length];
    this.round++;
    this.phase = "playing";
    this.startsAt = now + 5000;
    this.endsAt = this.startsAt + ROUND_SECONDS * 1000;
    this.result = null;
    this.events = [];
    this.populate();
    for (const p of players) {
      p.role = p.id === hunter.id ? "hunter" : "hidden";
      Object.assign(p, p.role === "hunter" ? { x: 0, z: 18, yaw: 0 } : spawn());
      p.alive = true;
      p.state = "idle";
      p.mistakes = 0;
      p.input = zeroInput();
      p.cooldowns = { pulse: 0, tag: 0, decoy: 0 };
    }
    this.event("start", { playerId: hunter.id, x: hunter.x, z: hunter.z }, now);
  }
  setInput(id, message, now = Date.now()) {
    const p = this.players.get(id);
    if (!p) return;
    p.input = {
      forward: finite(message.forward) ? clamp(message.forward, -1, 1) : 0,
      right: finite(message.right) ? clamp(message.right, -1, 1) : 0,
      yaw: finite(message.yaw)
        ? Math.atan2(Math.sin(message.yaw), Math.cos(message.yaw))
        : p.yaw,
      pitch: finite(message.pitch) ? clamp(message.pitch, -1.1, 1.1) : 0,
      react: message.react === true,
      interact: message.interact === true,
      sprint: message.sprint === true,
    };
    p.inputAt = now;
  }
  action(id, action, now = Date.now()) {
    const p = this.players.get(id);
    if (!p || !p.alive || this.phase !== "playing" || now < this.startsAt)
      return;
    // The most recent input is used immediately so clicks align with the rendered crosshair.
    p.yaw = p.input.yaw;
    if (action === "pulse" && p.role === "hunter" && now >= p.cooldowns.pulse) {
      p.cooldowns.pulse = now + 10000;
      let x = p.x,
        z = p.z;
      for (let distance = 0.5; distance <= 7; distance += 0.5) {
        const nx = p.x - Math.sin(p.yaw) * distance,
          nz = p.z - Math.cos(p.yaw) * distance;
        if (!isWalkable(nx, nz, 0.05)) break;
        x = nx;
        z = nz;
      }
      this.event("pulse", { x, z, playerId: p.id, radius: 8 }, now);
      for (const npc of this.npcs) {
        if (!npc.alive || Math.hypot(npc.x - x, npc.z - z) > 8) continue;
        npc.panicAt =
          now + (npc.practiceTarget ? 1600 : 160 + Math.random() * 300);
        npc.panicUntil = now + 3200;
        npc.fleeYaw = Math.atan2(-(npc.x - x), -(npc.z - z));
      }
    } else if (
      action === "tag" &&
      p.role === "hunter" &&
      now >= p.cooldowns.tag
    ) {
      p.cooldowns.tag = now + 750;
      const direction = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
      const candidates = [
        ...this.npcs,
        ...[...this.players.values()].filter((q) => q.role === "hidden"),
      ];
      const target = candidates
        .filter((q) => q.alive)
        .map((q) => {
          const dx = q.x - p.x,
            dz = q.z - p.z;
          const projection = dx * direction.x + dz * direction.z;
          const perpendicular = Math.abs(dx * direction.z - dz * direction.x);
          const rayHeight = 1.55 + Math.tan(p.input.pitch) * projection;
          return { q, projection, perpendicular, rayHeight };
        })
        .filter(
          (hit) =>
            hit.projection > 0 &&
            hit.projection <= 19 &&
            hit.perpendicular < 0.43 &&
            hit.rayHeight >= 0.15 &&
            hit.rayHeight <= 2.05 &&
            lineOfSight(p, hit.projection, p.input.pitch),
        )
        .sort((a, b) => a.projection - b.projection)[0]?.q;
      this.event(
        "tag",
        { x: p.x, z: p.z, playerId: p.id, yaw: p.yaw, targetId: target?.id },
        now,
      );
      if (!target) return;
      if (this.players.has(target.id) || target.practiceTarget) {
        target.alive = false;
        target.state = "caught";
        p.score += 100;
        this.event(
          "caught",
          { x: target.x, z: target.z, playerId: p.id, targetId: target.id },
          now,
        );
        this.checkVictory(now);
      } else {
        p.score = Math.max(0, p.score - 25);
        p.mistakes++;
        this.endsAt += 10000;
        this.event(
          "mistake",
          {
            x: target.x,
            z: target.z,
            playerId: p.id,
            targetId: target.id,
            seconds: 10,
          },
          now,
        );
        target.panicAt = now;
        target.panicUntil = now + 2000;
        target.fleeYaw = Math.atan2(-(target.x - p.x), -(target.z - p.z));
        if (p.mistakes >= 3)
          this.finish(
            "hidden",
            "Trois civils touchés. Les infiltrés gardent leur couverture.",
            now,
          );
      }
    } else if (
      action === "decoy" &&
      p.role === "hidden" &&
      now >= p.cooldowns.decoy
    ) {
      p.cooldowns.decoy = now + 20000;
      const x = clamp(p.x + Math.sin(p.yaw) * 3, -21, 21);
      const z = clamp(p.z + Math.cos(p.yaw) * 3, -21, 21);
      this.event("decoy", { x, z, playerId: p.id, radius: 5 }, now);
      for (const npc of this.npcs) {
        if (Math.hypot(npc.x - x, npc.z - z) < 5 && npc.alive) {
          npc.state = "interact";
          npc.nextThink = now + 1800;
        }
      }
    }
  }
  finish(winner, text, now) {
    if (this.phase !== "playing") return;
    this.phase = "ended";
    this.result = { winner, text };
    for (const p of this.players.values())
      if (p.alive && p.role === winner) p.score += 150;
    this.event("end", { winner }, now);
  }
  checkVictory(now) {
    if (this.phase !== "playing") return;
    const remaining = this.practice
      ? this.npcs.filter((n) => n.practiceTarget && n.alive)
      : [...this.players.values()].filter(
          (p) => p.role === "hidden" && p.alive,
        );
    if (!remaining.length)
      this.finish(
        "hunter",
        this.practice
          ? "Les trois suspects ont été repérés."
          : "Tous les infiltrés ont été repérés.",
        now,
      );
    else if (now >= this.endsAt)
      this.finish("hidden", "Le temps est écoulé. La foule a gagné.", now);
  }
  tick(dt, now = Date.now()) {
    dt = clamp(dt, 0, 0.1);
    this.events = this.events.filter((e) => now - e.at < 5000);
    if (this.phase === "ended") return;
    for (const p of this.players.values()) {
      if (this.phase !== "playing" || !p.alive) continue;
      const input =
        now - p.inputAt < 300 ? p.input : { ...zeroInput(), yaw: p.yaw };
      p.yaw = input.yaw;
      if (now < this.startsAt && p.role === "hunter") {
        p.state = "idle";
        continue;
      }
      const length = Math.max(1, Math.hypot(input.forward, input.right));
      const speed =
        p.role === "hunter"
          ? input.sprint
            ? 6.1
            : 4.4
          : input.react
            ? 3.7
            : input.sprint
              ? 4.8
              : 2.05;
      const dx =
        ((-Math.sin(p.yaw) * input.forward + Math.cos(p.yaw) * input.right) /
          length) *
        speed *
        dt;
      const dz =
        ((-Math.cos(p.yaw) * input.forward - Math.sin(p.yaw) * input.right) /
          length) *
        speed *
        dt;
      slide(p, dx, dz);
      p.state = input.react
        ? "panic"
        : input.interact
          ? "interact"
          : dx || dz
            ? input.sprint
              ? "run"
              : "walk"
            : "idle";
    }
    for (const npc of this.npcs) {
      if (!npc.alive) continue;
      if (npc.panicAt && now >= npc.panicAt && now < npc.panicUntil) {
        npc.state = "panic";
        npc.yaw = npc.fleeYaw;
      } else if (
        now >= npc.nextThink ||
        (npc.state === "panic" && now >= npc.panicUntil)
      ) {
        npc.panicAt = 0;
        npc.state =
          Math.random() < 0.22
            ? "interact"
            : Math.random() < 0.12
              ? "idle"
              : "walk";
        npc.yaw += (Math.random() - 0.5) * Math.PI * 1.3;
        npc.nextThink = now + 1800 + Math.random() * 5000;
      }
      if (npc.state !== "walk" && npc.state !== "panic") continue;
      const speed = npc.state === "panic" ? 3.7 : 2.05;
      let dx = -Math.sin(npc.yaw) * speed * dt,
        dz = -Math.cos(npc.yaw) * speed * dt;
      const nextX = npc.x + dx * 7,
        nextZ = npc.z + dz * 7;
      if (!isWalkable(nextX, nextZ, 0.5)) {
        npc.yaw += Math.PI * (0.35 + Math.random() * 0.35);
        dx = -Math.sin(npc.yaw) * speed * dt;
        dz = -Math.cos(npc.yaw) * speed * dt;
      }
      // Soft crowd separation keeps passers-by from marching through one another.
      for (const other of this.npcs) {
        if (other === npc || !other.alive) continue;
        const distance = Math.hypot(npc.x - other.x, npc.z - other.z);
        if (distance > 0.01 && distance < 0.7) {
          dx += ((npc.x - other.x) / distance) * (0.7 - distance) * dt;
          dz += ((npc.z - other.z) / distance) * (0.7 - distance) * dt;
        }
      }
      if (!slide(npc, dx, dz)) npc.yaw += Math.PI * 0.7;
    }
    this.checkVictory(now);
  }
  snapshot(now = Date.now()) {
    return {
      code: this.code,
      hostId: this.hostId,
      practice: this.practice,
      phase: this.phase,
      round: this.round,
      startsAt: this.startsAt,
      endsAt: this.endsAt,
      serverTime: now,
      result: this.result,
      players: [...this.players.values()].map(
        ({ input, inputAt, cooldowns, ...p }) => ({
          ...p,
          cooldowns: Object.fromEntries(
            Object.entries(cooldowns).map(([key, until]) => [
              key,
              Math.max(0, (until - now) / 1000),
            ]),
          ),
        }),
      ),
      npcs: this.npcs.map(
        ({ nextThink, panicAt, panicUntil, fleeYaw, ...n }) => n,
      ),
      events: this.events,
      remaining: this.practice
        ? this.npcs.filter((n) => n.practiceTarget && n.alive).length
        : [...this.players.values()].filter(
            (p) => p.role === "hidden" && p.alive,
          ).length,
    };
  }
}
