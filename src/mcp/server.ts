import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import pino from 'pino';
import { getEnv } from '../config/env.js';
import { closePool } from '../db/pool.js';
import { formatSchemaReport, inspectSchema } from '../db/schemaInspector.js';
import { LogisticsReadRepository } from '../repositories/LogisticsReadRepository.js';
import { RiskService } from '../services/RiskService.js';
import {
  findBlByNumberDefinition,
  registerFindBlByNumber,
} from '../tools/findBlByNumber.js';
import {
  findContainerByNumberDefinition,
  registerFindContainerByNumber,
} from '../tools/findContainerByNumber.js';
import {
  getAgencyPendingOperationsDefinition,
  registerGetAgencyPendingOperations,
} from '../tools/getAgencyPendingOperations.js';
import {
  getClientShipmentsDefinition,
  registerGetClientShipments,
} from '../tools/getClientShipments.js';
import {
  getEtaRiskReportDefinition,
  registerGetEtaRiskReport,
} from '../tools/getEtaRiskReport.js';
import {
  getMissingDocumentsByBlDefinition,
  registerGetMissingDocumentsByBl,
} from '../tools/getMissingDocumentsByBl.js';

const TOOL_DEFINITIONS = [
  findBlByNumberDefinition,
  findContainerByNumberDefinition,
  getEtaRiskReportDefinition,
  getMissingDocumentsByBlDefinition,
  getClientShipmentsDefinition,
  getAgencyPendingOperationsDefinition,
];

export async function createMcpServer(): Promise<Server> {
  const env = getEnv();
  const logger = pino({ level: env.MCP_LOG_LEVEL, name: env.MCP_SERVER_NAME });

  const repo = new LogisticsReadRepository();
  const riskService = new RiskService();

  logger.info('Initializing schema inspection...');
  const schema = await repo.init();
  logger.info(formatSchemaReport(schema));

  const handlers: Record<string, (args: unknown) => Promise<unknown>> = {
    find_bl_by_number: registerFindBlByNumber(repo),
    find_container_by_number: registerFindContainerByNumber(repo),
    get_eta_risk_report: registerGetEtaRiskReport(repo, riskService),
    get_missing_documents_by_bl: registerGetMissingDocumentsByBl(repo),
    get_client_shipments: registerGetClientShipments(repo),
    get_agency_pending_operations: registerGetAgencyPendingOperations(repo),
  };

  const server = new Server(
    { name: env.MCP_SERVER_NAME, version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = handlers[name];
    if (!handler) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Unknown tool: ${name}` }) }],
        isError: true,
      };
    }
    logger.info({ tool: name }, 'Tool invoked');
    return (await handler(args ?? {})) as { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
  });

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = await createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    await closePool();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export async function inspectDatabaseSchema(): Promise<string> {
  const env = getEnv();
  const schema = await inspectSchema(env.DB_NAME, true);
  return formatSchemaReport(schema);
}
