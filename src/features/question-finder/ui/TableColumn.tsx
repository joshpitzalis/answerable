import { Avatar } from "@astryxdesign/core/Avatar";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
import type { TableColumn } from "@astryxdesign/core/Table";
import { pixel, proportional } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";

import { humanizeDate } from "#/lib/utils/format-date.ts";

import type { QuestionsTableRow } from "../lib/questionsTable.utils";

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
      // ponytail: link, not a row click. Row-level click needs a Table onRowClick
      // prop that doesn't exist yet — add it the day the whole row must be a link.
      <Link href={item.url} target="_blank" rel="noreferrer">
        {item.question}
      </Link>
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
