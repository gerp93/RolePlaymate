/** "850ms" below one second (redos and short replies land here often), "2.3s" above it. Shared
 * between the chat transcript (per-reply) and the Model Tuning page (per-model average). */
export function formatResponseTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
