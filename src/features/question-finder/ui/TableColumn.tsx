import { Avatar } from "@astryxdesign/core/Avatar";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import type { TableColumn } from "@astryxdesign/core/Table";
import { pixel, proportional } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";

import type { QuestionsRow } from "#/features/question-finder/domain";
import { humanizeDate } from "#/lib/utils/format-date.ts";

/** A row as the table shows it: the Channel flattened to its name, so it can be filtered. */
export type QuestionsTableRow = Omit<QuestionsRow, "channel"> & {
  channel: string;
};

export const columns: TableColumn<QuestionsTableRow>[] = [
  {
    key: "name",
    header: "Name",
    width: proportional(2),
    renderCell: (item: QuestionsTableRow) => (
      <HStack gap={3} vAlign="center">
        <Avatar name={item.name} size="md" />
        <VStack gap={0}>
          <Text type="body">{item.name}</Text>
          <Text type="supporting" color="secondary">
            {humanizeDate(item.dateAsked)}
          </Text>
        </VStack>
      </HStack>
    ),
  },
  {
    key: "question",
    header: "Question",
    width: proportional(5),
    renderCell: (item: QuestionsTableRow) => (
      // ponytail: plain anchor. Row-level click needs a Table onRowClick prop
      // that doesn't exist yet — add it the day the whole row must be a link.
      <a href={item.url} target="_blank" rel="noreferrer">
        <Text type="body">{item.question}</Text>
      </a>
    ),
  },
  {
    key: "channel",
    header: "Channel",
    width: pixel(180),
    renderCell: (item: QuestionsTableRow) => (
      <Text type="body">{item.channel}</Text>
    ),
  },
  {
    key: "comments",
    header: "Comments",
    width: pixel(140),
    renderCell: (item: QuestionsTableRow) => (
      <Text type="body">{item.comments}</Text>
    ),
  },
];
