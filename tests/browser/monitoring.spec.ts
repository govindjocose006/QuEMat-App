import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { navigate } from "./navigation.js";

async function login(page: Page) {
  await page.goto("/");
  await page
    .getByLabel("Email", { exact: true })
    .fill("browser-admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Browser-tests-only-passphrase!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Lab overview", exact: true }),
  ).toBeVisible();
  await page.locator("summary").filter({ hasText: "Lab activity" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Usage & next reservations",
      exact: true,
    }),
  ).toBeVisible();
}
async function write(page: Page, path: string, data: object, method = "POST") {
  const session = await (await page.request.get("/api/session")).json();
  const r = await page.request.fetch("/api" + path, {
    method,
    data,
    headers: {
      Origin: "http://127.0.0.1:3199",
      "X-CSRF-Token": session.csrfToken,
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
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

test("open dashboard refreshes instrument state with bookings, handovers and sample IDs, then recovers from an outage", async ({
  page,
}, info) => {
  // Install before page scripts create their polling timers (also survives reload).
  await page.clock.install();
  await login(page);
  const instruments = await (await page.request.get("/api/instruments")).json();
  const resource = await write(page, "/instruments", {
    ...instruments.find((i: { name: string }) => i.name === "PPMS"),
    name: `Monitoring ${info.project.name} PPMS`,
    priority: true,
    status: "available",
    schedulingMode: "internal",
    coordinatorApproval: false,
    setupMinutes: 0,
    cleanupMinutes: 0,
  });
  const sample = await write(page, "/samples", {
    compound: `Monitoring sample ${info.project.name}`,
  });
  const user = (await (await page.request.get("/api/session")).json()).user;
  const now = Date.now();
  const fields = {
    instrumentId: resource.id,
    operatorId: user.id,
    sampleIds: [sample.id],
    measurementType: "Synthetic monitor scan",
    details: {},
  };
  let booking = await write(page, "/bookings", {
    ...fields,
    startsAt: new Date(now - 60000).toISOString(),
    endsAt: new Date(now + 60000).toISOString(),
  });
  booking = await write(page, `/bookings/${booking.id}/actions`, {
    version: booking.version,
    action: "checkin",
  });
  await write(page, `/bookings/${booking.id}/actions`, {
    version: booking.version,
    action: "complete",
    summary: "Synthetic scan finished",
    handoverNotes: "Inspect the holder before mounting the next sample",
  });
  await write(page, "/bookings", {
    ...fields,
    startsAt: new Date(now + 86400000).toISOString(),
    endsAt: new Date(now + 90000000).toISOString(),
  });
  await page.reload();
  await page.locator("summary").filter({ hasText: "Lab activity" }).click();
  const card = page.locator("article.panel").filter({
    has: page.getByRole("heading", { name: resource.name, exact: true }),
  });
  await expect(card).toContainText("Last handover");
  await expect(card).toContainText(
    "Inspect the holder before mounting the next sample",
  );
  await expect(card).toContainText(`Next samples: ${sample.code}`);
  await expect(card).toContainText("No confirmed usage");
  await write(
    page,
    `/instruments/${resource.id}`,
    { ...resource, status: "maintenance" },
    "PUT",
  );
  const polled = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/monitoring") && response.status() === 200,
  );
  await page.clock.fastForward(31000);
  await polled;
  await expect(card).toContainText("maintenance");
  await expect(card).not.toContainText("No confirmed usage");
  let unavailable = true;
  await page.route("**/api/monitoring", async (route) =>
    unavailable
      ? route.fulfill({
          status: 503,
          json: { error: "Synthetic monitoring outage" },
        })
      : route.continue(),
  );
  await page
    .getByRole("button", { name: "Refresh monitoring", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic monitoring outage",
  );
  await expect(card).toContainText("Last handover");
  unavailable = false;
  await page
    .getByRole("button", { name: "Refresh monitoring", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(card).toContainText("maintenance");
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("monitoring-handover.png"),
    fullPage: true,
  });
});

test("inbox reaches the 205th update, refreshes the badge, recovers and uses More on phones", async ({
  page,
}, info) => {
  const rows = Array.from({ length: 205 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(205 - i).padStart(12, "0")}`,
    bookingId: "00000000-0000-4000-8000-999999999999",
    weeklyReportId: null,
    issueId: null,
    meetingId: null,
    noticeId: null,
    message: `Synthetic inbox update ${205 - i}`,
    createdAt: "2026-10-25T00:00:00Z",
    readAt: null as string | null,
  }));
  let failNextPage = false;
  await page.route("**/api/notifications/summary", (route) =>
    route.fulfill({
      json: { unreadCount: rows.filter((n) => !n.readAt).length },
    }),
  );
  await page.route("**/api/notifications/page?*", (route) => {
    if (failNextPage) {
      failNextPage = false;
      return route.fulfill({
        status: 503,
        json: { error: "Synthetic inbox outage" },
      });
    }
    const q = new URL(route.request().url()).searchParams;
    const before = q.get("before");
    let items = before
      ? rows.slice(rows.findIndex((n) => n.id === before) + 1)
      : rows;
    if (q.get("unread") === "true") items = items.filter((n) => !n.readAt);
    return route.fulfill({
      json: {
        items: items.slice(0, 50),
        nextCursor: items.length > 50 ? items[49].id : null,
        unreadCount: rows.filter((n) => !n.readAt).length,
      },
    });
  });
  await page.route("**/api/notifications/*/read", (route) => {
    const id = route.request().url().split("/").at(-2);
    rows.find((n) => n.id === id)!.readAt = new Date().toISOString();
    return route.fulfill({ json: { ok: true } });
  });
  await login(page);
  await expect(page.locator("#unread-notification-status")).toContainText(
    "205 unread",
  );
  await page.getByRole("button", { name: "Open inbox", exact: true }).click();
  await expect(
    page.getByText("Synthetic inbox update 205", { exact: true }),
  ).toBeVisible();
  for (let n = 0; n < 4; n++) {
    const older = page.getByRole("button", {
      name: "Older notifications",
      exact: true,
    });
    await expect(older).toBeEnabled();
    await older.click();
    await expect(
      page.getByText(`Page ${n + 2}`, { exact: true }),
    ).toBeVisible();
  }
  const oldest = page.locator("article.panel").filter({
    has: page.getByText("Synthetic inbox update 1", { exact: true }),
  });
  await expect(oldest).toBeVisible();
  await oldest.getByRole("button", { name: "Mark read", exact: true }).click();
  await expect(oldest).toContainText("Read");
  await expect(page.locator("#unread-notification-status")).toContainText(
    "204 unread",
  );
  if (info.project.name === "phone")
    await expect(
      page.getByRole("button", { name: "Open inbox", exact: true }),
    ).toBeInViewport();
  await page
    .getByRole("combobox", { name: "Notification view", exact: true })
    .selectOption("unread");
  await expect(page.getByText("Page 1", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Synthetic inbox update 205", { exact: true }),
  ).toBeVisible();
  failNextPage = true;
  await page
    .getByRole("button", { name: "Refresh inbox", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Synthetic inbox outage");
  await page
    .getByRole("button", { name: "Refresh inbox", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("inbox-pagination.png"),
    fullPage: true,
  });
  if (info.project.name === "phone") {
    const more = page.getByRole("button", { name: "More", exact: true });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.click();
    await expect(
      page.getByRole("button", { name: "Meetings & Notices", exact: true }),
    ).toBeVisible();
    await accessible(page);
    await page.screenshot({
      path: info.outputPath("phone-more-navigation.png"),
      fullPage: true,
    });
  }
  await navigate(page, "Samples");
  await expect(
    page.getByRole("heading", { name: "Samples", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open inbox", exact: true }),
  ).toBeVisible();
});

test("successful meeting and sample retries remove earlier connection errors", async ({
  page,
}) => {
  let summaryFailed = false;
  await page.route("**/api/collaboration/summary", (route) => {
    if (!summaryFailed) {
      summaryFailed = true;
      return route.fulfill({
        status: 503,
        json: { error: "Synthetic meeting outage" },
      });
    }
    return route.continue();
  });
  await login(page);
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic meeting outage",
  );
  await page
    .getByRole("button", { name: "Retry meeting summary", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  let samplesFailed = false;
  await page.route("**/api/samples", (route) => {
    if (!samplesFailed && route.request().method() === "GET") {
      samplesFailed = true;
      return route.fulfill({
        status: 503,
        json: { error: "Synthetic sample outage" },
      });
    }
    return route.continue();
  });
  await navigate(page, "Samples");
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic sample outage",
  );
  await page
    .getByRole("button", { name: "Retry samples", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await accessible(page);
});
