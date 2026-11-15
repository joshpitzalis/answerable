import { expect, test } from "@playwright/test";

const CLOWNFISH = /clownfish sleep tucked/u;
const XSTATE_STOP_ACTORS = /stop child actors by hand/u;
const XSTATE_GUARDS = /Can guards read the event/u;

test("shows the failure with Retry, and Retry loads the questions without a reload", async ({
  page,
}) => {
  await page.route("**/_serverFn/**", (route) => route.abort());
  await page.goto("/");

  await expect(page.getByText("Questions could not be loaded")).toBeVisible();

  await page.unroute("**/_serverFn/**");
  await page.getByRole("button", { name: "Retry" }).click();

  await expect(page.getByText(CLOWNFISH)).toBeVisible();
});

test("the root URL redirects to the first Project and lists its answerable fixture questions, then reaches search from the nav", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/effect$/u);
  await expect(
    page.getByRole("heading", { name: "Effect Questions" })
  ).toBeVisible();
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

test("each Project has a tab with its own URL, marked when current, showing only its questions", async ({
  page,
}) => {
  await page.goto("/effect");

  const effectTab = page.getByRole("link", { name: "Effect", exact: true });
  const xstateTab = page.getByRole("link", { name: "XState", exact: true });

  await expect(effectTab).toHaveAttribute("aria-current", "page");
  await expect(xstateTab).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByText(CLOWNFISH)).toBeVisible();

  await xstateTab.click();

  await expect(page).toHaveURL(/\/xstate$/u);
  await expect(xstateTab).toHaveAttribute("aria-current", "page");
  await expect(effectTab).not.toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "XState Questions" })
  ).toBeVisible();
  // Questions from two different XState Channels, none from Effect.
  await expect(page.getByText(XSTATE_STOP_ACTORS)).toBeVisible();
  await expect(page.getByText(XSTATE_GUARDS)).toBeVisible();
  await expect(page.getByText(CLOWNFISH)).toHaveCount(0);
  // Answered by the XState owner, not answerable, and not answerable.
  await expect(page.getByText(/Do delayed transitions restart/u)).toHaveCount(
    0
  );
  await expect(page.getByText(/pizza topping/u)).toHaveCount(0);
  await expect(page.getByText(/dark theme/u)).toHaveCount(0);
});

test("the Effect tab shows its single Channel in the Channel column", async ({
  page,
}) => {
  await page.goto("/effect");

  await expect(
    page.getByRole("columnheader", { name: "Channel" })
  ).toBeVisible();
  await expect(
    page
      .getByRole("row", { name: CLOWNFISH })
      .getByText("effect-help", { exact: true })
  ).toBeVisible();
});

test("the XState table shows each question's Channel and filters the Channels apart, and clearing restores all", async ({
  page,
}) => {
  await page.goto("/xstate");

  const stopActors = page.getByRole("row", { name: XSTATE_STOP_ACTORS });
  const guards = page.getByRole("row", { name: XSTATE_GUARDS });

  await expect(stopActors.getByText("general", { exact: true })).toBeVisible();
  await expect(guards.getByText("help", { exact: true })).toBeVisible();

  await page.getByRole("combobox", { name: "Search" }).click();
  await page.getByRole("option", { name: "Channel" }).click();
  await page.getByRole("combobox", { name: "Value" }).click();
  await page.getByRole("option", { name: "help" }).click();

  await expect(guards).toBeVisible();
  await expect(stopActors).toHaveCount(0);

  await page.getByRole("button", { name: "Clear all" }).click();

  await expect(guards).toBeVisible();
  await expect(stopActors).toBeVisible();
});

test("reload keeps the tab, and back and forward move between tabs", async ({
  page,
}) => {
  await page.goto("/effect");
  await page.getByRole("link", { name: "XState", exact: true }).click();
  await expect(page.getByText(XSTATE_GUARDS)).toBeVisible();

  await page.reload();

  await expect(page).toHaveURL(/\/xstate$/u);
  await expect(page.getByText(XSTATE_GUARDS)).toBeVisible();

  await page.goBack();

  await expect(page).toHaveURL(/\/effect$/u);
  await expect(page.getByText(CLOWNFISH)).toBeVisible();

  await page.goForward();

  await expect(page).toHaveURL(/\/xstate$/u);
  await expect(page.getByText(XSTATE_GUARDS)).toBeVisible();
});

test("switching tabs loads again, with no Refresh button", async ({ page }) => {
  let loads = 0;

  await page.route("**/_serverFn/**", (route) => {
    loads += 1;

    return route.continue();
  });
  await page.goto("/effect");
  await expect(page.getByText(CLOWNFISH)).toBeVisible();
  const afterFirstLoad = loads;

  await page.getByRole("link", { name: "XState", exact: true }).click();
  await expect(page.getByText(XSTATE_GUARDS)).toBeVisible();
  await page.getByRole("link", { name: "Effect", exact: true }).click();
  await expect(page.getByText(CLOWNFISH)).toBeVisible();

  expect(loads).toBe(afterFirstLoad + 2);
  await expect(page.getByRole("button", { name: /refresh/iu })).toHaveCount(0);
});

test("an unknown Project slug shows not-found", async ({ page }) => {
  await page.goto("/nope");

  await expect(page.getByText("Project not found")).toBeVisible();
});
