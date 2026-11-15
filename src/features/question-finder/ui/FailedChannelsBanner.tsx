import { Banner } from "@astryxdesign/core/Banner";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";

import type { FailedChannel } from "../domain";

/** Partial failure: the table is still shown, so this reads as a warning. */
export const FailedChannelsBanner = ({
  failedChannels,
}: {
  failedChannels: readonly FailedChannel[];
}) => {
  if (failedChannels.length === 0) {
    return null;
  }

  return (
    <Banner
      status="warning"
      title="Some Channels could not be read"
      description={
        <VStack gap={1}>
          {failedChannels.map(({ name, reason }) => (
            <HStack key={name} gap={2}>
              <Text type="label">#{name}</Text>
              <Text type="body">{reason}</Text>
            </HStack>
          ))}
        </VStack>
      }
    />
  );
};
