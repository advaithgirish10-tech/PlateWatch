const DAY = 86_400_000;

/* calendar dates are Indian Standard Time: a day starts at midnight in Mumbai, not UTC */
export function isoDateIST(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/* whole days from `from` to `to`, both YYYY-MM-DD */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / DAY);
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(date + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
}

/* start of today in IST, as an instant (for "per day" limits) */
export function startOfDayIST(now: Date): Date {
  return new Date(Date.parse(isoDateIST(now) + "T00:00:00+05:30"));
}
