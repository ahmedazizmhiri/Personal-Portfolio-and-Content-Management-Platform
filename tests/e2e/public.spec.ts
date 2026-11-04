import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const publicRoutes = [
  "/",
  "/about",
  "/expertise",
  "/projects",
  "/experience",
  "/education",
  "/certifications",
  "/resume",
  "/contact",
];

for (const route of publicRoutes) {
  test(`${route} loads with unique metadata and no serious axe violations`, async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    const response = await page.goto(route, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    await expect(page.locator("main")).toBeVisible();
    await expect(page).toHaveTitle(/\S+/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      /\S+/,
    );

    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter((violation) =>
        ["critical", "serious"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}

for (const route of ["/", "/admin/login"]) {
  test(`skip navigation reaches the main content on ${route}`, async ({
    page,
  }) => {
    await page.goto(route);
    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", {
      name: /skip to (main )?content/i,
    });
    await expect(skipLink).toBeFocused();
    await skipLink.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });
}

test("published case studies never render empty CMS sections", async ({ page }) => {
  const response = await page.goto(
    "/projects/e2e-commercial-analytics-case-study",
  );
  expect(response?.status()).toBe(200);
  const sections = page.locator("[data-project-section]");
  expect(await sections.count()).toBeGreaterThan(0);
  for (let index = 0; index < await sections.count(); index += 1) {
    await expect(
      sections.nth(index).locator("p, ul, ol, dl, figure, video, a").first(),
    ).toBeVisible();
  }
});

test("mobile navigation traps focus and restores it on Escape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const trigger = page.getByRole("button", { name: "Toggle navigation" });
  await trigger.click();
  const menu = page.locator("#mobile-navigation");
  await expect(menu).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  const links = menu.getByRole("link");
  await expect(links.first()).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect(links.last()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(links.first()).toBeFocused();
  await page.keyboard.press("Escape");

  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");

  await trigger.click();
  const backdrop = page.getByRole("button", { name: "Close navigation" });
  await expect(backdrop).toBeVisible();
  const backdropBox = await backdrop.boundingBox();
  expect(backdropBox).not.toBeNull();
  await backdrop.click({
    position: {
      x: Math.max(1, backdropBox!.width - 8),
      y: Math.max(1, backdropBox!.height - 8),
    },
  });
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("identity schema is global and ProfilePage belongs to About", async ({
  page,
}) => {
  await page.goto("/about");
  const schemas = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();
  const schemaText = schemas.join("\n");

  expect(schemaText).toContain('"@type":"Person"');
  expect(schemaText).toContain('"@type":"WebSite"');
  expect(schemaText).toContain('"@type":"ProfilePage"');
  expect(schemaText).toContain(
    "https://ahmedaziz-portfolio.vercel.app/about",
  );

  await page.goto("/");
  const homeSchemas = (
    await page.locator('script[type="application/ld+json"]').allTextContents()
  ).join("\n");
  expect(homeSchemas).toContain('"@type":"Person"');
  expect(homeSchemas).not.toContain('"@type":"ProfilePage"');
});

test("crawler controls exclude private surfaces", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toMatch(/Disallow:\s*\/admin/i);
  expect(robots).toMatch(/Disallow:\s*\/api/i);

  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).not.toContain("/admin");
  expect(sitemap).not.toContain("/api/");

  const admin = await request.get("/admin/login");
  expect(admin.headers()["x-robots-tag"]).toMatch(/noindex/i);
  expect(await admin.text()).not.toMatch(/access_token/i);
});

test("unknown public routes render the branded 404 without a server error", async ({
  page,
}) => {
  const response = await page.goto("/this-route-does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /page not found/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /return home/i })).toBeVisible();
});

test("contact form reports client validation errors without submitting", async ({
  page,
}) => {
  await page.goto("/contact");
  const name = page.getByLabel("Name");
  const email = page.getByRole("textbox", { name: "Email", exact: true });
  const message = page.getByLabel("Message");
  await expect(name).toHaveAttribute("required", "");
  await expect(email).toHaveAttribute("required", "");
  await expect(email).toHaveAttribute("type", "email");
  await expect(message).toHaveAttribute("required", "");
  await email.fill("not-an-email");
  expect(
    await email.evaluate(
      (element: HTMLInputElement) => element.validity.typeMismatch,
    ),
  ).toBe(true);
  await expect(page.getByRole("button", { name: /send message/i })).toBeDisabled();
  await expect(page).toHaveURL(/\/contact$/);
});

test("private entry routes are protected and remain noindex", async ({
  page,
}) => {
  const admin = await page.goto("/admin");
  expect(admin?.status()).toBe(200);
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByRole("heading", { name: /secure login/i })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/i,
  );

  const forgot = await page.goto("/admin/forgot-password");
  expect(forgot?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: /forgot|reset/i }),
  ).toBeVisible();
});

test("an invalid admin login request fails closed without issuing a session", async ({
  request,
  baseURL,
}) => {
  const response = await request.post("/api/auth/login", {
    headers: {
      Origin: baseURL ?? "http://127.0.0.1:3000",
      "Content-Type": "application/json",
    },
    data: {
      email: "invalid@example.invalid",
      password: "not-a-real-password",
      captchaToken: "invalid-test-token",
      next: "/admin",
    },
  });
  expect([400, 401, 403, 429, 503]).toContain(response.status());
  expect(response.headers()["set-cookie"] ?? "").not.toMatch(
    /sb-|access|refresh/i,
  );
});
