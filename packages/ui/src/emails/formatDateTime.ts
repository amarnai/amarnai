// Shared date+time display for content inside the thread view (message cards,
// comments), so timestamps read identically throughout the pane. Year is only
// shown when it differs from the current one.
export function formatDateTime(d: Date): string {
  const crossYear = d.getFullYear() !== new Date().getFullYear();
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    ...(crossYear ? { year: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  });
}
