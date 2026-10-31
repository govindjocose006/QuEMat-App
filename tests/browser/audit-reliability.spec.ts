import { test, expect, type Page } from "@playwright/test";
import { navigate } from "./navigation.js";
async function login(
  page: Page,
  device: string,
  section = "samples",
  role = "mentor",
) {
  await page.goto("/#" + section);
  await page
    .getByLabel("Email", { exact: true })
    .fill(`browser-weekly-${role}-${device}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Browser-tests-only-passphrase!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
}
async function dismissNext(page: Page, action: () => Promise<unknown>) {
  const dialog = page.waitForEvent("dialog");
  const pending = action();
  await (await dialog).dismiss();
  await pending;
}
test("unsaved weekly text survives cancelled section, history, review and sign-out navigation", async ({
  page,
}, info) => {
  await login(page, info.project.name, "samples", "supervisor");
  await navigate(page, "Weekly Progress");
  const work = page.getByLabel("Work completed", { exact: true });
  await work.fill("Synthetic audit unsaved text");
  await dismissNext(page, () => navigate(page, "Samples"));
  await expect(work).toHaveValue("Synthetic audit unsaved text");
  await dismissNext(page, () => page.goBack());
  await expect(page).toHaveURL(/#weekly$/);
  await expect(work).toHaveValue("Synthetic audit unsaved text");
  await dismissNext(page, () =>
    page
      .getByRole("button", { name: "Review weekly reports", exact: true })
      .click(),
  );
  await dismissNext(page, () =>
    page.getByRole("button", { name: "Sign out", exact: true }).click(),
  );
  await expect(work).toHaveValue("Synthetic audit unsaved text");
  // Accept a section departure: only explicitly discarded text may be lost.
  page.once("dialog", (d) => d.accept());
  await navigate(page, "Samples");
  await page.goBack();
  await expect(page).toHaveURL(/#weekly$/);
  await expect(work).not.toHaveValue("Synthetic audit unsaved text");
  await page.goForward();
  await expect(page).toHaveURL(/#samples$/);
});
test("saving a weekly draft removes leave warnings and preserves its text", async ({
  page,
}, info) => {
  await login(page, info.project.name, "weekly");
  const work = page.getByLabel("Work completed", { exact: true });
  await work.fill("Synthetic audit saved text");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText("Draft saved privately.", { exact: true }),
  ).toBeVisible();
  page.on("dialog", (d) => {
    throw new Error("Unexpected saved-draft warning: " + d.message());
  });
  await navigate(page, "Samples");
  await page.goBack();
  await expect(work).toHaveValue("Synthetic audit saved text");
});
test("weekly initial-load failure can be retried without a stale error", async ({
  page,
}, info) => {
  await login(page, info.project.name);
  await page.route(
    "**/api/weekly/mine?*",
    (route) =>
      route.fulfill({
        status: 503,
        json: { error: "Synthetic weekly outage" },
      }),
    { times: 1 },
  );
  await navigate(page, "Weekly Progress");
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic weekly outage",
  );
  await page.getByRole("button", { name: "Retry loading report" }).click();
  await expect(
    page.getByLabel("Work completed", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
test("calendar retains newer date results when an older response arrives last", async ({
  page,
}, info) => {
  await login(page, info.project.name);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let oldStarted = false,
    oldCompleted = false;
  await page.route("**/api/bookings?*", async (route) => {
    const url = new URL(route.request().url());
    const from = url.searchParams.get("from")!;
    const date = new Date(Date.parse(from) + 330 * 60000)
      .toISOString()
      .slice(0, 10);
    if (date === "2032-01-01") {
      oldStarted = true;
      await gate;
    }
    const json =
      date === "2032-01-02"
        ? [
            {
              id: "synthetic-new",
              instrumentName: "Synthetic audit PPMS",
              operatorName: "Synthetic member",
              measurementType: "New date measurement",
              sampleSnapshots: [],
              status: "confirmed",
              startsAt: "2032-01-02T04:30:00Z",
              endsAt: "2032-01-02T05:30:00Z",
            },
          ]
        : [];
    await route.fulfill({ json });
    if (date === "2032-01-01") oldCompleted = true;
  });
  await navigate(page, "Calendar");
  await page.getByLabel("Date", { exact: true }).fill("2032-01-01");
  await expect.poll(() => oldStarted).toBe(true);
  await expect(
    page.getByText("Loading schedule…", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No reservations", { exact: true })).toHaveCount(
    0,
  );
  await page.getByLabel("Date", { exact: true }).fill("2032-01-02");
  await expect(
    page.getByRole("button").filter({ hasText: "New date measurement" }),
  ).toBeVisible();
  release();
  await expect.poll(() => oldCompleted).toBe(true);
  // Allow React to process the stale response before checking the retained tile.
  await page.waitForTimeout(200);
  await expect(
    page.getByRole("button").filter({ hasText: "New date measurement" }),
  ).toBeVisible();
});
for (const scenario of [
  {
    section: "Chemicals & Orders",
    path: "**/api/orders?*",
    empty: "No requests in this view.",
    retry: "Refresh orders",
  },
  {
    section: "Issues & Requests",
    path: "**/api/issues?*",
    empty: "No issues match this view.",
    retry: "Retry issues",
  },
  {
    section: "Meetings & Notices",
    path: "**/api/meetings?*",
    empty: "No meetings in this view.",
    retry: "Retry meetings and notices",
  },
])
  test(`${scenario.section} does not claim empty data after a failed read`, async ({
    page,
  }, info) => {
    await login(page, info.project.name);
    await page.route(
      scenario.path,
      (route) =>
        route.fulfill({
          status: 503,
          json: { error: "Synthetic list outage" },
        }),
      { times: 1 },
    );
    await navigate(page, scenario.section);
    await expect(page.getByRole("alert")).toContainText(
      "Synthetic list outage",
    );
    await expect(page.getByText(scenario.empty, { exact: true })).toHaveCount(
      0,
    );
    await page
      .getByRole("button", { name: scenario.retry, exact: true })
      .click();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
test("malformed sample response shows a recoverable error instead of crashing", async ({
  page,
}, info) => {
  await login(page, info.project.name, "orders");
  await page.route(
    "**/api/samples",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html>synthetic upstream response</html>",
      }),
    { times: 1 },
  );
  await navigate(page, "Samples");
  await expect(page.getByRole("alert")).toContainText("unexpected response");
  await expect(
    page.getByText("No active samples.", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Retry samples", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Samples", exact: true }),
  ).toBeVisible();
});

test("sign-in recovers when the anonymous session cookie has expired", async ({
  page,
  context,
}, info) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await page
    .getByLabel("Email", { exact: true })
    .fill(`browser-weekly-member-${info.project.name}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Browser-tests-only-passphrase!");
  // Reproduce browser expiry while preserving the open form and its old CSRF token.
  await context.clearCookies();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
});

