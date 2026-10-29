import { test, expect, type Page } from "@playwright/test";
import { navigate } from "./navigation.js";

async function login(page: Page, device: string) {
  await page.goto("/#samples");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`browser-weekly-supervisor-${device}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Browser-tests-only-passphrase!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
}
const cases = [
  {
    path: "meetings",
    label: "Meeting view",
    initial: "upcoming",
    next: "past",
    more: "More meetings",
  },
  {
    path: "notices",
    label: "Notice view",
    initial: "current",
    next: "expired",
    more: "More notices",
  },
] as const;
function result(title: string, hasMore = false) {
  return {
    items: [
      {
        id: title,
        title,
        kind: "group",
        status: "published",
        attendees: [],
        startsAt: "2032-01-02T04:30:00Z",
        endsAt: "2032-01-02T05:30:00Z",
      },
    ],
    hasMore,
  };
}
for (const c of cases) {
  for (const stale of ["view-success", "page-error"] as const)
    test(`${c.path} retains the selected view after a stale ${stale}`, async ({
      page,
    }, info) => {
      await login(page, info.project.name);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started = false,
        completed = false;
      await page.route(`**/api/${c.path}?*`, async (route) => {
        const params = new URL(route.request().url()).searchParams;
        const old =
          stale === "view-success"
            ? params.get("view") === "all"
            : params.get("offset") === "50";
        if (old) {
          started = true;
          await gate;
          await route.fulfill(
            stale === "page-error"
              ? { status: 503, json: { error: "Outdated page failure" } }
              : { json: result("Outdated list", true) },
          );
          completed = true;
          return;
        }
        await route.fulfill({
          json: result(
            params.get("view") === c.next ? "Selected list" : "Initial list",
            params.get("view") === c.initial,
          ),
        });
      });
      try {
        await navigate(page, "Meetings & Notices");
        await expect(
          page.getByRole("button", { name: "Initial list", exact: true }),
        ).toBeVisible();
        if (stale === "view-success")
          await page
            .getByRole("combobox", { name: c.label, exact: true })
            .selectOption("all");
        else
          await page.getByRole("button", { name: c.more, exact: true }).click();
        await expect.poll(() => started).toBe(true);
        await expect(
          page.getByText("Loading meetings and notices…", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Initial list", exact: true }),
        ).toHaveCount(0);
        await page
          .getByRole("combobox", { name: c.label, exact: true })
          .selectOption(c.next);
        await expect(
          page.getByRole("button", { name: "Selected list", exact: true }),
        ).toBeVisible();
        release();
        await expect.poll(() => completed).toBe(true);
        await page.waitForTimeout(200);
        await expect(
          page.getByRole("button", { name: "Selected list", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Outdated list", exact: true }),
        ).toHaveCount(0);
        await expect(page.getByRole("alert")).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: c.more, exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("combobox", { name: c.label, exact: true }),
        ).toHaveValue(c.next);
      } finally {
        release();
      }
    });

  test(`${c.path} clears stale cards on a failed filter and retries that selection`, async ({
    page,
  }, info) => {
    await login(page, info.project.name);
    let failNext = true;
    await page.route(`**/api/${c.path}?*`, async (route) => {
      const selected =
        new URL(route.request().url()).searchParams.get("view") === c.next;
      if (selected && failNext) {
        failNext = false;
        await route.fulfill({
          status: 503,
          json: { error: "Selected view unavailable" },
        });
      } else
        await route.fulfill({
          json: result(
            selected ? "Recovered selection" : "Previous selection",
            !selected,
          ),
        });
    });
    await navigate(page, "Meetings & Notices");
    await expect(
      page.getByRole("button", { name: "Previous selection", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: c.label, exact: true })
      .selectOption(c.next);
    await expect(page.getByRole("alert")).toContainText(
      "Selected view unavailable",
    );
    await expect(
      page.locator(".collaboration > section .collaboration-card"),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: c.more, exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Retry meetings and notices", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Recovered selection", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(
      page.getByRole("combobox", { name: c.label, exact: true }),
    ).toHaveValue(c.next);
  });
}
