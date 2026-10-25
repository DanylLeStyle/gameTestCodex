import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createGameServer } from "../server.js";

async function connect(url) {
  const ws = new WebSocket(url);
  const queue = [];
  ws.on("message", (raw) => queue.push(JSON.parse(raw)));
  const next = async (predicate) => {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const index = queue.findIndex(predicate);
      if (index >= 0) return queue.splice(index, 1)[0];
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Timed out waiting for network message");
  };
  const welcome = await next((m) => m.type === "welcome");
  return { ws, id: welcome.id, next, send: (m) => ws.send(JSON.stringify(m)) };
}
test("real WebSocket clients create, join, sync movement and isolate rooms", async (t) => {
  const app = createGameServer();
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());
  const { port } = app.server.address();
  const base = `http://127.0.0.1:${port}`;
  for (const path of [
    "/",
    "/client.js",
    "/three.js",
    "/three.core.js",
    "/world-data.js",
  ]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
  }
  assert.equal((await fetch(base + "/health")).status, 200);
  assert.equal((await fetch(base + "/../package.json")).status, 404);
  const url = base.replace("http:", "ws:");
  const a = await connect(url),
    b = await connect(url),
    c = await connect(url);
  a.send({ type: "create", name: "Alice" });
  const { code } = await a.next((m) => m.type === "joined");
  assert.match(code, /^[A-Z2-9]{5}$/);
  b.send({ type: "join", name: "Bob", code: "XXXXX" });
  await b.next((m) => m.type === "error");
  b.send({ type: "join", name: "Bob", code });
  await b.next((m) => m.type === "joined");
  c.send({ type: "create", name: "Charlie", practice: true });
  const other = await c.next((m) => m.type === "joined");
  assert.notEqual(other.code, code);
  const lobby = await a.next(
    (m) => m.type === "state" && m.room.players.length === 2,
  );
  assert.equal(lobby.room.phase, "lobby");
  b.send({ type: "start" });
  await b.next((m) => m.type === "error");
  a.send({ type: "start" });
  const started = await b.next(
    (m) => m.type === "state" && m.room.phase === "playing",
  );
  assert.equal(started.room.players.find((p) => p.id === a.id).role, "hunter");
  assert.equal(started.room.players.find((p) => p.id === b.id).role, "hidden");
  const room = app.rooms.get(code),
    bob = room.players.get(b.id);
  Object.assign(bob, { x: 0, z: 10 });
  b.send({ type: "input", forward: 1, right: 0, yaw: 0 });
  const moved = await a.next(
    (m) =>
      m.type === "state" && m.room.players.find((p) => p.id === b.id)?.z < 10,
  );
  assert.ok(moved.room.players.find((p) => p.id === b.id).z < 10);
  const separate = await c.next((m) => m.type === "state");
  assert.equal(separate.room.players.length, 1);
  a.ws.close();
  const ended = await b.next(
    (m) => m.type === "state" && m.room.phase === "ended",
  );
  assert.equal(ended.room.hostId, b.id);
  assert.equal(ended.room.result.winner, "hidden");
  b.send({ type: "leave" });
  await b.next((m) => m.type === "left");
  assert.equal(app.rooms.has(code), false);
});

test("room admission preserves prior room on failed joins and rejects mid-round intruders", async (t) => {
  const app = createGameServer();
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());
  const url = `ws://127.0.0.1:${app.server.address().port}`;
  const a = await connect(url),
    b = await connect(url),
    c = await connect(url);
  a.send({ type: "create", name: "Alice" });
  const first = await a.next((m) => m.type === "joined");
  b.send({ type: "create", name: "Bob" });
  const second = await b.next((m) => m.type === "joined");
  c.send({ type: "join", name: "Charlie", code: first.code });
  await c.next((m) => m.type === "joined");
  a.send({ type: "start" });
  await a.next((m) => m.type === "state" && m.room.phase === "playing");
  b.send({ type: "join", name: "Bob", code: first.code });
  const denied = await b.next((m) => m.type === "error");
  assert.match(denied.message, /commencé/);
  assert.equal(app.rooms.get(second.code).players.has(b.id), true);
  assert.equal(app.rooms.get(first.code).players.has(b.id), false);
  // Repeating a join to your current room never creates duplicate player entries.
  c.send({ type: "join", name: "Charlie", code: first.code });
  const snapshot = await c.next(
    (m) => m.type === "state" && m.room.phase === "playing",
  );
  assert.equal(snapshot.room.players.length, 2);
  assert.equal(app.rooms.size, 2);
});
