import { expect, test, type Page } from "@playwright/test";
import { navigate } from "./navigation.js";

async function login(page: Page, email = "browser-admin@example.test") {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Browser-tests-only-passphrase!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("sections survive reload and browser history without exposing record details", async ({
  page,
}) => {
  await page.goto("/");
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Lab overview", exact: true }),
  ).toBeVisible();
  await navigate(page, "Samples");
  await expect(page).toHaveURL(/#samples$/);
  await navigate(page, "Chemicals & Orders");
  await expect(page).toHaveURL(/#orders$/);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Chemicals & Orders", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Chemicals & Orders | QuEMat Lab Hub");
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Samples", exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Chemicals & Orders", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page).toHaveTitle("QuEMat Lab Hub");
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Shared sample register" }),
  ).toHaveCount(0);
});

test("bookmarked sections require sign-in and administrative sections stay restricted", async ({
  page,
}, info) => {
  await page.goto("/#orders");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Chemicals & Orders", exact: true }),
  ).toHaveCount(0);
  await login(page, `browser-weekly-member-${info.project.name}@example.test`);
  await expect(
    page.getByRole("heading", { name: "Chemicals & Orders", exact: true }),
  ).toBeVisible();
  await page.goto("/#members");
  await expect(page).toHaveURL(/#overview$/);
  await expect(
    page.getByRole("heading", { name: "Lab overview", exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/admin/members")).status()).toBe(403);
  await page.goto("/#unrecognized-section");
  await expect(page).toHaveURL(/#overview$/);
  await navigate(page, "Samples");
  await page.locator(".skip-link").focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Samples", exact: true }),
  ).toBeVisible();
});

test("sample loading and failed requests never pretend the register is empty", async ({
  page,
}) => {
  await page.goto("/");
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Lab overview", exact: true }),
  ).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/api/samples",
    async (route) => {
      await gate;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic temporary outage" }),
      });
    },
    { times: 1 },
  );
  await navigate(page, "Samples");
  await expect(
    page.getByText("Loading samples…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No active samples.", { exact: true }),
  ).toHaveCount(0);
  release();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic temporary outage",
  );
  await expect(
    page.getByText("No active samples.", { exact: true }),
  ).toHaveCount(0);
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/samples") && r.status() === 200,
  );
  await page
    .getByRole("button", { name: "Retry samples", exact: true })
    .click();
  await response;
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Loading samples…", { exact: true })).toHaveCount(
    0,
  );
});
