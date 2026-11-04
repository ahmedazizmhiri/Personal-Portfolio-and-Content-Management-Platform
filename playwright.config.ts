import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const externalServer = Boolean(process.env.PLAYWRIGHT_BASE_URL);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: externalServer
    ? undefined
    : {
      command: "npm run build && npm run start",
      url: baseURL,
      env: {
        ...process.env,
        E2E_USE_FIXTURES: "true",
        NEXT_PUBLIC_FIREBASE_PROJECT_ID:
          process.env.E2E_FIREBASE_PROJECT_ID ?? "",
        NEXT_PUBLIC_FIREBASE_API_KEY:
          process.env.E2E_FIREBASE_API_KEY ?? "",
        NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:
          process.env.E2E_FIREBASE_STORAGE_BUCKET ?? "",
        NEXT_PUBLIC_CAPTCHA_PROVIDER: "",
        NEXT_PUBLIC_CAPTCHA_SITE_KEY: "",
        HCAPTCHA_SECRET_KEY: "",
        NEXT_PUBLIC_GTM_ID: "",
        NEXT_PUBLIC_GA_MEASUREMENT_ID: "",
        NEXT_PUBLIC_CLARITY_PROJECT_ID: "",
        NEXT_PUBLIC_SITE_URL: baseURL,
        APP_URL: baseURL,
        ALLOWED_ORIGINS: baseURL,
        VERCEL_ENV: "production",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
    },
});
