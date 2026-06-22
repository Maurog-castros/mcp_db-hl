import { startMcpServer } from './mcp/server.js';

async function main(): Promise<void> {
  if (process.argv.includes('--inspect-schema')) {
    const { inspectDatabaseSchema } = await import('./mcp/server.js');
    const report = await inspectDatabaseSchema();
    process.stdout.write(report + '\n');
    process.exit(0);
  }

  await startMcpServer();
}

main().catch((error) => {
  process.stderr.write(
    JSON.stringify({
      error: error instanceof Error ? error.message : 'Failed to start MCP server',
    }) + '\n',
  );
  process.exit(1);
});
