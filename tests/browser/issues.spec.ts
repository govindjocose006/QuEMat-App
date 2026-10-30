import { navigate } from "./navigation.js";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.setTimeout(90000);
async function login(page: Page, key: string, device: string) {
  await page.goto("/");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`browser-weekly-${key}-${device}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Browser-tests-only-passphrase!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Lab overview", exact: true }),
  ).toBeVisible();
}
async function logout(page: Page) {
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
}
async function write(page: Page, path: string, data: unknown) {
  const s = await (await page.request.get("/api/session")).json();
  const r = await page.request.post("/api" + path, {
    headers: { Origin: "http://127.0.0.1:3199", "X-CSRF-Token": s.csrfToken },
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
async function openIssues(page: Page) {
  await navigate(page, "Issues & Requests");
  await expect(
    page.getByRole("button", { name: "New issue/request", exact: true }),
  ).toBeEnabled();
}
async function transition(page: Page, status: string, reason = "") {
  await page
    .getByRole("combobox", { name: "New status", exact: true })
    .selectOption(status);
  await page
    .getByRole("textbox", { name: "Status reason (optional)", exact: true })
    .fill(reason);
  await page
    .getByRole("button", { name: "Record status change", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "Status and history saved.",
  );
}
test("shared issues, explicit acknowledgement, status history, resolved filters and notification links", async ({
  page,
}, info) => {
  const d = info.project.name,
    title = `Manual helium observation ${d}`;
  await login(page, "member", d);
  const options = await (await page.request.get("/api/issues/options")).json();
  const assignee = options.people.find(
    (p: { fullName: string }) => p.fullName === `Weekly ${d} mentor`,
  );
  const instrument = options.instruments.find(
    (i: { name: string }) => i.name === `Weekly ${d} PPMS`,
  );
  const sample = await write(page, "/samples", {
    compound: `Issue sample ${d}`,
  });
  await openIssues(page);
  await expect(
    page.getByRole("combobox", { name: "Work view", exact: true }),
  ).toHaveValue("work");
  await page
    .getByRole("button", { name: "New issue/request", exact: true })
    .click();
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page
    .getByLabel("Description", { exact: true })
    .fill("Synthetic manual observation, asking for a refill decision.");
  await page
    .getByRole("combobox", { name: "Category", exact: true })
    .last()
    .selectOption("helium_refill");
  await expect(page.getByRole("dialog")).toContainText("not a sensor reading");
  await page
    .getByRole("combobox", { name: "Priority", exact: true })
    .last()
    .selectOption("urgent");
  await page
    .getByLabel("Due date (Asia/Kolkata)", { exact: true })
    .fill("2026-11-02");
  await page
    .getByRole("combobox", { name: "Assignee", exact: true })
    .last()
    .selectOption(assignee.id);
  await page
    .getByRole("combobox", { name: "Related instrument", exact: true })
    .selectOption(instrument.id);
  await page
    .getByRole("combobox", { name: "Related sample", exact: true })
    .selectOption(sample.id);
  await page
    .getByLabel("Related project", { exact: true })
    .fill(`Synthetic issue ${d}`);
  await page
    .getByLabel("Supervisor attention requested", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Add data link", exact: true })
    .click();
  await page
    .getByLabel("Link 1 label", { exact: true })
    .fill("Synthetic observation");
  await page
    .getByLabel("Link 1 URL", { exact: true })
    .fill("https://example.test/observation");
  await accessible(page);
  await page
    .getByRole("button", { name: "Create issue/request", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Not acknowledged");
  await expect(
    page.getByRole("combobox", { name: "New status", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("dialog")).toContainText(sample.code);
  await page
    .getByRole("textbox", { name: "Comment / follow-up", exact: true })
    .fill("Synthetic reporter follow-up");
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Synthetic reporter follow-up",
  );
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("issue-reporter.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByLabel("Search issues", { exact: true }).fill(title);
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toBeVisible();
  await logout(page);
  await login(page, "mentor", d);
  const assigned = page.locator(".focus-card").filter({
    has: page.getByRole("heading", { name: "Assigned to you", exact: true }),
  });
  await expect(assigned.locator(".focus-number")).toContainText("1");
  await page
    .getByRole("button", { name: new RegExp(`ISS-.*${title}`) })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Clear supervisor attention", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Request supervisor attention",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Request supervisor attention", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Clear supervisor attention",
      exact: true,
    }),
  ).toBeVisible();
  await transition(page, "acknowledged");
  await expect(page.getByRole("dialog")).toContainText("No reason provided.");
  await expect(page.getByRole("dialog")).toContainText(`Weekly ${d} mentor`);
  await transition(page, "in_progress");
  await transition(page, "blocked", "Awaiting a synthetic decision");
  await transition(page, "resolved");
  await expect(page.getByRole("dialog")).toContainText("Blocked → Resolved");
  await expect(page.getByRole("dialog")).toContainText(
    "Awaiting a synthetic decision",
  );
  await page.reload();
  await openIssues(page);
  await page
    .getByRole("combobox", { name: "Work view", exact: true })
    .selectOption("resolved");
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Blocked → Resolved");
  await expect(page.getByRole("dialog")).toContainText("No reason provided.");
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("issue-resolved-history.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close dialog" }).click();
  await openIssues(page);
  await page
    .getByRole("combobox", { name: "Work view", exact: true })
    .selectOption("work");
  await page.getByLabel("Search issues", { exact: true }).fill(title);
  await expect(
    page.getByText("No issues match this view.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Work view", exact: true })
    .selectOption("resolved");
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Work view", exact: true })
    .selectOption("all");
  await page
    .getByRole("combobox", { name: "Priority", exact: true })
    .selectOption("urgent");
  await page
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("helium_refill");
  await page
    .getByRole("combobox", { name: "Instrument", exact: true })
    .selectOption(instrument.id);
  await page
    .getByRole("combobox", { name: "Assignee", exact: true })
    .selectOption("me");
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Priority", exact: true })
    .selectOption("low");
  await expect(
    page.getByText("No issues match this view.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Priority", exact: true })
    .selectOption("urgent");
  await accessible(page);
  await logout(page);
  await login(page, "member", d);
  await navigate(page, "Notifications");
  const notification = page
    .locator("article")
    .filter({ hasText: title })
    .first();
  await notification
    .getByRole("button", { name: "View issue/request", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Synthetic reporter follow-up",
  );
  await transition(page, "open");
  await expect(page.getByRole("dialog")).toContainText("subsequently reopened");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await logout(page);
});
test("academic supervisor cannot manage unrelated work; application supervisor can record decisions", async ({
  page,
}, info) => {
  const d = info.project.name,
    title = `Purchase decision only ${d}`;
  await login(page, "member", d);
  const created = await write(page, "/issues", {
    title,
    description: "Synthetic purchase decision request; no order or payment.",
    category: "purchase_approval",
    priority: "high",
    supervisorAttention: true,
  });
  await logout(page);
  await login(page, "other", d);
  await openIssues(page);
  await page.getByLabel("Search issues", { exact: true }).fill(title);
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "New status", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Edit details / assignment",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByRole("dialog")).toContainText("Discussion is limited");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await logout(page);
  await login(page, "supervisor", d);
  await expect(
    page.getByRole("heading", { name: "Needs your attention", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: `${created.code} · ${title}`, exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "no automatic ordering or payment",
  );
  await page
    .getByRole("button", { name: "Edit details / assignment", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "does not place an order",
  );
  await page
    .getByRole("combobox", { name: "Priority", exact: true })
    .last()
    .selectOption("urgent");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("urgent priority");
  await transition(page, "acknowledged");
  await page
    .getByRole("textbox", { name: "Comment / follow-up", exact: true })
    .fill(
      "Synthetic decision: defer until a separate approval process; no purchase.",
    );
  // A slow comment response must not erase a status form being filled meanwhile.
  let finishComment!: () => void;
  const heldComment = new Promise<void>((resolve) => {
    finishComment = resolve;
  });
  await page.route("**/api/issues/*/comments", async (route) => {
    const response = await route.fetch();
    await heldComment;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  const newStatus = page.getByRole("combobox", {
    name: "New status",
    exact: true,
  });
  const reason = page.getByRole("textbox", {
    name: "Status reason (optional)",
    exact: true,
  });
  await newStatus.selectOption("resolved");
  await reason.fill("Synthetic decision completed; no ordering or payment");
  finishComment();
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText(
    "Comment saved.",
  );
  await expect(newStatus).toHaveValue("resolved");
  await expect(reason).toHaveValue(
    "Synthetic decision completed; no ordering or payment",
  );
  await page
    .getByRole("button", { name: "Record status change", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText(
    "Status and history saved.",
  );
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("issue-supervisor-decision.png"),
    fullPage: true,
  });
});
