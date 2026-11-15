import type { QuestionsRow } from "../domain";

/** A row as the table shows it: the Channel flattened to its name, so it can be filtered. */
export type QuestionsTableRow = Omit<QuestionsRow, "channel"> & {
  channel: string;
};

export const toTableRows = (questions: QuestionsRow[]): QuestionsTableRow[] =>
  questions.map((question) => ({
    ...question,
    channel: question.channel.name,
  }));

export const toFieldDefs = (rows: QuestionsTableRow[]) =>
  [
    { key: "name", type: "string", label: "Name" },
    { key: "comments", type: "number", label: "Comment" },
    { key: "question", type: "string", label: "Question" },
    {
      key: "channel",
      type: "enum",
      label: "Channel",
      enumValues: [...new Set(rows.map((row) => row.channel))].map(
        (channel) => ({ value: channel, label: channel })
      ),
    },
  ] as const;
