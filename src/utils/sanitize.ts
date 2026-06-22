const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'token',
  'secret',
  'hash',
  'session',
  'api_key',
  'apikey',
  'credential',
  'salt',
]);

export function sanitizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const lowerKey = key.toLowerCase();
    if (
      SENSITIVE_KEYS.has(lowerKey) ||
      lowerKey.includes('password') ||
      lowerKey.includes('token') ||
      lowerKey.includes('hash') ||
      lowerKey.includes('session')
    ) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

export function sanitizeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(sanitizeRow);
}

export function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message;
    if (/password|credential|access denied/i.test(msg)) {
      return 'Database query failed. Check server logs for details.';
    }
    return msg.replace(/password[=:]\S+/gi, 'password=[REDACTED]');
  }
  return 'An unexpected error occurred.';
}

export function clampLimit(requested: number | undefined, defaultLimit: number, maxRows: number): number {
  const base = requested ?? defaultLimit;
  return Math.min(Math.max(1, base), maxRows);
}
