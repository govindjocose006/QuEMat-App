import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { navigate } from "./navigation.js";

async function login(page: Page, email: string, section = "overview") {
  await page.goto("/#" + section);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Browser-tests-only-passphrase!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}

test("member can learn, hide and reopen tips without affecting another account", async ({
  page,
}, info) => {
  const email = `browser-weekly-member-${info.project.name}@example.test`;
  await login(page, email);
  const welcome = page.getByRole("region", { name: "Start here", exact: true });
  await expect(welcome).toBeVisible();
  await expect(
    welcome.getByRole("button", { name: /^Register a sample/ }),
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("onboarding-welcome.png"),
    fullPage: true,
  });
  await welcome.getByRole("button", { name: "Open Quick Guide" }).click();
  await expect(page).toHaveURL(/#guide$/);
  await expect(page).toHaveTitle("Quick Guide | QuEMat Lab Hub");
  await expect(
    page.getByText(/For project students and interns:/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Go to Members & access" }),
  ).toHaveCount(0);
  const topic = page
    .locator("summary")
    .filter({ hasText: "Book and run a measurement" });
  await topic.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Go to Calendar", exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({
    path: info.outputPath("onboarding-guide.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Go to Calendar", exact: true })
    .click();
  await expect(page).toHaveURL(/#calendar$/);
  await page.goBack();
  await expect(page).toHaveURL(/#guide$/);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Quick Guide", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show welcome tips" }).click();
  await expect(welcome).toBeVisible();
  await welcome.getByRole("button", { name: "Hide welcome tips" }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Lab overview", exact: true }),
  ).toBeVisible();
  await expect(welcome).toHaveCount(0);
  const preference = await page.evaluate(() =>
    Object.entries(localStorage).filter(([key]) =>
      key.startsWith("quemat-welcome:"),
    ),
  );
  expect(preference).toHaveLength(1);
  expect(preference[0][1]).toBe("hidden");
  await navigate(page, "Quick Guide");
  await expect(
    page.getByRole("heading", { name: "Quick Guide", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show welcome tips" }).click();
  await expect(welcome).toBeVisible();
  await welcome.getByRole("button", { name: "Hide welcome tips" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  // This account has the academic title Supervisor, but only member permissions.
  await login(page, `browser-weekly-other-${info.project.name}@example.test`);
  await expect(welcome).toBeVisible();
  await expect(
    welcome.getByRole("button", { name: /^Register a sample/ }),
  ).toBeVisible();
  await expect(
    welcome.getByRole("button", { name: /^Arrange a meeting/ }),
  ).toHaveCount(0);
  await navigate(page, "Quick Guide");
  await expect(
    page.getByRole("button", { name: "Go to Members & access" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.goto("/#guide");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Quick Guide", exact: true }),
  ).toHaveCount(0);
});

for (const scenario of [
  { role: "mentor", title: "Write a weekly update", target: "weekly" },
  { role: "supervisor", title: "Review weekly updates", target: "weekly" },
  { role: "administrator", title: "Welcome a new member", target: "members" },
]) {
  test(`${scenario.role} receives relevant starting points and working links`, async ({
    page,
  }, info) => {
    const email =
      scenario.role === "administrator"
        ? "browser-admin@example.test"
        : `browser-weekly-${scenario.role}-${info.project.name}@example.test`;
    await login(page, email, "guide");
    const starting = page.getByRole("region", {
      name: "A simple place to start",
    });
    await expect(
      starting.getByRole("button", { name: new RegExp("^" + scenario.title) }),
    ).toBeVisible();
    await expect(
      page.getByText("Help a new member join", { exact: true }),
    ).toHaveCount(scenario.role === "administrator" ? 1 : 0);
    await noOverflow(page);
    await starting
      .getByRole("button", { name: new RegExp("^" + scenario.title) })
      .click();
    await expect(page).toHaveURL(new RegExp("#" + scenario.target + "$"));
  });
}

test("guide works with storage blocked and respects unsaved weekly text", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem", "removeItem"]) {
      Object.defineProperty(Storage.prototype, method, {
        value: () => {
          throw new DOMException("Storage blocked", "SecurityError");
        },
      });
    }
  });
  await login(page, `browser-weekly-mentor-${info.project.name}@example.test`);
  await page.getByRole("button", { name: "Hide welcome tips" }).click();
  await expect(
    page.getByRole("region", { name: "Start here", exact: true }),
  ).toHaveCount(0);
  await navigate(page, "Quick Guide");
  await page.getByRole("button", { name: "Show welcome tips" }).click();
  await expect(
    page.getByRole("region", { name: "Start here", exact: true }),
  ).toBeVisible();
  await navigate(page, "Weekly Progress");
  const work = page.getByLabel("Work completed", { exact: true });
  await work.fill("Synthetic onboarding unsaved draft");
  page.once("dialog", (dialog) => dialog.dismiss());
  await navigate(page, "Quick Guide");
  await expect(page).toHaveURL(/#weekly$/);
  await expect(work).toHaveValue("Synthetic onboarding unsaved draft");
  page.once("dialog", (dialog) => dialog.accept());
  await navigate(page, "Quick Guide");
  await expect(
    page.getByRole("heading", { name: "Quick Guide", exact: true }),
  ).toBeVisible();
});
