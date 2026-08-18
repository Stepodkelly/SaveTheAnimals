export function formatMeters(meters: number) {
  if (meters === 0) return "0 km";
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDate(value?: string) {
  if (!value) return "Date unavailable";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(value));
}

export function formatDateRange(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const sameMonth = startDate.getUTCMonth() === endDate.getUTCMonth();
  const sameYear = startDate.getUTCFullYear() === endDate.getUTCFullYear();

  if (sameMonth && sameYear) {
    const month = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(startDate);
    return `${month} ${startDate.getUTCDate()}-${endDate.getUTCDate()}, ${endDate.getUTCFullYear()}`;
  }

  return `${formatDate(start)}-${formatDate(end)}`;
}