for (const filter of ["person", "project"] as const)
  test(`failed ${filter} review filter hides stale results and retries the current selection`, async ({
    page,
  }, info) => {
    await login(page, info.project.name, "weekly", "supervisor");
    await page
      .getByRole("button", { name: "Review weekly reports", exact: true })
      .click();
    await expect(page.locator(".weekly-summary").first()).toBeVisible();
    let failNext = true;
    await page.route("**/api/weekly/review?*", (route) => {
      if (new URL(route.request().url()).searchParams.has(filter) && failNext) {
        failNext = false;
        return route.fulfill({
          status: 503,
          json: { error: "Synthetic filtered review outage" },
        });
      }
      return route.continue();
    });
    if (filter === "person")
      await page
        .getByLabel("Filter by person")
        .selectOption({ label: `Weekly ${info.project.name} member` });
    else
      await page
        .getByLabel("Filter by project")
        .fill(`Weekly ${info.project.name}`);
    await expect(page.getByRole("alert")).toContainText(
      "Synthetic filtered review outage",
    );
    await expect(page.locator(".weekly-print")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Print weekly meeting summary" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Retry loading review" }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator(".weekly-summary").first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Print weekly meeting summary" }),
    ).toBeEnabled();
    if (filter === "person") {
      await expect(page.locator(".weekly-summary")).toHaveCount(1);
      await expect(page.locator(".weekly-summary h3")).toContainText(
        `Weekly ${info.project.name} member`,
      );
    } else {
      await expect(page.getByLabel("Filter by project")).toHaveValue(
        `Weekly ${info.project.name}`,
      );
    }
  });
