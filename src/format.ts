// Shared display formatting for event times, used in both the admin
// request embed (formSubmit) and the public announcement (interactions).
export function formatEventWhen(startIso: string, endIso?: string): string {
  const startDisplay = new Date(startIso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  if (!endIso) return startDisplay;
  return `${startDisplay} – ${formatTime(endIso)}`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeStyle: "short" });
}
