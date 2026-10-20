import { db } from "./client";

/**
 * The server's warnings and errors, as `server_logs` rows. The server inserts
 * them (`apps/server/src/record.ts`); the web app only lets go of old ones,
 * from the status cron.
 */

/** How long a line is kept when `LOG_RETENTION_DAYS` is unset. `/privacy` names this number. */
export const DEFAULT_LOG_RETENTION_DAYS = 30;

/**
 * `LOG_RETENTION_DAYS`, in whole days. A value that is not a positive whole
 * number is a mistake in the project settings: it is reported and the
 * default is kept, so the cron's round still runs.
 */
export function logRetentionDays(): number {
  const raw = process.env.LOG_RETENTION_DAYS?.trim();
  if (!raw) return DEFAULT_LOG_RETENTION_DAYS;
  const days = Number(raw);
  if (Number.isInteger(days) && days > 0) return days;
  console.warn(`server-logs: LOG_RETENTION_DAYS wants a positive whole number of days, got "${raw}"; keeping ${DEFAULT_LOG_RETENTION_DAYS}`);
  return DEFAULT_LOG_RETENTION_DAYS;
}

/** Drops lines older than `days`. Returns how many went. */
export async function pruneServerLogs(days: number): Promise<number> {
  const sql = db();
  const result = await sql`
    delete from server_logs
    where logged_at < now() - make_interval(days => ${days})`;
  return result.count;
}
