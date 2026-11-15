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

const LONG_LINES = 6;
const LONG_CHARACTERS = 400;

/** Long enough that the table cuts the question short behind Show more. */
export const isLongQuestion = (question: string): boolean =>
  question.length > LONG_CHARACTERS || question.split("\n").length > LONG_LINES;

/**
 * A forum post's question is `"{title}\n\n{first message}"`: the title is the
 * text before the first blank line. A text message has no title.
 */
export const splitPostTitle = (
  row: Pick<QuestionsTableRow, "isPost" | "question">
): { readonly title: string | undefined; readonly body: string } => {
  const end = row.question.indexOf("\n\n");

  return row.isPost && end !== -1
    ? {
        body: row.question.slice(end + 2),
        title: row.question.slice(0, end),
      }
    : { body: row.question, title: undefined };
};

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
