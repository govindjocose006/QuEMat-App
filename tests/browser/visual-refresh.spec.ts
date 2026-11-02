import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { navigate, signOut } from "./navigation.js";

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
  await expect(page.locator(".account-menu > summary")).toBeVisible();
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
test("account menu is keyboard accessible, closes with Escape and retains sign out", async ({
  page,
}, info) => {
  await login(page, info.project.name === "phone");
  const account = page.locator(".account-menu > summary");
  await account.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await accessible(page);
  await page.keyboard.press("Escape");
  await expect(account).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).not.toBeVisible();
  if (info.project.name === "phone") {
    await expect(
      page.getByRole("button", { name: "Open inbox", exact: true }),
    ).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Notifications", exact: true }),
    ).toBeVisible();
  }
  await signOut(page);
  await expect(
    page.getByRole("heading", { name: "Welcome back", exact: true }),
  ).toBeVisible();
});
test("instrument operating status and overnight calendar timeline stay distinct", async ({
  page,
}, info) => {
  await login(page, info.project.name === "phone");
  const instruments = await (await page.request.get("/api/instruments")).json();
  const squid = instruments.find((i: { name: string }) => i.name === "SQUID");
  await navigate(page, "Instruments");
  const card = page
    .locator(".instrument-card")
    .filter({ has: page.getByRole("heading", { name: "SQUID", exact: true }) });
  await expect(card).toContainText("Operational");
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("workspace-refresh-instruments.png"),
    fullPage: true,
  });
  await page.route("**/api/bookings?**", (route) =>
    route.fulfill({
      json: [
        {
          id: "synthetic-timeline",
          instrumentId: squid.id,
          instrumentName: "SQUID",
          operatorName: "Synthetic operator",
          startsAt: "2039-03-03T18:00:00Z",
          endsAt: "2039-03-03T19:30:00Z",
          status: "confirmed",
          measurementType: "Synthetic overnight scan",
          sampleSnapshots: [],
        },
      ],
    }),
  );
  await card
    .getByRole("button", { name: "View schedule for SQUID", exact: true })
    .click();
  await page.getByLabel("Date", { exact: true }).fill("2039-03-03");
  await expect(page.locator(".calendar-timeline .reservation-bar")).toHaveCount(
    2,
  );
  const bars = page.locator(".reservation-bar rect:last-child");
  await expect(bars.nth(0)).toHaveAttribute("x", "1410");
  await expect(bars.nth(1)).toHaveAttribute("x", "0");
  await expect(
    page.getByRole("heading", { name: "3 Mar 2039 – 9 Mar 2039", exact: true }),
  ).toBeVisible();
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("workspace-refresh-timeline.png"),
    fullPage: true,
  });
});
test("empty issue view offers a working reset without creating records", async ({
  page,
}, info) => {
  await login(page, info.project.name === "phone");
  await navigate(page, "Issues & Requests");
  await page
    .getByLabel("Search issues", { exact: true })
    .fill("synthetic-no-match-visual-refresh");
  await expect(
    page.getByRole("heading", {
      name: "No issues match this view.",
      exact: true,
    }),
  ).toBeVisible();
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("workspace-refresh-empty.png"),
  });
  await page
    .getByRole("button", { name: "Show all issues", exact: true })
    .click();
  await expect(page.getByLabel("Search issues", { exact: true })).toHaveValue(
    "",
  );
  await expect(page.getByLabel("Work view", { exact: true })).toHaveValue(
    "all",
  );
});
test("report progress reflects writing and keeps a separate save and review action", async ({
  page,
}, info) => {
  await login(page, info.project.name === "phone");
  await navigate(page, "Weekly Progress");
  await page
    .getByLabel("Week beginning (Monday)", { exact: true })
    .fill("2040-01-02");
  const field = page.getByLabel("Work completed", { exact: true });
  await expect(field).toHaveValue("");
  await expect(
    page.getByRole("progressbar", { name: "Report sections drafted" }),
  ).toHaveAttribute("value", "0");
  await field.fill("Synthetic progress indicator check");
  await expect(
    page.getByRole("progressbar", { name: "Report sections drafted" }),
  ).toHaveAttribute("value", "1");
  await expect(
    page.getByText("Unsaved changes", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save & review", exact: true }),
  ).toBeVisible();
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("workspace-refresh-report.png"),
  });
});
