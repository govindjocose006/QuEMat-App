import { type Page } from "@playwright/test";

// Use the same collapsed More navigation as a phone user.
export async function navigate(page: Page, label: string) {
  const target = page.getByRole("button", { name: label, exact: true });
  if (!(await target.isVisible())) {
    const more = page.getByRole("button", { name: "More", exact: true });
    if (await more.isVisible()) await more.click();
  }
  await target.click();
}
