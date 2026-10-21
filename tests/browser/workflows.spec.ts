import { expect, test, type Page } from "@playwright/test";

const password = "Browser-tests-only-passphrase!";
async function login(page: Page, email = "browser-admin@example.test") {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Lab overview", exact: true }),
  ).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}
test("private access, onboarding, approval, member restrictions, and logout", async ({
  page,
  browser,
}, info) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  expect((await page.request.get("/api/instruments")).status()).toBe(401);
  await noOverflow(page);
  const email = `${info.project.name}-${Date.now()}@example.test`;
  const fullName = `${info.project.name} Test Intern`;
  await page.getByRole("button", { name: "Request access" }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { name: "Introduce yourself" }),
  ).toBeVisible();
  await page.getByLabel("Full name", { exact: true }).fill(fullName);
  await page
    .getByRole("combobox", { name: "Academic role", exact: true })
    .selectOption("Intern");
  await page
    .getByLabel("Research topic / project")
    .fill("Synthetic browser validation");
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Your request is with the administrator",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Mentor assignment pending administrator review."),
  ).toBeVisible();
  expect((await page.request.get("/api/instruments")).status()).toBe(403);
  const adminContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3199",
    viewport: page.viewportSize()!,
  });
  const admin = await adminContext.newPage();
  await login(admin);
  await admin
    .getByRole("button", { name: "Members & access", exact: true })
    .click();
  await admin
    .getByRole("button", { name: `Manage ${fullName}`, exact: true })
    .click();
  await admin
    .getByRole("combobox", { name: "Membership status", exact: true })
    .selectOption("approved");
  await admin
    .getByLabel("Reason for this change")
    .fill("Synthetic test: identity confirmed in a trusted lab channel.");
  await admin.getByLabel("I have verified").check();
  await admin.getByRole("button", { name: "Save membership" }).click();
  await expect(admin.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Check approval status" }).click();
  await expect(
    page.getByRole("heading", { name: "Lab overview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Members & access", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "PPMS", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "RF / Magnetron sputtering",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Akhil N", { exact: true })).not.toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("member-overview.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Instruments", exact: true }).click();
  await page.getByRole("textbox", { name: "Search instruments" }).fill("BET");
  await expect(
    page.getByRole("heading", { name: "BET", exact: true }),
  ).toBeVisible();
  await page.getByText("Instrument details", { exact: true }).click();
  await expect(page.getByText("Akhila", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit instrument" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Lab overview", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "My account", exact: true }).click();
  await page.getByLabel("Current password", { exact: true }).fill(password);
  await page
    .getByLabel("New password", { exact: true })
    .fill("Changed-browser-test-password!");
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("Changed-browser-test-password!");
  await page
    .getByRole("button", { name: "Update password", exact: true })
    .click();
  await expect(
    page.getByText(
      "Password changed. Other sign-in sessions have been revoked.",
    ),
  ).toBeVisible();
  const otherTab = await page.context().newPage();
  await otherTab.goto("/");
  await expect(
    otherTab.getByRole("heading", { name: "Lab overview", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(
    otherTab.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await otherTab.close();
  expect((await page.request.get("/api/instruments")).status()).toBe(401);
  expect(failures).toEqual([]);
  await adminContext.close();
});
test("administrator creates, edits, archives, restores an instrument, and reviews audit", async ({
  page,
}, info) => {
  await login(page);
  await page.screenshot({
    path: info.outputPath("admin-overview.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Instruments", exact: true }).click();
  await page.getByRole("button", { name: "Add instrument" }).click();
  const name = `Test resource ${info.project.name}`;
  await page.getByLabel("Instrument name", { exact: true }).fill(name);
  await page.getByLabel("Category", { exact: true }).fill("Synthetic testing");
  await page.getByLabel("Location", { exact: true }).fill("Test room");
  await page.getByLabel("Maximum temperature (°C)").fill("1050");
  await page.getByLabel("Trained-user names").fill("Test Directory Entry");
  await page
    .getByLabel("SOP links")
    .fill("Test SOP | https://example.test/private/sop");
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("instrument-form.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Save instrument", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search instruments" }).fill(name);
  await page
    .getByRole("button", { name: "Edit instrument", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Operational status", exact: true })
    .selectOption("maintenance");
  await page.getByLabel("Archive this instrument").check();
  await page
    .getByRole("button", { name: "Save instrument", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No matching instruments" }),
  ).toBeVisible();
  await page.getByLabel("Include archived").check();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Edit instrument", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Operational status", exact: true }),
  ).toHaveValue("maintenance");
  await page.getByLabel("Archive this instrument").uncheck();
  await page
    .getByRole("button", { name: "Save instrument", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".status.maintenance")).toBeVisible();
  await noOverflow(page);
  await page
    .getByRole("button", { name: "Audit history", exact: true })
    .click();
  await expect(
    page.getByText("instrument · restored", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "My account", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Change password" }),
  ).toBeVisible();
  await noOverflow(page);
  // Keyboard navigation and native dialog focus trapping.
  await page.getByRole("button", { name: "Instruments", exact: true }).click();
  await page.getByRole("button", { name: "Add instrument" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add instrument" }),
  ).toBeFocused();
});
