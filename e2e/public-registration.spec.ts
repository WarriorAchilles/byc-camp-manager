import { expect, test } from "@playwright/test";

const adminOrigin = process.env.E2E_ADMIN_URL ?? "http://localhost:5173";

test.describe("public registration shells", () => {
  test("family, worker, and leader routes expose separate public shells", async ({ page }) => {
    await page.goto("/register/family");
    await expect(page.getByRole("heading", { name: "Camper registration", level: 1 })).toBeVisible();
    await page.getByRole("link", { name: "Register as a worker" }).click();
    await expect(page.getByRole("heading", { name: "Worker registration", level: 1 })).toBeVisible();
    await page.getByRole("link", { name: "Register as a leader" }).click();
    await expect(page.getByRole("heading", { name: "Leader registration", level: 1 })).toBeVisible();
  });

  test("registration origin never renders the admin login", async ({ page }) => {
    const response = await page.goto("/admin/login");
    if (response?.status() === 404) {
      return;
    }
    await expect(page).toHaveURL(/\/register\/family$/);
    await expect(page.getByRole("heading", { name: "Camper registration", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: /admin/i })).toHaveCount(0);
  });

  test("admin origin never renders public registration", async ({ page }) => {
    const response = await page.goto(`${adminOrigin}/register/family`);
    if (response?.status() === 404) {
      return;
    }
    await expect(page).not.toHaveURL(/\/register\/family$/);
    await expect(page.getByRole("heading", { name: "Camper registration", level: 1 })).toHaveCount(0);
  });
});
