import { Banner } from "@astryxdesign/core/Banner";
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
        <ul>
          {failedChannels.map(({ name, reason }) => (
            <li key={name}>
              <Text type="body">
                <strong>#{name}</strong> {reason}
              </Text>
            </li>
          ))}
        </ul>
      }
    />
  );
};
