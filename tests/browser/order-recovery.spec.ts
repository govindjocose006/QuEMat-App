import { test, expect, type Page } from "@playwright/test";
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
  await expect(page.locator(".account-menu > summary")).toBeVisible();
}
async function write(page: Page, path: string, data: object) {
  const session = await (await page.request.get("/api/session")).json();
  const response = await page.request.post("/api" + path, {
    data,
    headers: {
      Origin: "http://127.0.0.1:3199",
      "X-CSRF-Token": session.csrfToken,
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
const create = (page: Page, name: string) =>
  write(page, "/orders", {
    chemical: name,
    quantity: 1,
    unit: "g",
    purpose: "Synthetic retry regression",
  });
for (const mode of ["record", "correct"]) {
  test(`${mode} order retries its failed member list without discarding entered values`, async ({
    page,
  }, info) => {
    await login(page);
    let item = await create(
      page,
      `Synthetic ${mode} recovery ${info.project.name}`,
    );
    const session = await (await page.request.get("/api/session")).json();
    if (mode === "correct")
      item = await write(page, `/orders/${item.id}/record`, {
        version: item.version,
        supplier: "Original supplier",
        orderedBy: session.user.id,
        orderedOn: "2026-01-01",
        costPaise: null,
      });
    await navigate(page, "Chemicals & Orders");
    await page
      .getByRole("button", { name: "Open " + item.code, exact: true })
      .click();
    let attempts = 0;
    await page.route("**/api/orders/options", async (route) => {
      attempts++;
      if (attempts === 1)
        await route.fulfill({
          status: 503,
          json: { error: "Synthetic member list unavailable" },
        });
      else await route.continue();
    });
    await page
      .getByRole("button", {
        name: mode === "record" ? "Record order" : "Correct order details",
        exact: true,
      })
      .click();
    await expect(page.getByRole("alert")).toHaveText(
      "Synthetic member list unavailable",
    );
    const save = page.getByRole("button", {
      name: "Save order record",
      exact: true,
    });
    await expect(save).toBeDisabled();
    await page
      .getByLabel("Supplier", { exact: true })
      .fill("Retained synthetic supplier");
    await page
      .getByLabel("Order / invoice reference (optional)", { exact: true })
      .fill("Retained reference");
    await page
      .getByLabel("Recorded order cost — INR (optional)", { exact: true })
      .fill("234.56");
    // A successful list refresh must not hide the separate options failure.
    const refreshed = page.waitForResponse(
      (r) => r.url().includes("/api/orders?") && r.status() === 200,
    );
    await page
      .getByRole("button", { name: "Refresh orders", exact: true })
      .click();
    await refreshed;
    await expect(page.getByRole("alert")).toHaveText(
      "Synthetic member list unavailable",
    );
    await page
      .getByRole("button", { name: "Retry member list", exact: true })
      .click();
    await expect(save).toBeEnabled();
    expect(attempts).toBe(2);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByLabel("Supplier", { exact: true })).toHaveValue(
      "Retained synthetic supplier",
    );
    await expect(
      page.getByLabel("Order / invoice reference (optional)", { exact: true }),
    ).toHaveValue("Retained reference");
    await expect(
      page.getByLabel("Recorded order cost — INR (optional)", { exact: true }),
    ).toHaveValue("234.56");
    await expect(
      page.getByRole("combobox", { name: "Ordered by", exact: true }),
    ).toHaveValue(session.user.id);
    await save.click();
    await expect(
      page.getByText("Saved. Order tracking and history updated.", {
        exact: true,
      }),
    ).toBeVisible();
    const saved = await (
      await page.request.get(`/api/orders/${item.id}`)
    ).json();
    expect(saved).toMatchObject({
      supplier: "Retained synthetic supplier",
      reference: "Retained reference",
      costPaise: 23456,
      orderedBy: session.user.id,
    });
  });
}
test("an old member-list failure cannot replace the next order form's successful load", async ({
  page,
}, info) => {
  await login(page);
  const first = await create(
    page,
    "Synthetic delayed options first " + info.project.name,
  );
  const second = await create(
    page,
    "Synthetic delayed options second " + info.project.name,
  );
  await navigate(page, "Chemicals & Orders");
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  let attempts = 0;
  await page.route("**/api/orders/options", async (route) => {
    attempts++;
    if (attempts === 1) {
      started();
      await gate;
      await route.fulfill({
        status: 503,
        json: { error: "Stale synthetic failure" },
      });
    } else await route.continue();
  });
  try {
    await page
      .getByRole("button", { name: "Open " + first.code, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Record order", exact: true })
      .click();
    await pending;
    await expect(
      page.getByRole("button", { name: "Save order record", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Close form", exact: true }).click();
    await page
      .getByRole("button", { name: "Open " + second.code, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Record order", exact: true })
      .click();
    const save = page.getByRole("button", {
      name: "Save order record",
      exact: true,
    });
    await expect(save).toBeEnabled();
    const finished = page.waitForResponse(
      (r) => r.url().endsWith("/api/orders/options") && r.status() === 503,
    );
    release();
    await finished;
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(save).toBeEnabled();
    expect(attempts).toBe(2);
  } finally {
    release();
  }
});
