import { z } from 'zod';
import { LogisticsReadRepository } from '../repositories/LogisticsReadRepository.js';
import { blNumberSchema, toolErrorResult, toolTextResult } from './common.js';

const inputSchema = z.object({
  blNumber: blNumberSchema,
});

export const getMissingDocumentsByBlDefinition = {
  name: 'get_missing_documents_by_bl',
  description:
    'Check missing or present documents for a BL. Types: bl, garantia, certificado, pago_remesa, pago_proveedor, emision_destino, cambio_almacen, aforo, pago_garantia.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      blNumber: { type: 'string', description: 'BL number (min 3, max 50 chars)' },
    },
    required: ['blNumber'],
  },
};

export function registerGetMissingDocumentsByBl(repo: LogisticsReadRepository) {
  return async (args: unknown) => {
    try {
      const input = inputSchema.parse(args);
      const { result, notes } = await repo.getMissingDocumentsByBl(input.blNumber);
      return toolTextResult({ success: true, data: result, schemaNotes: notes });
    } catch (error) {
      const message = error instanceof z.ZodError
        ? error.errors.map((e) => e.message).join('; ')
        : error instanceof Error ? error.message : 'Unknown error';
      return toolErrorResult(message);
    }
  };
}
