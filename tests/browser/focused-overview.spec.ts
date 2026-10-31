import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { navigate } from "./navigation.js";
async function login(
  page: Page,
  role: string,
  device: string,
  section = "overview",
) {
  await page.goto("/#" + section);
  await page
    .getByLabel("Email", { exact: true })
    .fill(`browser-weekly-${role}-${device}@example.test`);
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
for (const role of ["member", "supervisor", "other"] as const)
  test(`${role} sees role-appropriate priorities and can reach the complete lab view`, async ({
    page,
  }, info) => {
    await login(page, role, info.project.name);
    await expect(page.locator(".focus-grid > section")).toHaveCount(3);
    await expect(page.locator(".focus-loading")).toHaveCount(0);
    await expect(page.locator(".usage-card")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Needs your attention", exact: true }),
    ).toHaveCount(role === "supervisor" ? 1 : 0);
    await expect(
      page.getByRole("heading", { name: "Today’s reservations", exact: true }),
    ).toHaveCount(role === "supervisor" ? 0 : 1);
    await expect(
      page.getByRole("button", { name: "Review reports", exact: true }),
    ).toHaveCount(role === "supervisor" ? 1 : 0);
    if (info.project.name === "phone")
      await page.setViewportSize({ width: 360, height: 780 });
    await accessible(page);
    await page.screenshot({
      path: info.outputPath(`workspace-focus-${role}.png`),
      fullPage: true,
    });
    const lab = page.locator("summary").filter({ hasText: "Lab activity" });
    await lab.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", {
        name: "Usage & next reservations",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".usage-card").first()).toBeVisible();
    await accessible(page);
    await lab.focus();
    await page.keyboard.press("Space");
    await expect(page.locator(".usage-card")).toHaveCount(0);
    await expect(lab).toBeFocused();
    if (role === "supervisor") {
      await page
        .getByRole("button", { name: "Review reports", exact: true })
        .click();
      await expect(
        page.getByRole("heading", {
          name: "Weekly meeting summary",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByLabel("Work completed", { exact: true }),
      ).toHaveCount(0);
      await navigate(page, "Overview");
      await navigate(page, "Weekly Progress");
    } else
      await page
        .getByRole("button", { name: "Open Weekly Progress", exact: true })
        .click();
    await expect(
      page.getByLabel("Work completed", { exact: true }),
    ).toBeVisible();
  });

test("today respects IST, keeps overdue active runs visible, and excludes other members and tomorrow", async ({
  page,
}, info) => {
  await login(page, "member", info.project.name, "samples");
  const user = (await (await page.request.get("/api/session")).json()).user;
  await page.route("**/api/monitoring", async (route) => {
    const data = await (await route.fetch()).json();
    const booking = {
      id: "today",
      operatorId: user.id,
      bookedBy: user.id,
      instrumentName: "My PPMS measurement",
      measurementType: "Synthetic heat capacity scan",
      startsAt: "2033-03-02T18:30:00Z",
      endsAt: "2033-03-02T20:30:00Z",
      status: "confirmed",
    };
    await route.fulfill({
      json: {
        ...data,
        refreshedAt: "2033-03-02T19:00:00Z",
        bookings: [
          booking,
          {
            ...booking,
            id: "active",
            instrumentName: "Overdue furnace run",
            startsAt: "2033-03-01T19:00:00Z",
            endsAt: "2033-03-01T20:00:00Z",
            status: "in_progress",
          },
          {
            ...booking,
            id: "other",
            operatorId: "other-user",
            bookedBy: "other-user",
            instrumentName: "Another member reservation",
          },
          {
            ...booking,
            id: "tomorrow",
            instrumentName: "Tomorrow reservation",
            startsAt: "2033-03-03T19:00:00Z",
            endsAt: "2033-03-03T20:00:00Z",
          },
          {
            ...booking,
            id: "cancelled",
            instrumentName: "Cancelled reservation",
            status: "cancelled",
          },
        ],
      },
    });
  });
  await navigate(page, "Overview");
  const card = page
    .locator(".focus-card")
    .filter({
      has: page.getByRole("heading", {
        name: "Today’s reservations",
        exact: true,
      }),
    });
  await expect(card).toContainText("My PPMS measurement");
  await expect(card).toContainText("Overdue furnace run");
  await expect(card).toContainText("Past scheduled end · completion needed");
  await expect(card).not.toContainText("Another member reservation");
  await expect(card).not.toContainText("Tomorrow reservation");
  await expect(card).not.toContainText("Cancelled reservation");
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("workspace-focus-reservations.png"),
    fullPage: true,
  });
});

test("a failed overview panel shows a retry without hiding healthy panels or claiming an empty list", async ({
  page,
}, info) => {
  await login(page, "member", info.project.name, "samples");
  await page.route(
    "**/api/issues/summary",
    (route) =>
      route.fulfill({
        status: 503,
        json: { error: "Synthetic assigned-work outage" },
      }),
    { times: 1 },
  );
  await navigate(page, "Overview");
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic assigned-work outage",
  );
  await expect(
    page.getByText(
      "No issues assigned to you. Meeting actions are available below.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open Weekly Progress", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Retry assigned work", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".focus-loading")).toHaveCount(0);
});
