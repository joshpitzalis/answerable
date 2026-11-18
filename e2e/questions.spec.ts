import { expect, test } from "@playwright/test";

const CLOWNFISH = /clownfish sleep tucked/u;
const XSTATE_STOP_ACTORS = /stop child actors by hand/u;
const XSTATE_GUARDS = /Can guards read the event/u;

test.setTimeout(90_000);

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
  await expect(page.getByText("Up to date", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  // Owner replies arrive in later durable batches than their starters.
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
  await expect(page.getByText("Up to date", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  // Answered by the XState owner, not answerable, and not answerable.
  await expect(page.getByText(/Do delayed transitions restart/u)).toHaveCount(
    0
  );
  await expect(page.getByText(/pizza topping/u)).toHaveCount(0);
  await expect(page.getByText(/dark theme/u)).toHaveCount(0);
});

test("each Project's headline and top contributors are worked out from the fixture", async ({
  page,
}) => {
  await page.goto("/effect");

  // Ten authors with one message each: median 1; mean 1, SD 0, so 1.
  await expect(
    page.getByText("median 1 response per contributor (1 = +1 SD)")
  ).toBeVisible();

  const top = page.getByRole("group", { name: "Top contributors" });

  // All tied at 1, so the first five by name.
  await expect(top).toContainText("Fish Fan 01");
  await expect(top).toContainText("Fish Fan 05");
  await expect(top).not.toContainText("Fish Fan 06");

  await page.getByRole("link", { name: "XState", exact: true }).click();

  // Four authors with 1, 2, 1 and 1 messages: median (1 + 1) / 2 = 1; mean 1.25, SD 0.433, mean + SD 1.68, so 2.
  await expect(
    page.getByText("median 1 response per contributor (2 = +1 SD)")
  ).toBeVisible();
  // Otter Fan 02 with 2 first, then the three with 1 by name. The fixture has no
  // avatars, so each shows the initials "O0" (first letters of "Otter" and "02").
  await expect(top).toHaveText(
    /Top contributorsO0Otter Fan 022O0Otter Fan 011O0Otter Fan 031O0Otter Fan 041/u
  );
  await expect(top).not.toContainText("Fish Fan");
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
      .getByRole("row")
      .filter({ hasText: CLOWNFISH })
      .getByText("effect-help", { exact: true })
  ).toBeVisible();
});

test("the XState table shows each question's Channel and filters the Channels apart, and clearing restores all", async ({
  page,
}) => {
  await page.goto("/xstate");

  const stopActors = page
    .getByRole("row")
    .filter({ hasText: XSTATE_STOP_ACTORS });

  const guards = page.getByRole("row").filter({ hasText: XSTATE_GUARDS });

  await expect(
    stopActors.getByText("xstate-help", { exact: true })
  ).toBeVisible();
  await expect(
    guards.getByText("xstate-guards", { exact: true })
  ).toBeVisible();

  await page.getByRole("combobox", { name: "Search" }).click();
  await page.getByRole("option", { name: "Channel" }).click();
  await page.getByRole("combobox", { name: "Value" }).click();
  await page.getByRole("option", { name: "xstate-guards" }).click();

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

test("switching tabs reads saved questions again and offers Refresh", async ({
  page,
}) => {
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

  expect(loads).toBeGreaterThanOrEqual(afterFirstLoad + 2);
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
});

test("Refresh failure retains saved rows and the Channel filter, then Retry recovers", async ({
  page,
}) => {
  await page.goto("/xstate");
  await expect(page.getByText(XSTATE_GUARDS)).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
  await page.getByRole("combobox", { name: "Search" }).click();
  await page.getByRole("option", { name: "Channel" }).click();
  await page.getByRole("combobox", { name: "Value" }).click();
  await page.getByRole("option", { name: "xstate-guards" }).click();
  await page.route("**/_serverFn/**", (route) => route.abort());
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(
    page.getByText("Collection status could not be updated")
  ).toBeVisible();
  await expect(page.getByText(XSTATE_GUARDS)).toBeVisible();
  await expect(page.getByText(XSTATE_STOP_ACTORS)).toHaveCount(0);
  await page.unroute("**/_serverFn/**");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(
    page.getByText("Collection status could not be updated")
  ).toHaveCount(0);
  await expect(page.getByText(XSTATE_GUARDS)).toBeVisible();
  await expect(page.getByText(XSTATE_STOP_ACTORS)).toHaveCount(0);
  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(page.getByText(XSTATE_STOP_ACTORS)).toBeVisible();
});

test("an unknown Project slug shows not-found", async ({ page }) => {
  await page.goto("/nope");

  await expect(page.getByText("Project not found")).toBeVisible();
});

test("saved questions remain usable after Refresh and navigation at desktop and mobile sizes", async ({
  page,
}, testInfo) => {
  await page.goto("/effect");
  await expect(page.getByText("Up to date", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText(CLOWNFISH)).toBeVisible();
  await page.getByRole("link", { name: "XState", exact: true }).click();
  await expect(page.getByText(XSTATE_GUARDS)).toBeVisible();
  await page.getByRole("link", { name: "Effect", exact: true }).click();
  await expect(page.getByText(CLOWNFISH)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();

  const bodyFits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth
  );

  expect(bodyFits).toBeTruthy();
  await page.screenshot({
    path: testInfo.outputPath("mobile.png"),
    fullPage: true,
  });
});
