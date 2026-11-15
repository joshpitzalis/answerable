import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
import { Markdown } from "@astryxdesign/core/Markdown";
import { Heading } from "@astryxdesign/core/Text";
import { useState } from "react";

import type { QuestionsTableRow } from "../lib/questionsTable.utils";
import { isLongQuestion, splitPostTitle } from "../lib/questionsTable.utils";

/**
 * A question as Discord wrote it, rendered as markdown. A long one is cut to a
 * fixed height so one question cannot swallow the table; Show more reveals it
 * whole. The Discord thread stays one click away either way.
 */
export const QuestionCell = ({ item }: { item: QuestionsTableRow }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { title, body } = splitPostTitle(item);
  const isLong = isLongQuestion(item.question);

  return (
    <VStack gap={1} hAlign="start">
      {title === undefined ? null : <Heading level={4}>{title}</Heading>}
      <Markdown
        density="compact"
        headingLevelStart={4}
        autolink="gfm"
        className={
          isLong && !isExpanded ? "max-h-40 overflow-hidden" : undefined
        }
      >
        {body}
      </Markdown>
      {isLong ? (
        <Button
          label={isExpanded ? "Show less" : "Show more"}
          variant="ghost"
          size="sm"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((expanded) => !expanded)}
        />
      ) : null}
      <Link href={item.url} target="_blank" rel="noreferrer">
        Open in Discord
      </Link>
    </VStack>
  );
};
