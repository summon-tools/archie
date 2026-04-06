import { test, expect } from "playwright/test";

test.describe("Smoke tests", () => {
  test("login page renders", async ({ page }) => {
    await page.goto("/login");
    // The login form should be visible
    await expect(page.locator("form")).toBeVisible();
  });

  test("unauthenticated user is redirected to login", async ({ page }) => {
    await page.goto("/");
    // Should redirect to /login for unauthenticated users
    await expect(page).toHaveURL(/\/login/);
  });

  test.skip("sidebar conversation list loads after login", async () => {
    // TODO: requires seeded user credentials — implement after login helper exists
  });

  test.skip("send message in conversation", async () => {
    // TODO: requires authenticated session + seeded conversation
  });
});
