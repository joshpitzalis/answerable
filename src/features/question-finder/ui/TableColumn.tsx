import { Avatar } from "@astryxdesign/core/Avatar";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import type { TableColumn } from "@astryxdesign/core/Table";
import { pixel, proportional } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";

import { humanizeDate } from "#/lib/utils/format-date.ts";

import type { QuestionsTableRow } from "../lib/questionsTable.utils";
import { QuestionCell } from "./QuestionCell";

export const columns: TableColumn<QuestionsTableRow>[] = [
  {
    key: "name",
    header: "Name",
    width: proportional(2),
    renderCell: (item: QuestionsTableRow) => (
      <HStack gap={3} vAlign="center">
        <Avatar name={item.name} src={item.avatarUrl ?? undefined} size="md" />
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
    // ponytail: a link in the cell, not a row click. Row-level click needs a Table
    // onRowClick prop that doesn't exist yet — add it the day the whole row must be a link.
    renderCell: (item: QuestionsTableRow) => <QuestionCell item={item} />,
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
