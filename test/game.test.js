import test from "node:test";
import assert from "node:assert/strict";
import { GameRoom, NPC_COUNT, MAX_PLAYERS } from "../game.js";
import { isWalkable } from "../public/world-data.js";

function playing(practice = false) {
  const game = new GameRoom("TEST1", "host", { practice });
  game.add("host", "Host");
  if (!practice) game.add("guest", "Guest");
  game.start("host", 10000);
  return game;
}
test("lobby requires host and at least two players; next round rotates hunter", () => {
  const g = new GameRoom("TEST1", "host");
  g.add("host", "<Host>");
  assert.equal(g.players.get("host").name, "Host");
  assert.throws(() => g.start("host"), /deux joueurs/);
  g.add("guest", "Guest");
  assert.throws(() => g.start("guest"), /hôte/);
  g.start("host", 10000);
  assert.equal(g.players.get("host").role, "hunter");
  assert.throws(() => g.add("late"), /commencé/);
  g.finish("hidden", "done", 20000);
  g.start("host", 21000);
  assert.equal(g.players.get("guest").role, "hunter");
});
test("server clamps malformed movement and applies camera-relative controls", () => {
  const g = playing();
  const p = g.players.get("guest");
  Object.assign(p, { x: 0, z: 10 });
  g.setInput(p.id, { forward: 9000, right: 0, yaw: 0 }, 16000);
  g.tick(0.05, 16000);
  assert.equal(p.x, 0);
  assert.ok(p.z < 10);
  Object.assign(p, { x: 0, z: 10 });
  g.setInput(p.id, { forward: 1, right: 0, yaw: -Math.PI / 2 }, 16050);
  g.tick(0.05, 16050);
  assert.ok(p.x > 0);
  assert.equal(p.z, 10);
  g.setInput(p.id, { forward: Infinity, right: NaN, yaw: NaN }, 16100);
  const before = { x: p.x, z: p.z };
  g.tick(0.05, 16100);
  assert.equal(p.x, before.x);
  assert.equal(p.z, before.z);
});
test("fountain, props and plaza boundaries are authoritative collisions", () => {
  const g = playing();
  const p = g.players.get("guest");
  Object.assign(p, { x: 0, z: 3.08 });
  for (let i = 0; i < 100; i++) {
    const now = 16000 + i * 50;
    g.setInput(p.id, { forward: 1, yaw: 0 }, now);
    g.tick(0.05, now);
  }
  assert.ok(p.z >= 3.06);
  assert.ok(isWalkable(p.x, p.z));
  assert.equal(isWalkable(0, 0), false);
  assert.equal(isWalkable(99, 0), false);
  assert.equal(isWalkable(-15.5, 0), false);
});
test("hunter grace period, pulse cooldown and manual human panic response", () => {
  const g = playing();
  const p = g.players.get("host");
  Object.assign(p, { x: 0, z: 15 });
  g.npcs = [
    {
      id: "npc",
      x: 0,
      z: 8,
      yaw: 0,
      alive: true,
      state: "walk",
      nextThink: Infinity,
    },
  ];
  g.action(p.id, "pulse", 14000);
  assert.equal(g.events.filter((e) => e.type === "pulse").length, 0);
  g.action(p.id, "pulse", 16000);
  assert.equal(g.events.filter((e) => e.type === "pulse").length, 1);
  g.action(p.id, "pulse", 16001);
  assert.equal(g.events.filter((e) => e.type === "pulse").length, 1);
  g.tick(0.05, 16600);
  assert.equal(g.npcs[0].state, "panic");
  assert.notEqual(g.players.get("guest").state, "panic");
  assert.ok(
    g.snapshot(17000).players.find((p) => p.id === "host").cooldowns.pulse > 0,
  );
});
test("ray capture is authoritative and correctly ends round", () => {
  const g = playing();
  const hunter = g.players.get("host"),
    hidden = g.players.get("guest");
  g.npcs = [];
  Object.assign(hunter, { x: 0, z: 15 });
  Object.assign(hidden, { x: 0, z: 10 });
  g.action(hidden.id, "tag", 16000);
  assert.equal(hidden.alive, true);
  g.action(hunter.id, "tag", 16000);
  assert.equal(hidden.alive, false);
  assert.equal(g.phase, "ended");
  assert.equal(g.result.winner, "hunter");
});
test("vertical aim cannot tag a target while looking at the sky", () => {
  const g = playing();
  const hunter = g.players.get("host"),
    hidden = g.players.get("guest");
  g.npcs = [];
  Object.assign(hunter, { x: 0, z: 15 });
  Object.assign(hidden, { x: 0, z: 10 });
  g.setInput(hunter.id, { yaw: 0, pitch: 0.9 }, 16000);
  g.action(hunter.id, "tag", 16000);
  assert.equal(hidden.alive, true);
  g.setInput(hunter.id, { yaw: 0, pitch: 0 }, 17000);
  g.action(hunter.id, "tag", 17000);
  assert.equal(hidden.alive, false);
});
test("solid objects block tagging and wrong targets grant time", () => {
  const g = playing();
  const hunter = g.players.get("host"),
    hidden = g.players.get("guest");
  Object.assign(hunter, { x: 0, z: 5 });
  Object.assign(hidden, { x: 0, z: -5 });
  g.npcs = [];
  g.action(hunter.id, "tag", 16000);
  assert.equal(hidden.alive, true);
  Object.assign(hunter, { x: 0, z: 15 });
  g.npcs = [{ id: "civil", x: 0, z: 10, alive: true, yaw: 0, state: "idle" }];
  const before = g.endsAt;
  g.action(hunter.id, "tag", 17000);
  assert.equal(g.endsAt, before + 10000);
  assert.equal(g.npcs[0].alive, true);
});
test("practice solo has 3 simulated suspects and timer ends with hidden victory", () => {
  const g = playing(true);
  assert.equal(g.npcs.length, NPC_COUNT);
  assert.equal(g.npcs.filter((n) => n.practiceTarget).length, 3);
  assert.throws(() => g.add("intruder"), /commencé/);
  g.tick(0.05, g.endsAt + 1);
  assert.equal(g.result.winner, "hidden");
});
test("disconnect hands off host and ends match if hunter leaves", () => {
  const g = playing();
  g.remove("host", 16000);
  assert.equal(g.hostId, "guest");
  assert.equal(g.result.winner, "hidden");
  const lobby = new GameRoom("CAP", "host");
  lobby.add("host");
  for (let i = 1; i < MAX_PLAYERS; i++) lobby.add(`p${i}`);
  assert.throws(() => lobby.add("overflow"), /complet/);
});
test("NPCs remain on walkable ground over a simulated minute", () => {
  const g = playing();
  for (let i = 0; i < 1200; i++) g.tick(0.05, 16000 + i * 50);
  for (const n of g.npcs)
    assert.ok(isWalkable(n.x, n.z), `${n.id}: ${n.x},${n.z}`);
});

