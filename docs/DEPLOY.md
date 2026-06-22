# HL-Go MySQL MCP Server — Guía de despliegue

Ver también el README principal. Este documento contiene la guía completa de configuración.

## Qué hace

Servidor MCP **read-only** para HL-Go. Expone 6 tools con queries allowlist sobre MySQL/MariaDB.

## Variables `.env`

Copiar `.env.example` a `.env` y completar:

- `MCP_SERVER_NAME`, `MCP_LOG_LEVEL`
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- `DB_CONNECTION_LIMIT`, `DB_MAX_ROWS`, `DB_QUERY_TIMEOUT_MS`

## Usuario MySQL read-only

```sql
CREATE USER 'hl_mcp_readonly'@'localhost' IDENTIFIED BY 'CAMBIAR_PASSWORD_SEGURO';
GRANT SELECT ON nombre_base.* TO 'hl_mcp_readonly'@'localhost';
FLUSH PRIVILEGES;
```

## Comandos

```bash
npm install
npm run typecheck
npm run build
npm test
npm run dev
npm start
node dist/index.js --inspect-schema
```

## Cursor MCP

```json
{
  "mcpServers": {
    "hl-go-mysql": {
      "command": "node",
      "args": ["/opt/hl-go-mysql-mcp/dist/index.js"],
      "env": {
        "MCP_SERVER_NAME": "hl-go-mysql-mcp",
        "DB_HOST": "localhost",
        "DB_PORT": "3306",
        "DB_NAME": "nombre_base",
        "DB_USER": "hl_mcp_readonly",
        "DB_PASSWORD": "usar_env_seguro",
        "DB_MAX_ROWS": "100"
      }
    }
  }
}
```

## systemd

Ver `hl-go-mysql-mcp.service` en la raíz del repo.

## Seguridad

- Solo SELECT, prepared statements, Zod, límites de filas, sin SQL libre, sin credenciales en logs.
