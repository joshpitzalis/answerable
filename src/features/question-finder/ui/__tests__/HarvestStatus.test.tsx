// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { HarvestStatus as Status } from "../../domain/harvest.values";
import { HarvestStatus } from "../HarvestStatus";

describe("saved Harvest status", () => {
  afterEach(cleanup);

  it.each<{
    status: Status["status"];
    label: string;
    disabled: boolean;
    busy?: boolean;
    nextEligibleAt?: number | null;
  }>([
    { status: "new", label: "Starting collection", disabled: true },
    { status: "working", label: "Collecting questions", disabled: true },
    { status: "waiting", label: "Waiting to continue", disabled: true },
    {
      status: "waiting",
      label: "Waiting to continue",
      disabled: true,
      nextEligibleAt: null,
    },
    { status: "partial", label: "Collection incomplete", disabled: false },
    { status: "current", label: "Up to date", disabled: false },
    { status: "suspended", label: "Collection paused", disabled: true },
    { status: "current", label: "Refreshing", disabled: true, busy: true },
    {
      status: "partial",
      label: "Collection incomplete",
      disabled: true,
      busy: true,
    },
  ])(
    "shows $status honestly and gates Refresh",
    ({ status, label, disabled, busy = false, nextEligibleAt = 2000 }) => {
      render(
        <HarvestStatus
          harvest={{
            status,
            activatedAt: 1,
            lastAttempt: 1,
            lastCompleteSuccess: 1,
            initialCoverage: "latest-50",
            pendingProcessing: 0,
            nextEligibleAt,
          }}
          busy={busy}
          unavailable={false}
          refresh={() => {}}
        />
      );
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.queryByText(/^Last attempt:/u)).toBeNull();
      expect(
        screen.queryByText(/^Some questions could not be collected/u) !== null
      ).toBe(status === "partial");
      expect(
        screen.queryByText(/^Collection can continue after/u) !== null
      ).toBe(status === "waiting" && nextEligibleAt !== null);
      expect(
        screen.getByRole("button", { name: "Refresh" }).hasAttribute("disabled")
      ).toBe(disabled);
    }
  );
});
