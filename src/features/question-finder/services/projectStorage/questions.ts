import type { QuestionsRow } from "../../domain";

// oxlint-disable-next-line typescript/consistent-type-definitions -- SQLite rows require an implicit index signature.
type StoredQuestion = {
  id: string;
  project: string;
  channel_id: string;
  channel_name: string;
  author_name: string;
  comments: number;
  question: string;
  is_post: number;
  avatar_url: string | null;
  date_asked: string;
  url: string;
};

export const saveQuestions = (
  sql: SqlStorage,
  rows: readonly QuestionsRow[]
): void => {
  for (const row of rows) {
    sql.exec(
      `INSERT INTO questions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET project=excluded.project, channel_id=excluded.channel_id,
      channel_name=excluded.channel_name, author_name=excluded.author_name, comments=excluded.comments,
      question=excluded.question, is_post=excluded.is_post, avatar_url=excluded.avatar_url,
      date_asked=excluded.date_asked, url=excluded.url`,
      row.id,
      row.project,
      row.channel.id,
      row.channel.name,
      row.name,
      row.comments,
      row.question,
      Number(row.isPost),
      row.avatarUrl,
      row.dateAsked.toISOString(),
      row.url
    );
  }
};

export const readQuestions = (sql: SqlStorage): QuestionsRow[] =>
  sql
    .exec<StoredQuestion>("SELECT * FROM questions ORDER BY length(id), id")
    .toArray()
    .map((row) => ({
      id: row.id,
      project: row.project,
      channel: { id: row.channel_id, name: row.channel_name },
      name: row.author_name,
      comments: row.comments,
      question: row.question,
      isPost: row.is_post === 1,
      avatarUrl: row.avatar_url,
      dateAsked: new Date(row.date_asked),
      url: row.url,
    }));
