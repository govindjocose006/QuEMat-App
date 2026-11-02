import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { navigate } from "./navigation.js";
test.setTimeout(60000);
async function login(page: Page, phone: boolean) {
  if (phone) await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/");
  await page
    .getByLabel("Email", { exact: true })
    .fill("browser-admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Browser-tests-only-passphrase!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
}
async function accessible(page: Page) {
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
test("instrument shortcut filters schedule and preselects booking; duration responds to date changes", async ({
  page,
}, info) => {
  await login(page, info.project.name === "phone");
  const instruments = await (await page.request.get("/api/instruments")).json();
  const squid = instruments.find((i: { name: string }) => i.name === "SQUID");
  await navigate(page, "Instruments");
  await page
    .getByRole("button", { name: "View schedule for SQUID", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Filter instrument", exact: true }),
  ).toHaveValue(squid.id);
  await expect(
    page.getByRole("button", { name: "Add maintenance", exact: true }),
  ).not.toBeVisible();
  const management = page
    .locator("summary")
    .filter({ hasText: "Manage availability" });
  await management.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Add maintenance", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Book instrument", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("combobox", { name: "Instrument", exact: true }),
  ).toHaveValue(squid.id);
  await page
    .getByLabel("Start (Asia/Kolkata)", { exact: true })
    .fill("2038-03-04T23:30");
  await page
    .getByLabel("End including cooling (Asia/Kolkata)", { exact: true })
    .fill("2038-03-05T01:00");
  await expect(
    dialog.getByRole("status").filter({ hasText: "Reserved duration" }),
  ).toContainText("1 h 30 min");
  if (info.project.name === "desktop") {
    const start = await page
      .getByLabel("Start (Asia/Kolkata)", { exact: true })
      .boundingBox();
    const end = await page
      .getByLabel("End including cooling (Asia/Kolkata)", { exact: true })
      .boundingBox();
    expect(Math.abs(start!.y - end!.y)).toBeLessThan(2);
  }
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("workspace-refined-booking.png"),
  });
});
test("report section shortcuts move keyboard focus without losing unsaved writing", async ({
  page,
}, info) => {
  await login(page, info.project.name === "phone");
  await navigate(page, "Weekly Progress");
  await page
    .getByLabel("Work completed", { exact: true })
    .fill("Synthetic unsaved review notes");
  const sections = page.getByRole("navigation", { name: "Report sections" });
  await sections
    .getByRole("button", { name: "Next steps", exact: true })
    .click();
  await expect(
    page.getByLabel("Next week’s plan", { exact: true }),
  ).toBeFocused();
  await expect(page.getByLabel("Work completed", { exact: true })).toHaveValue(
    "Synthetic unsaved review notes",
  );
  await expect(
    page.getByText("Unsaved changes", { exact: true }),
  ).toBeVisible();
  await sections
    .getByRole("button", { name: "Completed work", exact: true })
    .click();
  await expect(
    page.getByLabel("Work completed", { exact: true }),
  ).toBeFocused();
  const writing = await page
    .getByLabel("Work completed", { exact: true })
    .boundingBox();
  const actions = await page.locator(".report-actions").boundingBox();
  const header = await page.locator(".topbar").boundingBox();
  expect(writing!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
  expect(writing!.y + writing!.height).toBeLessThanOrEqual(actions!.y);
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("workspace-refined-weekly.png"),
  });
});
test("compact notification rows preserve destination and explicit read action", async ({
  page,
}, info) => {
  await login(page, info.project.name === "phone");
  let marked = false;
  await page.route("**/api/notifications/page?**", (route) =>
    route.fulfill({
      json: {
        unreadCount: marked ? 0 : 1,
        nextCursor: null,
        items: [
          {
            id: "ui-synthetic-notification",
            bookingId: "ui-synthetic-booking",
            message: "SQUID: cancel. Synthetic measurement.",
            createdAt: "2026-11-01T06:00:00Z",
            readAt: marked ? "2026-11-01T07:00:00Z" : null,
          },
        ],
      },
    }),
  );
  await page.route(
    "**/api/notifications/ui-synthetic-notification/read",
    (route) => {
      marked = true;
      return route.fulfill({ json: { ok: true } });
    },
  );
  await navigate(page, "Notifications");
  const row = page.locator("article.notification-row");
  await expect(row).toContainText("Booking cancelled");
  await expect(row.getByRole("button", { name: "View booking" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Mark read" })).toBeVisible();
  expect(marked).toBe(false);
  const refresh = await page
    .getByRole("button", { name: "Refresh inbox" })
    .boundingBox();
  expect(refresh!.height).toBeLessThan(60);
  const view = await page
    .getByRole("combobox", { name: "Notification view", exact: true })
    .boundingBox();
  expect(
    Math.abs(view!.y + view!.height - refresh!.y - refresh!.height),
  ).toBeLessThan(2);
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("workspace-refined-notifications.png"),
  });
  await row.getByRole("button", { name: "Mark read" }).click();
  await expect(row.getByRole("button", { name: "Mark read" })).toHaveCount(0);
  await expect(
    page.getByText("0 unread updates", { exact: true }),
  ).toBeVisible();
});
