import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  addDays,
  emptyReport,
  reportFields,
  weekStart,
} from "../../shared/weekly.js";
test.setTimeout(60000);
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
async function openWeekly(page: Page) {
  await page
    .getByRole("button", { name: "Weekly Progress", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "My report", exact: true }),
  ).toBeVisible();
}
test("weekly drafts, selected records, review-before-submit and revision history", async ({
  page,
}, info) => {
  const device = info.project.name;
  await login(page, "member", device);
  const session = await (await page.request.get("/api/session")).json(),
    instruments = await (await page.request.get("/api/instruments")).json();
  const s = await write(page, "/samples", {
    compound: `Weekly sample ${device}`,
    origin: "internal",
  });
  const b = await write(page, "/bookings", {
    instrumentId: instruments.find(
      (i: { name: string }) => i.name === `Weekly ${device} PPMS`,
    ).id,
    operatorId: session.user.id,
    sampleIds: [s.id],
    measurementType: `Weekly M(T) ${device}`,
    startsAt: new Date(Date.now() - 60000).toISOString(),
    endsAt: new Date(Date.now() + 1800000).toISOString(),
    details: {},
  });
  await openWeekly(page);
  await expect(page.getByLabel("Week beginning (Monday)")).toHaveValue(
    weekStart(),
  );
  for (const [key, label] of Object.entries(reportFields))
    await page
      .getByLabel(label, { exact: true })
      .fill(`${key}: synthetic ${device}`);
  await page.getByLabel(new RegExp(`PPMS.*Weekly M\\(T\\) ${device}`)).check();
  await page.getByLabel(new RegExp(`${s.code}.*Weekly sample`)).check();
  await page
    .getByRole("button", { name: "Add data link", exact: true })
    .click();
  await page.getByLabel("Link 1 label").fill("Synthetic dataset");
  await page.getByLabel("Link 1 URL").fill("https://example.test/private-data");
  await accessible(page);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Draft saved privately");
  await page.reload();
  await openWeekly(page);
  await expect(page.getByLabel("Work completed", { exact: true })).toHaveValue(
    `workCompleted: synthetic ${device}`,
  );
  await page
    .getByRole("button", { name: "Save and review submission", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Review before submitting",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Scheduled booking only; actual use has not been recorded."),
  ).toBeVisible();
  await accessible(page);
  await page
    .getByLabel("I have reviewed this report and its selected records.")
    .check();
  await page
    .getByRole("button", { name: "Confirm submission", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Report submitted");
  await page
    .getByLabel("Main results", { exact: true })
    .fill(`Revised results ${device}`);
  await page
    .getByRole("button", { name: "Save and review submission", exact: true })
    .click();
  await page
    .getByLabel("I have reviewed this report and its selected records.")
    .check();
  await page
    .getByRole("button", { name: "Confirm submission", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Report submitted");
  await page
    .getByRole("button", { name: "View submitted history", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    `Revised results ${device}`,
  );
  await page.getByLabel("Submitted revision").selectOption("1");
  await expect(page.getByRole("dialog")).toContainText(
    `results: synthetic ${device}`,
  );
  await expect(page.getByRole("dialog")).not.toContainText(
    `Revised results ${device}`,
  );
  await accessible(page);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await write(page, `/bookings/${b.id}/actions`, {
    action: "cancel",
    version: b.version,
    summary: "Synthetic browser check complete",
  });
});
test("assigned mentor review, follow-ups, notifications, filters and printable meeting summary", async ({
  page,
}, info) => {
  const device = info.project.name,
    week = addDays(weekStart(), -7);
  await login(page, "member", device);
  let r = await write(page, "/weekly/reports", {
    week,
    content: {
      ...emptyReport,
      project: `Weekly ${device}`,
      workCompleted: "Prepared samples",
      experiments: "No measurements claimed",
      results: "Calibration needs review",
      blockers: "None",
      nextPlan: "Discuss setup",
      helpNeeded: "Check calibration",
    },
  });
  const preview = await write(page, `/weekly/reports/${r.id}/preview`, {
    version: r.version,
  });
  r = await write(page, `/weekly/reports/${r.id}/submit`, preview);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, "mentor", device);
  await openWeekly(page);
  page.once("dialog", (d) => d.accept());
  await page.getByLabel("Week beginning (Monday)").fill(week);
  await page
    .getByRole("button", { name: "Review weekly reports", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Weekly meeting summary", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".weekly-summary")).toHaveCount(1);
  await page
    .getByRole("button", {
      name: `Open report by Weekly ${device} member`,
      exact: true,
    })
    .click();
  await page.getByLabel("Comment type").selectOption("followup");
  await page.getByLabel("Comment or follow-up").fill("Bring calibration notes");
  await page
    .getByLabel("Follow-up due date (optional)")
    .fill(addDays(weekStart(), 5));
  await page
    .getByRole("button", { name: "Add follow-up", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Follow-up: open");
  await page
    .getByRole("button", { name: "Mark revision 1 reviewed", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("reviewed revision 1");
  await accessible(page);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, "member", device);
  await page
    .getByRole("button", { name: "Notifications", exact: true })
    .click();
  await page
    .locator("article")
    .filter({ hasText: "followup" })
    .getByRole("button", { name: "View weekly report", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Complete follow-up", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Follow-up: done");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, "supervisor", device);
  await openWeekly(page);
  page.once("dialog", (d) => d.accept());
  await page.getByLabel("Week beginning (Monday)").fill(week);
  await page
    .getByRole("button", { name: "Review weekly reports", exact: true })
    .click();
  await page.getByLabel("Filter by project").fill(`Weekly ${device}`);
  await expect(page.locator(".weekly-summary")).toHaveCount(3);
  await page
    .getByLabel("Filter by person")
    .selectOption({ label: `Weekly ${device} member` });
  await expect(page.locator(".weekly-summary")).toHaveCount(1);
  await page
    .getByText("Report content and discussion", { exact: true })
    .click();
  await accessible(page);
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await page.emulateMedia({ media: "print" });
  await expect(
    page.getByText("Calibration needs review", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Bring calibration notes", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).not.toBeVisible();
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, "other", device);
  await openWeekly(page);
  await expect(
    page.getByRole("button", { name: "Review weekly reports", exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get(`/api/weekly/reports/${r.id}`)).status()).toBe(
    404,
  );
});
