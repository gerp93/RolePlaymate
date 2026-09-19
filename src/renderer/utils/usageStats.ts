/** "~1,200" for a single value, "~1,200–1,900" for a range. */
export function formatTokenRange(low: number, high: number): string {
  return low === high
    ? `~${low.toLocaleString()}`
    : `~${low.toLocaleString()}–${high.toLocaleString()}`;
}

export function formatCount(n: number, singular: string, plural = `${singular}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? singular : plural}`;
}
