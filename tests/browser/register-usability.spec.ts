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
async function write(page: Page, path: string, data: object) {
  const session = await (await page.request.get("/api/session")).json();
  const response = await page.request.post("/api" + path, {
    data,
    headers: {
      Origin: "http://127.0.0.1:3199",
      "X-CSRF-Token": session.csrfToken,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
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

test("issue filters remain visible when collapsed and stale results cannot replace the latest search", async ({
  page,
}, info) => {
  await login(page, info.project.name === "phone");
  const title = `Register filter check ${info.project.name}`;
  const item = await write(page, "/issues", {
    title,
    description: "Synthetic register filter check",
    category: "general_decision",
  });
  await navigate(page, "Issues & Requests");
  await page.getByLabel("Search issues", { exact: true }).fill(title);
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toBeVisible();
  const more = page.locator("summary").filter({ hasText: "More filters" });
  await more.focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("combobox", { name: "Priority", exact: true })
    .selectOption("low");
  await expect(
    page.getByText("No issues match this view.", { exact: true }),
  ).toBeVisible();
  await more.click();
  await expect(
    page.getByRole("list", { name: "Active filters" }),
  ).toContainText("Priority: low");
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(page.getByLabel("Search issues", { exact: true })).toHaveValue(
    "",
  );
  await expect(more).toHaveText("More filters");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/api/issues?**", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    if (query === "slow synthetic") {
      started();
      await gate;
      await route.fulfill({ json: { items: [item], total: 1 } });
    } else if (query === "no synthetic match") {
      await route.fulfill({ json: { items: [], total: 0 } });
    } else await route.continue();
  });
  try {
    await page
      .getByLabel("Search issues", { exact: true })
      .fill("slow synthetic");
    await pending;
    await page
      .getByLabel("Search issues", { exact: true })
      .fill("no synthetic match");
    await expect(
      page.getByText("0 matching items", { exact: true }),
    ).toBeVisible();
    const finished = page.waitForResponse(
      (r) => new URL(r.url()).searchParams.get("q") === "slow synthetic",
    );
    release();
    await finished;
    await expect(
      page.getByRole("button", { name: title, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("0 matching items", { exact: true }),
    ).toBeVisible();
  } finally {
    release();
  }
  await page.unroute("**/api/issues?**");
  await page.getByLabel("Search issues", { exact: true }).fill(title);
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toBeVisible();
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("workspace-issue-list.png"),
    fullPage: info.project.name !== "phone",
  });
});

test("sample handling stays visible while metadata expands and grouped edits retain every value", async ({
  page,
}, info) => {
  await login(page, info.project.name === "phone");
  const sample = await write(page, "/samples", {
    compound: `Register sample ${info.project.name}`,
    batch: "Synthetic batch",
    preparedOn: "2026-01-03",
    storage: "Synthetic cabinet",
    notes: "Synthetic handling instructions",
    physicalForm: "powder",
    quantity: "2 g",
  });
  await navigate(page, "Samples");
  await page.getByLabel("Search samples", { exact: true }).fill(sample.code);
  const row = page
    .locator(".sample-grid article")
    .filter({ hasText: sample.code });
  await expect(
    row.getByText("Synthetic handling instructions", { exact: true }),
  ).toBeVisible();
  await expect(
    row.getByText("Synthetic cabinet", { exact: true }),
  ).toBeVisible();
  await expect(row.locator("details")).not.toHaveAttribute("open", "");
  await row.locator("summary").click();
  await expect(
    row.getByText("Synthetic batch / 2026-01-03", { exact: true }),
  ).toBeVisible();
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("workspace-sample-list.png"),
    fullPage: info.project.name !== "phone",
  });
  await row
    .getByRole("button", { name: `Edit ${sample.code}`, exact: true })
    .click();
  await expect(
    page.getByRole("group", { name: /Preparation & handling/ }),
  ).toBeVisible();
  await page
    .getByLabel("Storage location", { exact: true })
    .fill("Updated synthetic cabinet");
  await accessible(page);
  await page.getByRole("button", { name: "Save sample", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const saved = (await (await page.request.get("/api/samples")).json()).find(
    (s: { id: string }) => s.id === sample.id,
  );
  expect(saved).toMatchObject({
    storage: "Updated synthetic cabinet",
    notes: sample.notes,
    batch: sample.batch,
    quantity: "2 g",
    physicalForm: "powder",
  });
});

test("meeting attendee search retains selection and reveals invalid optional links before saving", async ({
  page,
}, info) => {
  await login(page, info.project.name === "phone");
  await navigate(page, "Meetings & Notices");
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("workspace-collaboration-list.png"),
    fullPage: info.project.name !== "phone",
  });
  await page.getByRole("button", { name: "New meeting", exact: true }).click();
  const title = `Register meeting ${info.project.name}`;
  await page.getByLabel("Meeting title", { exact: true }).fill(title);
  const attendee = `Weekly ${info.project.name} other`;
  await page.getByLabel("Find attendees", { exact: true }).fill(attendee);
  await page.getByRole("checkbox", { name: attendee, exact: true }).check();
  await page
    .getByLabel("Find attendees", { exact: true })
    .fill("No other matching person");
  await page.getByLabel("Find attendees", { exact: true }).press("Enter");
  await expect(
    page.getByRole("checkbox", { name: attendee, exact: true }),
  ).toBeChecked();
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  const checkbox = await page
    .getByRole("checkbox", { name: attendee, exact: true })
    .boundingBox();
  expect(checkbox!.width).toBeLessThanOrEqual(24);
  expect(checkbox!.height).toBeLessThanOrEqual(24);
  await expect(page.getByLabel("Meeting title", { exact: true })).toHaveValue(
    title,
  );
  await page
    .getByLabel("Start (Asia/Kolkata)", { exact: true })
    .fill("2038-05-01T10:00");
  await page
    .getByLabel("End (Asia/Kolkata)", { exact: true })
    .fill("2038-05-01T11:00");
  const links = page.getByText("Data links (optional)", { exact: true });
  await links.click();
  await page
    .getByRole("button", { name: "Add data link", exact: true })
    .click();
  await page
    .getByLabel("Link 1 label", { exact: true })
    .fill("Synthetic material");
  await links.click();
  await page
    .getByRole("button", { name: "Schedule meeting", exact: true })
    .click();
  await expect(page.getByLabel("Link 1 URL", { exact: true })).toBeFocused();
  await page
    .getByLabel("Link 1 URL", { exact: true })
    .fill("https://example.test/material");
  await links.click();
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("workspace-meeting-form.png"),
    fullPage: info.project.name !== "phone",
  });
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/meetings") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Schedule meeting", exact: true })
    .click();
  const saved = await (await response).json();
  expect(saved.attendees).toHaveLength(1);
  expect(saved.attendees[0].fullName).toBe(attendee);
  expect(saved.dataLinks).toEqual([
    { label: "Synthetic material", url: "https://example.test/material" },
  ]);
});
