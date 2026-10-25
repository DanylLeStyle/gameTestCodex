import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { GameRoom, makeCode } from "./game.js";

const files = {
  "/": "public/index.html",
  "/index.html": "public/index.html",
  "/client.js": "public/client.js",
  "/style.css": "public/style.css",
  "/scene.js": "public/scene.js",
  "/audio.js": "public/audio.js",
  "/world-data.js": "public/world-data.js",
  "/three.js": "node_modules/three/build/three.module.js",
  "/three.core.js": "node_modules/three/build/three.core.js",
};
export function createGameServer() {
  const rooms = new Map(),
    clients = new Map();
  const server = http.createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      if (path === "/health") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(
          JSON.stringify({
            ok: true,
            rooms: rooms.size,
            players: clients.size,
          }),
        );
        return;
      }
      const file = files[path];
      if (!file || !["GET", "HEAD"].includes(req.method)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const body = await readFile(new URL(file, import.meta.url));
      res.writeHead(200, {
        "Content-Type": file.endsWith(".html")
          ? "text/html; charset=utf-8"
          : file.endsWith(".css")
            ? "text/css; charset=utf-8"
            : "text/javascript; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(500);
      res.end("Server error");
    }
  });
  const wss = new WebSocketServer({ server, maxPayload: 2048 });
  const send = (ws, message) => {
    if (ws.readyState === 1 && ws.bufferedAmount < 256000)
      ws.send(JSON.stringify(message));
  };
  function leave(client) {
    if (!client.room) return;
    const room = client.room;
    room.remove(client.id);
    if (!room.players.size) rooms.delete(room.code);
    client.room = null;
  }
  wss.on("connection", (ws) => {
    const client = {
      id: randomUUID(),
      ws,
      room: null,
      packets: 0,
      windowAt: Date.now(),
      alive: true,
    };
    clients.set(client.id, client);
    send(ws, { type: "welcome", id: client.id });
    ws.on("pong", () => {
      client.alive = true;
    });
    ws.on("message", (raw) => {
      const now = Date.now();
      if (now - client.windowAt > 1000) {
        client.windowAt = now;
        client.packets = 0;
      }
      if (++client.packets > 100) {
        ws.close(1008, "Too many messages");
        return;
      }
      try {
        const m = JSON.parse(raw);
        if (!m || typeof m !== "object" || Array.isArray(m)) return;
        if (m.type === "ping") {
          send(ws, { type: "pong", at: m.at, serverTime: now });
          return;
        }
        if (m.type === "leave") {
          leave(client);
          send(ws, { type: "left" });
          return;
        }
        if (m.type === "create") {
          if (rooms.size >= 100)
            throw new Error("Le serveur est plein. Réessaie plus tard.");
          leave(client);
          let code;
          do {
            code = makeCode();
          } while (rooms.has(code));
          const room = new GameRoom(code, client.id, {
            practice: m.practice === true,
          });
          room.add(client.id, m.name);
          client.room = room;
          rooms.set(code, room);
          send(ws, { type: "joined", code });
          if (room.practice) room.start(client.id);
        } else if (m.type === "join") {
          const code = String(m.code || "")
            .trim()
            .toUpperCase();
          const room = rooms.get(code);
          if (!room) throw new Error("Salon introuvable. Vérifie le code.");
          if (client.room === room) return;
          // Validate before leaving the existing room to preserve a failed join.
          room.add(client.id, m.name);
          leave(client);
          client.room = room;
          send(ws, { type: "joined", code });
        } else if (m.type === "start") {
          client.room?.start(client.id);
        } else if (m.type === "input") {
          client.room?.setInput(client.id, m, now);
        } else if (m.type === "action" && typeof m.action === "string") {
          client.room?.action(client.id, m.action, now);
        }
      } catch (error) {
        send(ws, {
          type: "error",
          message:
            error instanceof SyntaxError
              ? "Message réseau invalide."
              : error.message,
        });
      }
    });
    ws.on("close", () => {
      leave(client);
      clients.delete(client.id);
    });
    ws.on("error", () => {});
  });
  let last = Date.now();
  const interval = setInterval(() => {
    const now = Date.now(),
      dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    for (const room of rooms.values()) {
      room.tick(dt, now);
      const message = { type: "state", room: room.snapshot(now) };
      for (const id of room.players.keys()) {
        const client = clients.get(id);
        if (client) send(client.ws, message);
      }
    }
  }, 50);
  const heartbeat = setInterval(() => {
    for (const client of clients.values()) {
      if (!client.alive) client.ws.terminate();
      else {
        client.alive = false;
        client.ws.ping();
      }
    }
  }, 30000);
  async function close() {
    clearInterval(interval);
    clearInterval(heartbeat);
    for (const client of clients.values()) client.ws.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
  return { server, wss, rooms, clients, close };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app = createGameServer();
  const port = Number(process.env.PORT) || 3000;
  app.server.listen(port, "0.0.0.0", () =>
    console.log(
      `Crowd Cover · http://localhost:${port} · salons multijoueurs actifs`,
    ),
  );
  const stop = () => app.close().then(() => process.exit());
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