test("third civilian mistake ends the round and resets next round", () => {
  const g = playing();
  const hunter = g.players.get("host"),
    hidden = g.players.get("guest");
  Object.assign(hunter, { x: 0, z: 15 });
  Object.assign(hidden, { x: 5, z: 15 });
  g.npcs = [{ id: "civil", x: 0, z: 10, alive: true, yaw: 0, state: "idle" }];
  const initialEnd = g.endsAt;
  g.action(hunter.id, "tag", 16000);
  assert.equal(hunter.mistakes, 1);
  assert.equal(g.phase, "playing");
  g.action(hunter.id, "tag", 16500); // Cooldown cannot consume an extra mistake.
  assert.equal(hunter.mistakes, 1);
  g.action(hunter.id, "tag", 17000);
  assert.equal(hunter.mistakes, 2);
  assert.equal(g.phase, "playing");
  g.action(hunter.id, "tag", 18000);
  assert.equal(hunter.mistakes, 3);
  assert.equal(g.endsAt, initialEnd + 30000);
  assert.equal(g.phase, "ended");
  assert.equal(g.result.winner, "hidden");
  assert.equal(
    g.snapshot(18000).players.find((p) => p.id === hunter.id).mistakes,
    3,
  );
  g.start("host", 20000);
  assert.ok([...g.players.values()].every((p) => p.mistakes === 0));
});
test("hidden decoy affects nearby civilians, is rate-limited and unavailable to hunter", () => {
  const g = playing(),
    hunter = g.players.get("host"),
    hidden = g.players.get("guest");
  Object.assign(hidden, { x: 0, z: 10 });
  g.npcs = [
    { id: "near", x: 1, z: 14, alive: true, state: "walk" },
    { id: "far", x: 15, z: 14, alive: true, state: "walk" },
  ];
  g.action(hunter.id, "decoy", 16000);
  assert.equal(g.events.filter((e) => e.type === "decoy").length, 0);
  g.action(hidden.id, "decoy", 16000);
  assert.equal(g.events.filter((e) => e.type === "decoy").length, 1);
  assert.equal(g.npcs[0].state, "interact");
  assert.equal(g.npcs[1].state, "walk");
  assert.equal(
    g.snapshot(17000).players.find((p) => p.id === hidden.id).cooldowns.decoy,
    19,
  );
  g.action(hidden.id, "decoy", 17000);
  assert.equal(g.events.filter((e) => e.type === "decoy").length, 1);
  hidden.alive = false;
  g.action(hidden.id, "decoy", 38000);
  assert.equal(g.events.filter((e) => e.type === "decoy").length, 1);
});
test("stale input stops movement without snapping yaw", () => {
  const g = playing(),
    hidden = g.players.get("guest");
  Object.assign(hidden, { x: 0, z: 10 });
  g.setInput(hidden.id, { forward: 1, yaw: -Math.PI / 2 }, 16000);
  g.tick(0.05, 16050);
  const x = hidden.x,
    z = hidden.z;
  g.tick(0.05, 17000);
  assert.equal(hidden.x, x);
  assert.equal(hidden.z, z);
  assert.equal(hidden.yaw, -Math.PI / 2);
  assert.equal(hidden.state, "idle");
});

test("tagging passes above a bench and low fountain rim but not through a kiosk", () => {
  const g = playing();
  const hunter = g.players.get("host"),
    hidden = g.players.get("guest");
  g.npcs = [];
  // The first bench crosses this line at z=-3.8, below the eye-level shot.
  Object.assign(hunter, { x: -5.8, z: 0 });
  Object.assign(hidden, { x: -5.8, z: -8 });
  g.action(hunter.id, "tag", 16000);
  assert.equal(hidden.alive, false);
  const rim = playing();
  rim.npcs = [];
  Object.assign(rim.players.get("host"), { x: 1.8, z: 5 });
  Object.assign(rim.players.get("guest"), { x: 1.8, z: -5 });
  rim.action("host", "tag", 16000);
  assert.equal(rim.players.get("guest").alive, false);
  const blocked = playing();
  blocked.npcs = [];
  Object.assign(blocked.players.get("host"), { x: -15.5, z: 5 });
  Object.assign(blocked.players.get("guest"), { x: -15.5, z: -5 });
  blocked.action("host", "tag", 16000);
  assert.equal(blocked.players.get("guest").alive, true);
});
