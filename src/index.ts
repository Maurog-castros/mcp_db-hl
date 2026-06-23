import { startMcpServer } from './mcp/server.js';
import { sanitizeErrorMessage } from './utils/sanitize.js';

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
      error: sanitizeErrorMessage(error),
    }) + '\n',
  );
  process.exit(1);
});
