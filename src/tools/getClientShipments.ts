import { z } from 'zod';
import { LogisticsReadRepository } from '../repositories/LogisticsReadRepository.js';
import { clientQuerySchema, createLimitSchema, dateSchema, toolErrorResult, toolTextResult } from './common.js';

const inputSchema = z
  .object({
    clientQuery: clientQuerySchema,
    status: z.string().min(1).max(50).optional(),
    fromDate: dateSchema.optional(),
    toDate: dateSchema.optional(),
    limit: createLimitSchema(50),
  })
  .refine(
    (data) => {
      if (data.fromDate && data.toDate) return data.fromDate <= data.toDate;
      return true;
    },
    { message: 'fromDate must be before or equal to toDate' },
  );

export const getClientShipmentsDefinition = {
  name: 'get_client_shipments',
  description: 'List shipments associated with a client by name or partial match.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      clientQuery: { type: 'string', description: 'Client name search (min 3, max 80 chars)' },
      status: { type: 'string', description: 'Filter by container status (optional)' },
      fromDate: { type: 'string', description: 'Start date YYYY-MM-DD (optional)' },
      toDate: { type: 'string', description: 'End date YYYY-MM-DD (optional)' },
      limit: { type: 'number', description: 'Max results (default 50)' },
    },
    required: ['clientQuery'],
  },
};

export function registerGetClientShipments(repo: LogisticsReadRepository) {
  return async (args: unknown) => {
    try {
      const input = inputSchema.parse(args);
      const { rows, notes } = await repo.getClientShipments(
        input.clientQuery,
        input.status,
        input.fromDate,
        input.toDate,
        input.limit,
      );
      return toolTextResult({ success: true, count: rows.length, data: rows, schemaNotes: notes });
    } catch (error) {
      const message = error instanceof z.ZodError
        ? error.errors.map((e) => e.message).join('; ')
        : error instanceof Error ? error.message : 'Unknown error';
      return toolErrorResult(message);
    }
  };
}
