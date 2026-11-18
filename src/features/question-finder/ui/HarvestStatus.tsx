import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";

import type { HarvestStatus as Status } from "../domain/harvest.values";

const timestamp = (at: number) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(at);

const statusLabel = (status: Status["status"], busy: boolean) => {
  if (busy && status === "current") {
    return "Refreshing";
  }

  switch (status) {
    case "new": {
      return "Starting collection";
    }

    case "working": {
      return "Collecting questions";
    }

    case "waiting": {
      return "Waiting to continue";
    }

    case "partial": {
      return "Collection incomplete";
    }

    case "current": {
      return "Up to date";
    }

    default: {
      return "Collection paused";
    }
  }
};

export const HarvestStatus = ({
  harvest,
  busy,
  refresh,
  unavailable,
}: {
  harvest: Status;
  busy: boolean;
  refresh: () => void;
  unavailable: boolean;
}) => (
  <VStack gap={2}>
    <HStack gap={3} wrap="wrap" vAlign="center">
      <Token
        label={
          unavailable ? "Update unavailable" : statusLabel(harvest.status, busy)
        }
        size="sm"
      />
      <Text type="supporting">
        {harvest.lastCompleteSuccess === null
          ? "First collection has not completed yet."
          : `Last complete collection: ${timestamp(harvest.lastCompleteSuccess)}`}
      </Text>
      <Button
        label="Refresh"
        size="sm"
        isDisabled={
          busy ||
          !(harvest.status === "current" || harvest.status === "partial")
        }
        onClick={refresh}
      />
    </HStack>
    {harvest.lastAttempt !== null &&
    harvest.lastAttempt !== harvest.lastCompleteSuccess ? (
      <Text type="supporting">
        Last attempt: {timestamp(harvest.lastAttempt)}
      </Text>
    ) : null}
    {harvest.status === "waiting" && harvest.nextEligibleAt !== null ? (
      <Text type="supporting">
        Collection can continue after {timestamp(harvest.nextEligibleAt)}.
      </Text>
    ) : null}
    {harvest.status === "partial" ? (
      <Text type="body">
        Some questions could not be collected. Saved questions remain available;
        Refresh retries collection.
      </Text>
    ) : null}
  </VStack>
);
