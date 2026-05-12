/**
 * Structured operations logging (stdout JSON lines). Intended for production log
 * aggregation. Callers must not pass medical free-text or guardian email addresses.
 */
export function writeOpsLog(event: string, data: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...data,
  });
  console.info(line);
}
