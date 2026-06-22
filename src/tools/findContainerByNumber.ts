import { z } from 'zod';
import { LogisticsReadRepository } from '../repositories/LogisticsReadRepository.js';
import { containerNumberSchema, createLimitSchema, toolErrorResult, toolTextResult } from './common.js';

const inputSchema = z.object({
  containerNumber: containerNumberSchema,
  limit: createLimitSchema(20),
});

export const findContainerByNumberDefinition = {
  name: 'find_container_by_number',
  description:
    'Search container by exact or partial number. Returns BL, client, status, agency, carrier, vessel, port and dates.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      containerNumber: { type: 'string', description: 'Container number (min 4, max 30 chars)' },
      limit: { type: 'number', description: 'Max results (default 20)' },
    },
    required: ['containerNumber'],
  },
};

export function registerFindContainerByNumber(repo: LogisticsReadRepository) {
  return async (args: unknown) => {
    try {
      const input = inputSchema.parse(args);
      const { rows, notes } = await repo.findContainerByNumber(input.containerNumber, input.limit);
      return toolTextResult({ success: true, count: rows.length, data: rows, schemaNotes: notes });
    } catch (error) {
      const message = error instanceof z.ZodError
        ? error.errors.map((e) => e.message).join('; ')
        : error instanceof Error ? error.message : 'Unknown error';
      return toolErrorResult(message);
    }
  };
}
