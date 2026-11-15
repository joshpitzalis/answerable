import { expect, test } from "@playwright/test";

test("lists answerable fixture questions, then reaches search from the nav", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByText(
      "Why do clownfish sleep tucked into the layers of an anemone's stinging tentacles?"
    )
  ).toBeVisible();
  // The fixture thread already answered by ME stays out of the list.
  await expect(page.getByText(/Can a mudskipper really isolate/u)).toHaveCount(
    0
  );

  await page.getByRole("link", { name: "Search" }).click();

  await expect(page).toHaveURL(/\/search$/u);
  await expect(
    page.getByRole("heading", { name: "Embed a query" })
  ).toBeVisible();
});
