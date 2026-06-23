import { z } from 'zod';
import { LogisticsReadRepository } from '../repositories/LogisticsReadRepository.js';
import { blNumberSchema, createLimitSchema, formatToolError, toolErrorResult, toolTextResult } from './common.js';

const inputSchema = z.object({
  blNumber: blNumberSchema,
  limit: createLimitSchema(20),
});

export const findBlByNumberDefinition = {
  name: 'find_bl_by_number',
  description:
    'Search BL (Bill of Lading) by exact or partial number. Returns client, agency, carrier, vessel, port, ETA dates and container count.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      blNumber: { type: 'string', description: 'BL number (min 3, max 50 chars)' },
      limit: { type: 'number', description: 'Max results (default 20)' },
    },
    required: ['blNumber'],
  },
};

export function registerFindBlByNumber(repo: LogisticsReadRepository) {
  return async (args: unknown) => {
    try {
      const input = inputSchema.parse(args);
      const { rows, notes } = await repo.findBlByNumber(input.blNumber, input.limit);
      return toolTextResult({ success: true, count: rows.length, data: rows, schemaNotes: notes });
    } catch (error) {
      return toolErrorResult(formatToolError(error));
    }
  };
}
