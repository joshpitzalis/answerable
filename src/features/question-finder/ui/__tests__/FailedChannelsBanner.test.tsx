// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FailedChannelsBanner } from "../FailedChannelsBanner";

describe(FailedChannelsBanner, () => {
  afterEach(cleanup);

  it("renders nothing when no Channel failed", () => {
    const { container } = render(<FailedChannelsBanner failedChannels={[]} />);

    expect(container.innerHTML).toBe("");
  });

  it("names each failed Channel with its reason", () => {
    render(
      <FailedChannelsBanner
        failedChannels={[
          {
            name: "effect-chat",
            reason: "Rate-limited by Discord: still limited after 2 retries",
          },
          { name: "help", reason: "GET /x returned 401" },
        ]}
      />
    );

    expect(screen.getByText("Some Channels could not be read")).toBeTruthy();
    expect(screen.getByText("#effect-chat")).toBeTruthy();
    expect(
      screen.getByText("Rate-limited by Discord: still limited after 2 retries")
    ).toBeTruthy();
    expect(screen.getByText("#help")).toBeTruthy();
    expect(screen.getByText("GET /x returned 401")).toBeTruthy();
  });
});
