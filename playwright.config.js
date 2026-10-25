import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 120000,
  expect: { timeout: 15000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3100",
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: [
        "--no-sandbox",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
  },
  webServer: {
    command: "node server.js",
    url: "http://127.0.0.1:3100/health",
    env: { PORT: "3100" },
    reuseExistingServer: false,
  },
});
