import { navigate } from "./navigation.js";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
test.setTimeout(90000);
async function login(page: Page, role: string, device: string) {
  await page.goto("/");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`browser-weekly-${role}-${device}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Browser-tests-only-passphrase!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Lab overview", exact: true }),
  ).toBeVisible();
}
async function signOut(page: Page) {
  if (await page.getByRole("dialog").count())
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
}
async function open(page: Page) {
  await navigate(page, "Meetings & Notices");
  await expect(
    page.getByRole("combobox", { name: "Meeting view", exact: true }),
  ).toBeVisible();
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
  if (await page.getByRole("dialog").count())
    expect(
      await page
        .getByRole("dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
}
test("selected-attendee meeting lifecycle, notes, owned actions, IST export and private history", async ({
  page,
}, info) => {
  const d = info.project.name,
    title = `Synthetic private meeting ${d}`;
  await login(page, "supervisor", d);
  await open(page);
  await page.getByRole("button", { name: "New meeting", exact: true }).click();
  await page.getByLabel("Meeting title", { exact: true }).fill(title);
  await page
    .getByRole("combobox", { name: "Meeting type", exact: true })
    .selectOption("individual");
  await page
    .getByRole("checkbox", { name: `Weekly ${d} member`, exact: true })
    .check();
  await page
    .getByLabel("Start (Asia/Kolkata)", { exact: true })
    .fill("2035-03-02T00:15");
  await page
    .getByLabel("End (Asia/Kolkata)", { exact: true })
    .fill("2035-03-02T01:15");
  await page
    .getByLabel("Agenda", { exact: true })
    .fill("Synthetic agenda; private to selected attendees and managers");
  await page.getByLabel("Venue", { exact: true }).fill("Synthetic room");
  await page
    .getByLabel("Video link (optional)", { exact: true })
    .fill("https://example.test/room");
  await accessible(page);
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/meetings") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Schedule meeting", exact: true })
    .click();
  const meeting = await (await response).json();
  await expect(page.getByRole("dialog")).toContainText(title);
  await page
    .getByRole("button", { name: "Edit / reschedule meeting", exact: true })
    .click();
  await page
    .getByLabel("Start (Asia/Kolkata)", { exact: true })
    .fill("2035-03-03T00:15");
  await page
    .getByLabel("End (Asia/Kolkata)", { exact: true })
    .fill("2035-03-03T01:15");
  await page
    .getByLabel("Change reason (optional)", { exact: true })
    .fill("Synthetic reschedule");
  await page
    .getByRole("button", { name: "Save meeting changes", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Edit / reschedule meeting",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Add meeting note", { exact: true })
    .fill("Private synthetic retained meeting note");
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Private synthetic retained meeting note",
  );
  await page
    .getByLabel("Action item", { exact: true })
    .fill(`Prepare synthetic action ${d}`);
  await page
    .getByRole("combobox", { name: "Action owner", exact: true })
    .selectOption({ label: `Weekly ${d} member` });
  await page
    .getByLabel("Action due date (optional, Asia/Kolkata)", { exact: true })
    .fill("2035-03-05");
  await page
    .getByRole("button", { name: "Assign action", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    `Prepare synthetic action ${d}`,
  );
  await accessible(page);
  await signOut(page);
  await login(page, "member", d);
  await expect(
    page.getByRole("button", {
      name: `Prepare synthetic action ${d}`,
      exact: true,
    }),
  ).toBeVisible();
  await open(page);
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Edit / reschedule meeting",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Complete action", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    `Completed by Weekly ${d} member`,
  );
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export calendar (.ics)", exact: true })
    .click();
  const download = await downloadPromise;
  const ics = await readFile((await download.path())!, "utf8");
  expect(ics).toContain("DTSTART;TZID=Asia/Kolkata:20350303T001500");
  expect(ics).toContain(`UID:${meeting.id}@quemat-lab-hub`);
  expect(ics).toContain("SEQUENCE:2");
  await page.getByText("Meeting change history", { exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Synthetic reschedule");
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("private-meeting.png"),
    fullPage: true,
  });
  await page.reload();
  await open(page);
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    `Completed by Weekly ${d} member`,
  );
  await signOut(page);
  await login(page, "other", d);
  await open(page);
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get(`/api/meetings/${meeting.id}`)).status()).toBe(
    404,
  );
  expect(
    (await page.request.get(`/api/meetings/${meeting.id}/calendar`)).status(),
  ).toBe(404);
  await signOut(page);
  await login(page, "supervisor", d);
  await open(page);
  await page.getByRole("button", { name: title, exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Cancel meeting", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("cancelled");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Meeting view", exact: true })
    .selectOption("cancelled");
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toBeVisible();
});
test("notice drafts, publishing, explicit per-revision reading, pin changes, history and withdrawal", async ({
  page,
}, info) => {
  const d = info.project.name,
    title = `Synthetic notice ${d}`;
  await login(page, "supervisor", d);
  await open(page);
  await page.getByRole("button", { name: "New notice", exact: true }).click();
  await page.getByLabel("Notice title", { exact: true }).fill(title);
  await page
    .getByRole("textbox", { name: "Notice text", exact: true })
    .fill("Synthetic notice: please read, without implying approval");
  await page
    .getByRole("checkbox", { name: "Pin on dashboard", exact: true })
    .check();
  await page
    .getByRole("checkbox", {
      name: "Request explicit read acknowledgement",
      exact: true,
    })
    .check();
  await page
    .getByLabel("Expiry (Asia/Kolkata, optional)", { exact: true })
    .fill("2035-03-10T00:15");
  await accessible(page);
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/notices") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Save notice draft", exact: true })
    .click();
  const notice = await (await response).json();
  await expect(page.getByRole("dialog")).toContainText(
    "Manager draft; not visible to members",
  );
  await page
    .getByRole("button", { name: "Publish notice", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("revision 2");
  await signOut(page);
  await login(page, "member", d);
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toBeVisible();
  await open(page);
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Confirm read acknowledgement",
      exact: true,
    }),
  ).toBeDisabled();
  expect(
    (await (await page.request.get(`/api/notices/${notice.id}`)).json())
      .acknowledged,
  ).toBe(false);
  await page
    .getByRole("checkbox", {
      name: "I confirm I have read revision 2.",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Confirm read acknowledgement", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "Your read acknowledgement is recorded for revision 2.",
  );
  await accessible(page);
  await page.reload();
  await open(page);
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "Your read acknowledgement is recorded",
  );
  await signOut(page);
  await login(page, "supervisor", d);
  await open(page);
  await page.getByRole("button", { name: title, exact: true }).click();
  await page.getByRole("button", { name: "Edit notice", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Notice text", exact: true })
    .fill("Corrected synthetic notice; read this new revision");
  await page
    .getByRole("checkbox", { name: "Pin on dashboard", exact: true })
    .uncheck();
  await page
    .getByRole("button", { name: "Save notice changes", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("revision 3");
  await page.getByText("Read acknowledgement history", { exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    `Weekly ${d} member · revision 2`,
  );
  await signOut(page);
  await login(page, "member", d);
  await open(page);
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(
    page.getByRole("checkbox", {
      name: "I confirm I have read revision 3.",
      exact: true,
    }),
  ).not.toBeChecked();
  await page
    .getByRole("checkbox", {
      name: "I confirm I have read revision 3.",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Confirm read acknowledgement", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "revision 3",
  );
  await page.getByText("Notice revision history", { exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Synthetic notice: please read, without implying approval",
  );
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("notice-read-history.png"),
    fullPage: true,
  });
  await signOut(page);
  await login(page, "supervisor", d);
  await open(page);
  await page.getByRole("button", { name: title, exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Withdraw notice", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("withdrawn");
  await signOut(page);
  await login(page, "member", d);
  await open(page);
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get(`/api/notices/${notice.id}`)).status()).toBe(
    404,
  );
});
test("academic supervisor cannot schedule or publish; private notification details remain scoped", async ({
  page,
}, info) => {
  const d = info.project.name;
  await login(page, "other", d);
  await open(page);
  await expect(
    page.getByRole("button", { name: "New meeting", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "New notice", exact: true }),
  ).toHaveCount(0);
  const session = await (await page.request.get("/api/session")).json();
  const headers = {
    Origin: "http://127.0.0.1:3199",
    "X-CSRF-Token": session.csrfToken,
  };
  const r = await page.request.post("/api/meetings", {
    headers,
    data: {
      title: "Must reject academic role",
      kind: "group",
      attendeeIds: [session.user.id],
      startsAt: "2035-01-01T10:00:00Z",
      endsAt: "2035-01-01T11:00:00Z",
    },
  });
  expect(r.status()).toBe(403);
  expect(
    (
      await page.request.post("/api/notices", {
        headers,
        data: { title: "Must reject", body: "Synthetic" },
      })
    ).status(),
  ).toBe(403);
  await page
    .getByRole("combobox", { name: "Meeting view", exact: true })
    .selectOption("all");
  await page
    .getByRole("combobox", { name: "Notice view", exact: true })
    .selectOption("expired");
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("member-meeting-notice-view.png"),
    fullPage: true,
  });
});
