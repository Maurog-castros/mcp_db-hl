import { z } from 'zod';
import { LogisticsReadRepository } from '../repositories/LogisticsReadRepository.js';
import { RiskService } from '../services/RiskService.js';
import { addDays, today } from '../utils/date.js';
import { createLimitSchema, dateSchema, formatToolError, toolErrorResult, toolTextResult } from './common.js';

const inputSchema = z
  .object({
    fromDate: dateSchema.optional(),
    toDate: dateSchema.optional(),
    daysAhead: z.number().int().positive().max(60).optional().default(14),
    agencyId: z.number().int().positive().optional(),
    portId: z.number().int().positive().optional(),
    limit: createLimitSchema(50),
  })
  .refine(
    (data) => {
      if (data.fromDate && data.toDate) {
        return data.fromDate <= data.toDate;
      }
      return true;
    },
    { message: 'fromDate must be before or equal to toDate' },
  );

export const getEtaRiskReportDefinition = {
  name: 'get_eta_risk_report',
  description:
    'Report shipments with upcoming, overdue or critical ETA. Risk factors: overdue ETA without ATA, ETA within 7 days, pending documents, unclear container status.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      fromDate: { type: 'string', description: 'Start date YYYY-MM-DD (optional)' },
      toDate: { type: 'string', description: 'End date YYYY-MM-DD (optional)' },
      daysAhead: { type: 'number', description: 'Days ahead window if no dates (default 14, max 60)' },
      agencyId: { type: 'number', description: 'Filter by agency ID (optional)' },
      portId: { type: 'number', description: 'Filter by port ID (optional)' },
      limit: { type: 'number', description: 'Max results (default 50)' },
    },
  },
};

export function registerGetEtaRiskReport(repo: LogisticsReadRepository, riskService: RiskService) {
  return async (args: unknown) => {
    try {
      const input = inputSchema.parse(args ?? {});
      const fromDate = input.fromDate ?? today();
      const toDate = input.toDate ?? addDays(today(), input.daysAhead);

      const { rows, notes } = await repo.getEtaRiskCandidates(
        fromDate,
        toDate,
        input.agencyId,
        input.portId,
        input.limit,
      );

      const assessed = riskService.assessEtaRisk(rows);
      const filtered = assessed.filter((item) => item.risk_level !== 'low' || assessed.length <= 10);

      return toolTextResult({
        success: true,
        window: { fromDate, toDate },
        count: filtered.length,
        data: filtered,
        schemaNotes: notes,
      });
    } catch (error) {
      return toolErrorResult(formatToolError(error));
    }
  };
}
