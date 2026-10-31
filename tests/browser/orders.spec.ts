import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { navigate } from "./navigation.js";
test("chemical requests, recorded orders, partial deliveries, retained corrections and inbox links", async ({
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
  await navigate(page, "Chemicals & Orders");
  await page
    .getByRole("button", { name: "New chemical request", exact: true })
    .click();
  const chemical = "Synthetic order " + info.project.name;
  await page.getByLabel("Chemical name", { exact: true }).fill(chemical);
  await page.getByLabel("Quantity requested", { exact: true }).fill("0.3");
  await page
    .getByLabel("Purpose", { exact: true })
    .fill("Synthetic order lifecycle test");
  await page
    .getByText("Specifications & purchasing details (optional)", {
      exact: true,
    })
    .click();
  await page
    .getByLabel("Estimated cost — INR (optional)", { exact: true })
    .fill("1234.50");
  await page
    .getByText("Specifications & purchasing details (optional)", {
      exact: true,
    })
    .click();
  await page.screenshot({
    path: info.outputPath("workspace-chemical-form.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Save chemical request", exact: true })
    .click();
  await expect(
    page.getByText("Saved. Order tracking and history updated.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Record order", exact: true }).click();
  await page.getByLabel("Supplier", { exact: true }).fill("Synthetic supplier");
  await page
    .getByLabel("Recorded order cost — INR (optional)", { exact: true })
    .fill("1250.01");
  await page
    .getByRole("button", { name: "Save order record", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Record delivery", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Record delivery", exact: true })
    .click();
  await page.getByLabel("Quantity received now", { exact: true }).fill("0.1");
  await page
    .getByLabel("Delivery notes (optional)", { exact: true })
    .fill("First synthetic package");
  await page
    .getByRole("button", { name: "Save delivery", exact: true })
    .click();
  await expect(
    page.getByText("First synthetic package", { exact: false }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Correct order details", exact: true })
    .click();
  await page
    .getByLabel("Recorded order cost — INR (optional)", { exact: true })
    .fill("1200.25");
  await page
    .getByLabel("Order / invoice reference (optional)", { exact: true })
    .fill("Synthetic corrected invoice");
  await page
    .getByRole("button", { name: "Save order record", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Record delivery", exact: true })
    .click();
  await page.getByLabel("Quantity received now", { exact: true }).fill("0.2");
  await page
    .getByRole("button", { name: "Save delivery", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Record delivery", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Order view", exact: true })
    .selectOption("closed");
  await expect(
    page.getByRole("heading", { name: new RegExp(chemical) }).last(),
  ).toBeVisible();
  const rows = await (
    await page.request.get(
      "/api/orders?view=closed&q=" + encodeURIComponent(chemical),
    )
  ).json();
  const item = rows.items[0];
  expect(item.receivedQuantity).toBe(0.3);
  expect(item.estimatedCostPaise).toBe(123450);
  expect(item.costPaise).toBe(120025);
  await page.reload();
  await navigate(page, "Chemicals & Orders");
  await page
    .getByRole("combobox", { name: "Order view", exact: true })
    .selectOption("closed");
  await page
    .getByRole("button", { name: "Open " + item.code, exact: true })
    .click();
  await expect(
    page.getByText("Synthetic corrected invoice", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.locator("summary").filter({ hasText: /^Retained history/ }),
  ).toBeVisible();
  // Reopening the same selection must fetch again without hiding its details.
  for (let attempt = 0; attempt < 3; attempt++) {
    const refreshed = page.waitForResponse(
      (r) => r.url().endsWith(`/api/orders/${item.id}`) && r.status() === 200,
    );
    await page
      .getByRole("button", { name: "Open " + item.code, exact: true })
      .click();
    await refreshed;
    await expect(
      page.locator("summary").filter({ hasText: /^Retained history/ }),
    ).toBeVisible();
  }
  await page
    .getByRole("button", { name: "Close order details", exact: true })
    .click();
  await expect(
    page.locator("summary").filter({ hasText: /^Retained history/ }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open " + item.code, exact: true })
    .click();
  await expect(
    page.locator("summary").filter({ hasText: /^Retained history/ }),
  ).toBeVisible();
  const reopened = await (
    await page.request.get(`/api/orders/${item.id}`)
  ).json();
  expect(reopened.deliveries).toHaveLength(2);
  expect(reopened.costPaise).toBe(120025);
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
  await page.screenshot({
    path: info.outputPath("chemical-order.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Open inbox", exact: true }).click();
  const link = page
    .locator("article.panel")
    .filter({ hasText: item.code })
    .first();
  await link
    .getByRole("button", { name: "View chemical order", exact: true })
    .click();
  await expect(
    page
      .getByRole("heading", { name: new RegExp(item.code + " · " + chemical) })
      .first(),
  ).toBeVisible();
});
