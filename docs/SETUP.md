# HL-Go MySQL MCP Server

Servidor MCP **read-only** para consultar datos operacionales de HL-Go (H-L) desde Cursor u otros clientes MCP, sin SQL arbitrario ni acceso al PHP legacy.

> Copiar este archivo a `README.md` si el root no se pudo actualizar:  
> `cp docs/SETUP.md README.md`

## Tools disponibles

| Tool | Descripción |
|------|-------------|
| `find_bl_by_number` | Busca BL por número |
| `find_container_by_number` | Busca contenedor por número |
| `get_eta_risk_report` | ETA próximas, atrasadas o críticas |
| `get_missing_documents_by_bl` | Checklist documental por BL |
| `get_client_shipments` | Embarques por cliente |
| `get_agency_pending_operations` | Operaciones pendientes por agencia |

## Requisitos

- Node.js 20+
- MySQL / MariaDB accesible
- Usuario MySQL con permiso **solo SELECT**

## Configuración

```bash
cp .env.example .env
```

Variables soportadas (también aliases legacy `DB_HOSTNAME`, `DB_USERNAME`, `DB_DATABASE`):

| Variable | Default |
|----------|---------|
| `MCP_SERVER_NAME` | `hl-go-mysql-mcp` |
| `MCP_LOG_LEVEL` | `info` |
| `DB_HOST` / `DB_HOSTNAME` | `localhost` |
| `DB_PORT` | `3306` |
| `DB_NAME` / `DB_DATABASE` | *(requerido)* |
| `DB_USER` / `DB_USERNAME` | *(requerido)* |
| `DB_PASSWORD` | *(requerido)* |
| `DB_CONNECTION_LIMIT` | `5` |
| `DB_MAX_ROWS` | `100` |
| `DB_QUERY_TIMEOUT_MS` | `5000` |

**No commitear `.env`** — está en `.gitignore`.

### Usuario MySQL read-only

```sql
CREATE USER 'hl_mcp_readonly'@'localhost' IDENTIFIED BY 'CAMBIAR_PASSWORD_SEGURO';
GRANT SELECT ON nombre_base.* TO 'hl_mcp_readonly'@'localhost';
FLUSH PRIVILEGES;
```

## Instalación local

```bash
npm install
npm run typecheck
npm run build
npm test
npm run dev
npm start
node dist/index.js --inspect-schema
```

## Despliegue en Ubuntu

```bash
sudo mkdir -p /opt/hl-go-mysql-mcp
sudo cp -r . /opt/hl-go-mysql-mcp/
cd /opt/hl-go-mysql-mcp
npm ci && npm run build
sudo cp .env.example .env && sudo nano .env
sudo useradd -r -s /usr/sbin/nologin hl-mcp 2>/dev/null || true
sudo chown -R hl-mcp:hl-mcp /opt/hl-go-mysql-mcp
sudo cp hl-go-mysql-mcp.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now hl-go-mysql-mcp
journalctl -u hl-go-mysql-mcp -f
```

## Conectar en Cursor

### Opción A — wrapper con `.env` (recomendado)

```bash
#!/bin/bash
set -a && source /home/mauro/Dev/mcp_db-hl/.env && set +a
exec node /home/mauro/Dev/mcp_db-hl/dist/index.js
```

Guardar como `run-mcp.sh`, `chmod +x`, y en `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "hl-go-mysql": {
      "command": "/home/mauro/Dev/mcp_db-hl/run-mcp.sh",
      "args": []
    }
  }
}
```

### Opción B — variables inline

```json
{
  "mcpServers": {
    "hl-go-mysql": {
      "command": "node",
      "args": ["/home/mauro/Dev/mcp_db-hl/dist/index.js"],
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

Reinicia Cursor. Prueba: `Usa find_bl_by_number con blNumber COSU6309584980`

## Seguridad

- Solo SELECT allowlist; sin SQL desde input del modelo
- Prepared statements; validación Zod; límite `DB_MAX_ROWS`
- Errores sanitizados; campos sensibles excluidos
