import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function checkAccessibility(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test("core screens meet automated WCAG checks", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await checkAccessibility(page);
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
  await checkAccessibility(page);
  await page.getByRole("button", { name: "Instruments", exact: true }).click();
  await page.getByRole("button", { name: "Add instrument" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await checkAccessibility(page);
});
