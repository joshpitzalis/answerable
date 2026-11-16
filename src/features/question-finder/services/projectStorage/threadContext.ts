import { invalidateProcessingContext } from "./processingContext";

export const readThreadContext = (sql: SqlStorage, starterId: string) => {
  const [thread] = sql
    .exec<{ id: string; title: string; is_post: number }>(
      "SELECT id,title,is_post FROM discord_threads WHERE starter_id=?",
      starterId
    )
    .toArray();

  if (thread === undefined) {
    return null;
  }
  const replies = sql
    .exec<{
      id: string;
      content: string;
      author_id: string;
      author_name: string;
      deleted_at: number | null;
    }>(
      "SELECT id,content,author_id,author_name,deleted_at FROM messages WHERE thread_id=? AND id != ? ORDER BY length(id),id",
      thread.id,
      starterId
    )
    .toArray();

  const visible = replies.filter((reply) => reply.deleted_at === null);

  return {
    title: thread.is_post === 1 ? thread.title : null,
    replyCount: visible.length,
    replyAuthors: visible.map((reply) => reply.author_name),
    revision: JSON.stringify([thread.title, replies]),
  };
};

export const invalidateThreadContext = (
  sql: SqlStorage,
  starterId: string
): void => {
  const context = readThreadContext(sql, starterId);

  if (context !== null) {
    invalidateProcessingContext(sql, starterId, context.revision);
  }
};
