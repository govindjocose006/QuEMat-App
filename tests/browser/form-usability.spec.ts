import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { navigate } from "./navigation.js";
async function login(page: Page, device: string, role = "admin") {
  await page.goto("/");
  await page
    .getByLabel("Email", { exact: true })
    .fill(
      role === "admin"
        ? "browser-admin@example.test"
        : `browser-weekly-${role}-${device}@example.test`,
    );
  await page
    .getByLabel("Password", { exact: true })
    .fill("Browser-tests-only-passphrase!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
}
async function write(page: Page, path: string, data: object) {
  const session = await (await page.request.get("/api/session")).json();
  const r = await page.request.post("/api" + path, {
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
  const dialog = page.getByRole("dialog");
  if (await dialog.count())
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
}

test("booking sample search preserves selection, collapsed optional fields and instrument setup when saved", async ({
  page,
}, info) => {
  await login(page, info.project.name);
  if (info.project.name === "phone")
    await page.setViewportSize({ width: 360, height: 780 });
  const instruments = await (await page.request.get("/api/instruments")).json();
  const instrument = await write(page, "/instruments", {
    ...instruments.find((i: { name: string }) => i.name === "PPMS"),
    name: `Forms ${info.project.name} PPMS`,
    priority: false,
  });
  const sample = await write(page, "/samples", {
    compound: `Forms selected ${info.project.name}`,
  });
  const hidden = await write(page, "/samples", {
    compound: `Forms unselected ${info.project.name}`,
  });
  await navigate(page, "Calendar");
  await page
    .getByRole("button", { name: "Book instrument", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    page.getByText("Loading samples and operators…", { exact: true }),
  ).toHaveCount(0);
  const reserve = dialog.getByRole("button", {
    name: "Reserve booking",
    exact: true,
  });
  await expect(reserve).toBeInViewport({ ratio: 1 });
  await dialog
    .getByRole("combobox", { name: "Instrument", exact: true })
    .selectOption(instrument.id);
  await page
    .getByLabel("Measurement / process type")
    .fill("Synthetic forms scan");
  await page
    .getByLabel("Start (Asia/Kolkata)", { exact: true })
    .fill("2037-01-02T10:00");
  await page
    .getByLabel("End including cooling (Asia/Kolkata)", { exact: true })
    .fill("2037-01-02T11:00");
  await page.getByLabel("Find a sample", { exact: true }).fill(sample.code);
  await page
    .getByLabel(`${sample.code} · ${sample.compound}`, { exact: true })
    .check();
  await page
    .getByLabel("Find a sample", { exact: true })
    .fill("no-such-sample");
  await expect(
    page.getByLabel(`${sample.code} · ${sample.compound}`, { exact: true }),
  ).toBeChecked();
  await expect(
    page.getByLabel(`${hidden.code} · ${hidden.compound}`, { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".selection-count")).toHaveText("1 selected");
  const optional = dialog
    .locator("summary")
    .filter({ hasText: "Project & participants (optional)" });
  await optional.click();
  await page
    .getByLabel("Project", { exact: true })
    .fill("Synthetic optional project");
  await dialog
    .getByRole("group", { name: "Additional participants", exact: true })
    .getByLabel(`Weekly ${info.project.name} mentor`, { exact: true })
    .check();
  await optional.click();
  await page.getByLabel("Temperature minimum", { exact: true }).fill("2");
  await page.getByLabel("Temperature maximum", { exact: true }).fill("300");
  await dialog.evaluate((el) => (el.scrollTop = 0));
  await expect(reserve).toBeInViewport({ ratio: 1 });
  expect(
    await dialog
      .locator(
        ".workflow-section .form-grid input, .workflow-section .form-grid select",
      )
      .evaluateAll((els) =>
        els.every((el) => {
          const box = el.getBoundingClientRect();
          const group = el.closest("fieldset")!.getBoundingClientRect();
          return box.right <= group.right + 1 && box.left >= group.left - 1;
        }),
      ),
  ).toBe(true);
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("workspace-form-booking.png"),
  });
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/bookings") && r.request().method() === "POST",
  );
  await reserve.click();
  const r = await response;
  expect(r.ok(), await r.text()).toBeTruthy();
  const saved = await r.json();
  expect(saved.sampleSnapshots.map((s: { id: string }) => s.id)).toEqual([
    sample.id,
  ]);
  expect(saved.project).toBe("Synthetic optional project");
  expect(saved.participants).toHaveLength(1);
  expect(saved.details.temperatureMin).toBe(2);
  expect(saved.details.temperatureMax).toBe(300);
  await expect(dialog).toHaveCount(0);
});

test("weekly sections save privately and reveal invalid link fields before focusing them", async ({
  page,
}, info) => {
  await login(page, info.project.name, "other");
  if (info.project.name === "phone")
    await page.setViewportSize({ width: 360, height: 780 });
  await navigate(page, "Weekly Progress");
  await page.getByLabel("Week beginning (Monday)").fill("2012-01-02");
  const work = page.getByLabel("Work completed", { exact: true });
  await expect(work).toBeVisible();
  await expect(page.locator(".report-writing-section")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "My weekly report", exact: true }),
  ).toHaveCount(0);
  await work.fill("Synthetic form draft retained privately");
  await expect(page.locator(".report-progress")).toHaveText(
    "1 / 6 sections drafted",
  );
  const save = page.getByRole("button", { name: "Save draft", exact: true });
  await expect(save).toBeInViewport();
  await expect(
    page.getByRole("button", {
      name: "Save and review submission",
      exact: true,
    }),
  ).toBeInViewport();
  const links = page
    .locator("summary")
    .filter({ hasText: "Research data links (optional)" });
  await links.click();
  await page
    .getByRole("button", { name: "Add data link", exact: true })
    .click();
  await page
    .getByLabel("Link 1 label", { exact: true })
    .fill("Synthetic dataset");
  let writes = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/weekly/reports") && r.method() === "POST")
      writes++;
  });
  await links.click();
  await save.click();
  await expect(page.getByLabel("Link 1 URL", { exact: true })).toBeFocused();
  await links.click();
  await page
    .getByRole("button", { name: "Save and review submission", exact: true })
    .click();
  await expect(page.getByLabel("Link 1 URL", { exact: true })).toBeFocused();
  expect(writes).toBe(0);
  await page
    .getByLabel("Link 1 URL", { exact: true })
    .fill("https://example.test/forms-dataset");
  await links.click();
  await save.click();
  await expect(
    page.getByText("Draft saved privately.", { exact: true }),
  ).toBeVisible();
  const mine = await (
    await page.request.get("/api/weekly/mine?week=2012-01-02")
  ).json();
  expect(mine.latestRevision).toBe(0);
  expect(mine.draft.workCompleted).toBe(
    "Synthetic form draft retained privately",
  );
  expect(mine.draft.dataLinks).toEqual([
    { label: "Synthetic dataset", url: "https://example.test/forms-dataset" },
  ]);
  await accessible(page);
  await page
    .locator(".report-writing-section")
    .first()
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("workspace-form-weekly.png") });
  await page.reload();
  await page.getByLabel("Week beginning (Monday)").fill("2012-01-02");
  await expect(work).toHaveValue("Synthetic form draft retained privately");
  await expect(page.getByLabel("Link 1 URL", { exact: true })).toHaveValue(
    "https://example.test/forms-dataset",
  );
});

test("booking option failures can be retried without claiming there are no samples", async ({
  page,
}, info) => {
  await login(page, info.project.name);
  await navigate(page, "Calendar");
  await page.route(
    "**/api/operators",
    (route) =>
      route.fulfill({
        status: 503,
        json: { error: "Synthetic booking options outage" },
      }),
    { times: 1 },
  );
  await page
    .getByRole("button", { name: "Book instrument", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic booking options outage",
  );
  await expect(
    page.getByText("Create a sample before booking.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Reserve booking", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Retry booking options", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Reserve booking", exact: true }),
  ).toBeEnabled();
});
