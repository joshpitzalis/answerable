import { Avatar } from "@astryxdesign/core/Avatar";
import { HStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";

import type { Contributor } from "../domain";

/**
 * The contributors with the most responses as one compact strip of tokens that
 * wraps to further lines on a narrow screen. Nothing when there are none.
 */
export const TopContributors = ({
  contributors,
}: {
  contributors: readonly Contributor[];
}) => {
  if (contributors.length === 0) {
    return null;
  }

  return (
    <HStack
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- fieldset has a browser border, padding and min-content width that stop the strip wrapping
      role="group"
      aria-label="Top contributors"
      gap={2}
      vAlign="center"
      wrap="wrap"
    >
      <Text type="supporting">Top contributors</Text>
      {contributors.map(({ name, responses, avatarUrl }) => (
        <Token
          key={name}
          label={name}
          description={`${responses} ${responses === 1 ? "response" : "responses"}`}
          icon={
            // Decoration: the name beside it already says who this is.
            <HStack aria-hidden>
              <Avatar
                name={name}
                src={avatarUrl ?? undefined}
                size="xsm"
                tooltip={false}
              />
            </HStack>
          }
          endContent={<Text type="label">{responses}</Text>}
        />
      ))}
    </HStack>
  );
};
