import { navigate } from "./navigation.js";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { istInput } from "../../shared/scheduling-ui.js";
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
}
async function write(page: Page, path: string, data: unknown) {
  const session = await (await page.request.get("/api/session")).json();
  const r = await page.request.post("/api" + path, {
    headers: {
      Origin: "http://127.0.0.1:3199",
      "X-CSRF-Token": session.csrfToken,
    },
    data,
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

test("samples, magnetic booking, reschedule, actual usage, handover and notifications", async ({
  page,
}, info) => {
  await login(page);
  const instruments = await (await page.request.get("/api/instruments")).json();
  const resource = await write(page, "/instruments", {
    ...instruments.find((i: { name: string }) => i.name === "PPMS"),
    name: `${info.project.name} scheduling PPMS`,
    priority: false,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Lab overview", exact: true }),
  ).toBeVisible();
  await navigate(page, "Samples");
  await page.getByRole("button", { name: "New sample", exact: true }).click();
  await page.getByLabel("Compound / formula").fill(`FeSe-${info.project.name}`);
  await page.getByLabel("Batch", { exact: true }).fill("Browser batch");
  await page.getByLabel("Storage location").fill("Test cabinet");
  await page.getByRole("button", { name: "Save sample", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await navigate(page, "Calendar");
  await page
    .getByRole("button", { name: "Book instrument", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: "Instrument", exact: true })
    .selectOption(resource.id);
  await page.getByLabel("Measurement / process type").fill("Magnetization/VSM");
  await page.getByLabel("Temperature minimum", { exact: true }).fill("2");
  await page.getByLabel("Temperature maximum", { exact: true }).fill("300");
  await page.getByLabel("Field maximum", { exact: true }).fill("5");
  await page.getByLabel(new RegExp(`QEM-.*FeSe-${info.project.name}`)).check();
  await accessible(page);
  await page
    .getByRole("button", { name: "Reserve booking", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const tile = page
    .locator(".booking-tile")
    .filter({ hasText: resource.name })
    .first();
  await expect(tile).toContainText("confirmed");
  await tile.click();
  await page.getByRole("button", { name: "Edit / reschedule" }).click();
  await page
    .getByLabel("Start (Asia/Kolkata)", { exact: true })
    .fill(istInput(new Date(Date.now() - 60000).toISOString()));
  await page
    .getByLabel("End including cooling (Asia/Kolkata)")
    .fill(istInput(new Date(Date.now() + 1800000).toISOString()));
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await tile.click();
  await page
    .getByRole("combobox", { name: "Action", exact: true })
    .selectOption("checkin");
  await page.getByRole("button", { name: "Apply action" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(tile).toContainText("in progress");
  await tile.click();
  await page
    .getByRole("combobox", { name: "Action", exact: true })
    .selectOption("complete");
  await page
    .getByLabel("Completion summary / reason")
    .fill("Synthetic scan complete");
  await page
    .getByLabel("Handover notes", { exact: true })
    .fill("Holder cleared");
  await page.getByRole("button", { name: "Apply action" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(tile).toContainText("completed");
  for (const view of ["day", "month", "week"]) {
    await page
      .getByRole("combobox", { name: "View", exact: true })
      .selectOption(view);
    await expect(page.locator(".calendar-day").first()).toBeVisible();
  }
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("phase2-calendar.png"),
    fullPage: true,
  });
  await navigate(page, "Notifications");
  await expect(
    page.getByText(new RegExp(resource.name + ": complete")),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Mark read", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "View booking", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toContainText("Holder cleared");
  await page.getByRole("button", { name: "Close dialog" }).click();

  // Archiving separates daily work from history without losing linked runs.
  await write(page, "/samples", {
    compound: `FeSe-${info.project.name}-control`,
  });
  await navigate(page, "Samples");
  const status = page.getByRole("combobox", { name: "Sample status" });
  const search = page.getByRole("textbox", { name: "Search samples" });
  const sampleCard = (compound: string) =>
    page.locator(".sample-grid article").filter({
      has: page.getByRole("heading", { name: compound, exact: true }),
    });
  const target = sampleCard(`FeSe-${info.project.name}`);
  const control = sampleCard(`FeSe-${info.project.name}-control`);
  await expect(status).toHaveValue("active");
  await search.fill(`FeSe-${info.project.name}`);
  await expect(target).toBeVisible();
  await expect(control).toBeVisible();

  await target.getByRole("button", { name: /^Edit QEM-/ }).click();
  await page.getByLabel("Archive sample", { exact: true }).check();
  await page.getByRole("button", { name: "Save sample", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(target).toHaveCount(0);
  await expect(control).toBeVisible();

  await status.selectOption("archived");
  await expect(target).toBeVisible();
  await expect(target).toContainText("Archived");
  await expect(control).toHaveCount(0);
  await search.fill("No such synthetic sample");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "No samples match your search in this view." }),
  ).toBeVisible();
  await search.fill(`FeSe-${info.project.name}`);
  await status.selectOption("all");
  await expect(target).toBeVisible();
  await expect(control).toBeVisible();
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("sample-status-views.png"),
    fullPage: true,
  });

  await status.selectOption("archived");
  await target.getByRole("button", { name: /^History QEM-/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Holder cleared");
  await expect(page.getByRole("dialog")).toContainText(
    "Synthetic scan complete",
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  await target.getByRole("button", { name: /^Edit QEM-/ }).click();
  await page.getByLabel("Archive sample", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Save sample", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(target).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText(
    "No samples match your search in this view.",
  );
  await status.selectOption("active");
  await expect(target).toBeVisible();
  await expect(control).toBeVisible();
  await page.reload();
  await navigate(page, "Samples");
  await expect(status).toHaveValue("active");
  await expect(target).toBeVisible();
});

test("furnace maximum and unloading, quick sample creation, sputtering and maintenance forms", async ({
  page,
}, info) => {
  await login(page);
  const list = await (await page.request.get("/api/instruments")).json();
  const furnace = await write(page, "/instruments", {
    ...list.find((i: { category: string }) => i.category === "Furnace"),
    name: `${info.project.name} test Furnace`,
    priority: false,
    maxTemperatureC: 1050,
  });
  const sputter = await write(page, "/instruments", {
    ...list.find((i: { name: string }) => i.name.includes("sputter")),
    name: `${info.project.name} test sputtering`,
    priority: false,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Lab overview", exact: true }),
  ).toBeVisible();
  await navigate(page, "Calendar");
  await page
    .getByRole("button", { name: "Book instrument", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: "Instrument", exact: true })
    .selectOption(furnace.id);
  await page.getByLabel("Measurement / process type").fill("Annealing");
  await page.getByRole("button", { name: "Quick create sample" }).click();
  await page
    .getByLabel("Compound / formula")
    .fill(`Oxide-${info.project.name}`);
  await page.getByRole("button", { name: "Save sample", exact: true }).click();
  await expect(page.getByLabel("Measurement / process type")).toHaveValue(
    "Annealing",
  );
  await page.getByLabel("Target temperature", { exact: false }).fill("1051");
  await page
    .getByRole("button", { name: "Reserve booking", exact: true })
    .click();
  await expect(page.getByRole("alert").last()).toContainText("maximum");
  await page.getByLabel("Target temperature", { exact: false }).fill("1000");
  await page
    .getByLabel("Ramp / hold / cooling stages")
    .fill("Synthetic planned stages");
  await page
    .getByRole("button", { name: "Reserve booking", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const tile = page
    .locator(".booking-tile")
    .filter({ hasText: furnace.name })
    .first();
  await tile.click();
  await page
    .getByRole("combobox", { name: "Action", exact: true })
    .selectOption("checkin");
  await page.getByRole("button", { name: "Apply action" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await tile.click();
  await page
    .getByRole("combobox", { name: "Action", exact: true })
    .selectOption("complete");
  await page.getByLabel("Completion summary / reason").fill("Run complete");
  await page
    .getByLabel("Handover notes", { exact: true })
    .fill("Unloaded and safe");
  await page.getByRole("button", { name: "Apply action" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "unloaded",
  );
  await page.getByLabel("I confirm cooling").check();
  await page.getByRole("button", { name: "Apply action" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(tile).toContainText("completed");
  await page
    .getByRole("button", { name: "Book instrument", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: "Instrument", exact: true })
    .selectOption(sputter.id);
  await page.getByLabel("Measurement / process type").fill("Deposition");
  await page.getByLabel(new RegExp(`QEM-.*Oxide-${info.project.name}`)).check();
  await page.getByLabel("Target material", { exact: true }).fill("Test target");
  await page.getByLabel("Substrate", { exact: true }).fill("Test substrate");
  await page.getByLabel("Pressure (include units)").fill("1 Pa");
  await page.getByLabel("Power (include units)").fill("50 W");
  await accessible(page);
  await page
    .getByRole("button", { name: "Reserve booking", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Add maintenance", exact: true })
    .click();
  await page.getByLabel("Maintenance reason").fill("Planned inspection");
  await page
    .getByLabel("Start (Asia/Kolkata)", { exact: true })
    .fill(istInput(new Date(Date.now() + 86400000).toISOString()));
  await page
    .getByLabel("End (Asia/Kolkata)", { exact: true })
    .fill(istInput(new Date(Date.now() + 90000000).toISOString()));
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: "Instrument", exact: true })
    .selectOption(furnace.id);
  await page.getByRole("button", { name: "Save block" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("phase2-furnace-agenda.png"),
    fullPage: true,
  });
});
