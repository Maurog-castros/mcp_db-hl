const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(value: string): boolean {
  if (!DATE_REGEX.test(value)) return false;
  const d = new Date(value + 'T00:00:00');
  return !Number.isNaN(d.getTime());
}

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function today(): string {
  return formatDate(new Date());
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

export function daysBetween(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00');
  const b = new Date(to + 'T00:00:00');
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export function parseDbDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return formatDate(value);
  const str = String(value);
  if (str.length >= 10) return str.slice(0, 10);
  return str;
}
