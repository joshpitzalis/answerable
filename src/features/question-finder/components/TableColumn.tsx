import { Avatar } from "@astryxdesign/core/Avatar";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import type { TableColumn } from "@astryxdesign/core/Table";
import { pixel, proportional } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import type { QuestionsRow } from "#/features/question-finder/schema";
import { humanizeDate } from "#/lib/utils/format-date.ts";

export const columns: TableColumn<QuestionsRow>[] = [
	{
		key: "name",
		header: "Name",
		width: proportional(2),
		renderCell: (item: QuestionsRow) => (
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
		renderCell: (item: QuestionsRow) => (
			// ponytail: plain anchor. Row-level click needs a Table onRowClick prop
			// that doesn't exist yet — add it the day the whole row must be a link.
			<a href={item.url} target="_blank" rel="noreferrer">
				<Text type="body">{item.question}</Text>
			</a>
		),
	},
	{
		key: "comments",
		header: "Comments",
		width: pixel(140),
		renderCell: (item: QuestionsRow) => (
			<Text type="body">{item.comments}</Text>
		),
	},
];
