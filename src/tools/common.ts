import { z } from 'zod';
import { getEnv } from '../config/env.js';
import { clampLimit, sanitizeErrorMessage } from '../utils/sanitize.js';

export function createLimitSchema(defaultLimit: number) {
  return z
    .number()
    .int()
    .positive()
    .optional()
    .transform((v) => clampLimit(v, defaultLimit, getEnv().DB_MAX_ROWS));
}

export const blNumberSchema = z
  .string()
  .min(3, 'blNumber must be at least 3 characters')
  .max(50, 'blNumber must be at most 50 characters')
  .regex(/^[A-Za-z0-9\-_/\.]+$/, 'blNumber contains invalid characters');

export const containerNumberSchema = z
  .string()
  .min(4, 'containerNumber must be at least 4 characters')
  .max(30, 'containerNumber must be at most 30 characters')
  .regex(/^[A-Za-z0-9\-]+$/, 'containerNumber contains invalid characters');

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((v) => !Number.isNaN(new Date(v + 'T00:00:00').getTime()), 'Invalid date');

export const clientQuerySchema = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[A-Za-z0-9\s\-_\.&,áéíóúÁÉÍÓÚñÑ]+$/, 'clientQuery contains invalid characters');

export function toolTextResult(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

export function formatToolError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.errors.map((e) => e.message).join('; ');
  }
  return sanitizeErrorMessage(error);
}

export function toolErrorResult(message: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }) }],
    isError: true,
  };
}

export const agencyNameSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[A-Za-z0-9\s\-_\.&,áéíóúÁÉÍÓÚñÑ]+$/, 'agencyName contains invalid characters');

export const statusSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[A-Za-z0-9\s\-_\.áéíóúÁÉÍÓÚñÑ]+$/, 'status contains invalid characters');
