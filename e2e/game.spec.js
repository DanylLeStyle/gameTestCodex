import { test, expect } from "@playwright/test";
async function track(page) {
  await page.addInitScript(() => {
    const Original = window.WebSocket;
    window.__packets = [];
    window.__lastInput = null;
    window.WebSocket = class extends Original {
      send(data) {
        try {
          const message = JSON.parse(data);
          if (message.type === "input") window.__lastInput = message;
        } catch {}
        return super.send(data);
      }
      constructor(...args) {
        super(...args);
        this.addEventListener("message", (e) => {
          try {
            const message = JSON.parse(e.data);
            if (message.type === "welcome") window.__id = message.id;
            window.__packets.push(message);
            if (window.__packets.length > 150) window.__packets.shift();
          } catch {}
        });
      }
    };
    const Context = window.AudioContext;
    window.__audioContexts = [];
    window.AudioContext = class extends Context {
      constructor(...args) {
        super(...args);
        this.__analyser = this.createAnalyser();
        window.__audioContexts.push(this);
      }
      createDynamicsCompressor() {
        const node = super.createDynamicsCompressor(),
          connect = node.connect.bind(node);
        node.connect = (target, ...args) => {
          if (target === this.destination) connect(this.__analyser);
          return connect(target, ...args);
        };
        return node;
      }
    };
  });
}
const room = (page) =>
  page.evaluate(
    () => window.__packets.filter((p) => p.type === "state").at(-1)?.room,
  );
const player = async (page) => {
  const data = await room(page);
  const id = await page.evaluate(() => window.__id);
  return data?.players.find((p) => p.id === id);
};

test("two independent browsers create a room, join, start and control both roles", async ({
  browser,
}, info) => {
  const a = await browser.newContext({ viewport: { width: 960, height: 640 } }),
    b = await browser.newContext({ viewport: { width: 960, height: 640 } });
  for (const context of [a, b])
    await context.addInitScript(() =>
      localStorage.setItem(
        "crowd-cover-settings",
        JSON.stringify({ quality: "low" }),
      ),
    );
  const hunter = await a.newPage(),
    hidden = await b.newPage();
  const errors = [];
  for (const page of [hunter, hidden]) {
    page.on("pageerror", (error) => errors.push(error.message));
    await track(page);
  }
  await hunter.goto("/");
  await expect(hunter.locator("#connection")).toHaveText("SERVEUR EN LIGNE");
  await hunter.locator("#create").click();
  await expect(hunter.locator("#lobby")).toBeVisible();
  await expect(hunter.locator("#start-round")).toBeDisabled();
  const code = await hunter.locator("#room-code").innerText();
  expect(code).toMatch(/^[A-Z2-9]{5}$/);
  await hidden.goto("/?room=" + code);
  await expect(hidden.locator("#join-panel")).toBeVisible();
  await expect(hidden.locator("#join-code")).toHaveValue(code);
  await hidden.locator("#join-form button[type=submit]").click();
  await expect(hunter.locator(".roster-row")).toHaveCount(2);
  await expect(hidden.locator(".roster-row")).toHaveCount(2);
  await hunter.locator("#start-round").click();
  await expect(hunter.locator("#pause")).toBeVisible();
  await expect(hidden.locator("#pause")).toBeVisible();
  await expect.poll(async () => (await player(hunter))?.role).toBe("hunter");
  await expect.poll(async () => (await player(hidden))?.role).toBe("hidden");
  await expect(hidden.locator("#mission-title")).toHaveText(
    "Deviens invisible.",
  );
  await hidden.bringToFront();
  await hidden.locator("#resume").click();
  await expect
    .poll(() => hidden.evaluate(() => !!document.pointerLockElement))
    .toBe(true);
  await hidden.evaluate(() =>
    document.dispatchEvent(
      new MouseEvent("mousemove", { movementX: 100, movementY: -60 }),
    ),
  );
  await expect(hidden.locator("#pause")).toBeHidden();
  const before = await player(hidden);
  await hidden.keyboard.down("KeyW");
  await expect
    .poll(() => hidden.evaluate(() => window.__lastInput?.forward))
    .toBe(1);
  await expect
    .poll(async () => (await player(hidden)).x - before.x)
    .toBeGreaterThan(0.1);
  await hidden.keyboard.up("KeyW");
  const input = await player(hidden);
  expect(input.yaw).toBeLessThan(0);
  expect(await hidden.evaluate(() => window.__lastInput.pitch)).toBeGreaterThan(
    0,
  );
  await hidden.keyboard.down("Space");
  await expect.poll(async () => (await player(hidden)).state).toBe("panic");
  await hidden.keyboard.up("Space");
  await hidden.keyboard.down("KeyE");
  await expect.poll(async () => (await player(hidden)).state).toBe("interact");
  await hidden.keyboard.up("KeyE");
  await hidden.screenshot({ path: info.outputPath("infiltre.png") });
  await hidden.keyboard.press("Escape");
  await hidden.evaluate(() => document.exitPointerLock());
  await hunter.bringToFront();
  await hunter.locator("#resume").click();
  await expect
    .poll(() => hunter.evaluate(() => !!document.pointerLockElement))
    .toBe(true);
  await expect
    .poll(async () => (await room(hunter)).startsAt < Date.now())
    .toBe(true);
  await hunter.keyboard.press("KeyG");
  await expect
    .poll(async () =>
      (await room(hunter)).events.some((e) => e.type === "pulse"),
    )
    .toBe(true);
  await expect
    .poll(() => hunter.evaluate(() => window.__audioContexts[0]?.state))
    .toBe("running");
  // Verify actual audio output is non-silent, not merely a running AudioContext.
  await expect
    .poll(() =>
      hunter.evaluate(() => {
        const a = window.__audioContexts[0].__analyser,
          data = new Float32Array(a.fftSize);
        a.getFloatTimeDomainData(data);
        return Math.max(...data.map(Math.abs));
      }),
    )
    .toBeGreaterThan(0.00001);
  await hunter.screenshot({ path: info.outputPath("chasseur.png") });
  expect(errors).toEqual([]);
  await a.close();
  await b.close();
});

test("menu settings persist; solo training starts without a second client", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await track(page);
  await page.goto("/");
  await expect(page.locator("#connection")).toHaveText("SERVEUR EN LIGNE");
  await page.locator("#settings-open").click();
  await page.locator("#player-name").fill("Caméléon");
  await page.locator("#quality").selectOption("low");
  await page.locator("[data-close=settings]").click();
  await page.reload();
  await page.locator("#settings-open").click();
  await expect(page.locator("#player-name")).toHaveValue("Caméléon");
  await expect(page.locator("#quality")).toHaveValue("low");
  await page.locator("[data-close=settings]").click();
  await page.screenshot({ path: info.outputPath("menu.png") });
  await page.locator("#practice").click();
  await expect(page.locator("#pause")).toBeVisible();
  await expect.poll(async () => (await room(page))?.practice).toBe(true);
  expect((await room(page)).npcs.filter((n) => n.practiceTarget)).toHaveLength(
    3,
  );
  await page.locator("#leave-game").click();
  await expect(page.locator("#menu")).toBeVisible();
  await expect(page.locator("#game-hud")).toBeHidden();
  expect(errors).toEqual([]);
});
