/**
 * Format a date string as a relative time (e.g., "2h ago", "3d ago").
 */
export function timeAgo(dateStr: string): string {
  const hours = Math.round(
    (Date.now() - new Date(dateStr).getTime()) / 3600000,
  );
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
