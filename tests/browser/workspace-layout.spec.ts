import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { navigate } from "./navigation.js";

test("overview groups instruments without losing access to follow-ups and phone navigation", async ({
  page,
}, info) => {
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
  const filters = page.getByRole("group", { name: "Instrument category" });
  const cards = page.locator(".usage-card");
  await expect(
    cards.filter({
      has: page.getByRole("heading", { name: "PPMS", exact: true }),
    }),
  ).toBeVisible();
  const allCount = await cards.count();
  await filters.getByRole("button", { name: "Furnace", exact: true }).click();
  await expect(
    filters.getByRole("button", { name: "Furnace", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(cards).toHaveCount(4);
  await expect(
    cards.filter({
      has: page.getByRole("heading", { name: "PPMS", exact: true }),
    }),
  ).toHaveCount(0);
  await filters
    .getByRole("button", { name: "All priority", exact: true })
    .click();
  await expect(cards).toHaveCount(allCount);
  const ppms = cards.filter({
    has: page.getByRole("heading", { name: "PPMS", exact: true }),
  });
  await ppms.locator("summary").click();
  await expect(ppms.getByText(/Training:/)).toBeVisible();
  await ppms.locator("summary").click();

  await expect(
    page.getByRole("heading", {
      name: "Issues requiring attention",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "My weekly report", exact: true }),
  ).toBeVisible();
  await page
    .locator("summary")
    .filter({ hasText: "Meetings, notices & action items" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Meetings & pinned notices",
      exact: true,
    }),
  ).toBeVisible();
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
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: info.outputPath("workspace-overview.png"),
    fullPage: true,
  });

  if (info.project.name === "phone") {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const more = page.getByRole("button", { name: "More", exact: true });
    await expect(more).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Open inbox", exact: true }),
    ).toBeInViewport();
    await more.click();
    await expect(
      page.getByRole("button", { name: "Meetings & Notices", exact: true }),
    ).toBeVisible();
    const menu = page.locator("#mobile-more-navigation");
    const bounds = await menu.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(60);
    expect(bounds!.y + bounds!.height).toBeLessThan(780 - 50);
    await page.getByRole("button", { name: "Close menu", exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(more).toBeFocused();
    await more.click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("workspace-phone-menu.png"),
    });
  }

  await navigate(page, "Weekly Progress");
  await expect(
    page.getByLabel("Work completed", { exact: true }),
  ).toBeVisible();
  await navigate(page, "Overview");
  await page
    .getByRole("button", { name: "Open calendar", exact: true })
    .click();
  await expect(page).toHaveURL(/#calendar$/);
  await expect(
    page.getByRole("heading", { name: "Calendar", exact: true }),
  ).toBeVisible();
});
