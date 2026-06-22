import { z } from 'zod';
import { LogisticsReadRepository } from '../repositories/LogisticsReadRepository.js';
import { createLimitSchema, toolErrorResult, toolTextResult } from './common.js';

const inputSchema = z.object({
  agencyId: z.number().int().positive().optional(),
  agencyName: z.string().min(2).max(80).optional(),
  limit: createLimitSchema(50),
});

export const getAgencyPendingOperationsDefinition = {
  name: 'get_agency_pending_operations',
  description:
    'Report pending operations by agency: missing ATA, undelivered documents, pending remittance payments, unclear status.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agencyId: { type: 'number', description: 'Agency ID (optional if agencyName provided)' },
      agencyName: { type: 'string', description: 'Agency name partial match (optional if agencyId provided)' },
      limit: { type: 'number', description: 'Max results (default 50)' },
    },
  },
};

export function registerGetAgencyPendingOperations(repo: LogisticsReadRepository) {
  return async (args: unknown) => {
    try {
      const input = inputSchema.parse(args ?? {});
      const { rows, notes } = await repo.getAgencyPendingOperations(
        input.agencyId,
        input.agencyName,
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
