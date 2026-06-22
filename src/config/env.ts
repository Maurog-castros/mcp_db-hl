import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

/** Normaliza aliases legacy (HL-Go / PHP) a las variables que usa el MCP. */
function normalizeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (!env.DB_HOST && env.DB_HOSTNAME) env.DB_HOST = env.DB_HOSTNAME;
  if (!env.DB_USER && env.DB_USERNAME) env.DB_USER = env.DB_USERNAME;
  if (!env.DB_NAME && env.DB_DATABASE) env.DB_NAME = env.DB_DATABASE;
  return env;
}

const envSchema = z.object({
  MCP_SERVER_NAME: z.string().default('hl-go-mysql-mcp'),
  MCP_LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().min(1, 'DB_NAME is required'),
  DB_USER: z.string().min(1, 'DB_USER is required'),
  DB_PASSWORD: z.string().min(1, 'DB_PASSWORD is required'),
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(5),
  DB_MAX_ROWS: z.coerce.number().int().positive().max(1000).default(100),
  DB_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (!cachedEnv) {
    const parsed = envSchema.safeParse(normalizeEnv());
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new Error(`Invalid environment configuration: ${issues}`);
    }
    cachedEnv = parsed.data;
  }
  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = null;
}
