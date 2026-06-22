import { RowDataPacket } from 'mysql2/promise';
import pino from 'pino';
import { queryReadOnly } from './pool.js';

const logger = pino({ name: 'schema-inspector' });

export interface TableMapping {
  logical: string;
  physical: string | null;
  columns: Record<string, string | null>;
}

export interface SchemaMap {
  tables: Record<string, TableMapping>;
  inspectedAt: string;
  database: string;
}

const TABLE_CANDIDATES: Record<string, string[]> = {
  bls: ['bls', 'bl', 'bill_of_lading', 'bill_of_ladings', 'planilla', 'planillas'],
  contenedores: ['contenedores', 'contenedor', 'containers', 'container'],
  clients: ['clients', 'clientes', 'cliente', 'customers'],
  personas: ['personas', 'persona'],
  personas_juridicas: ['personas_juridicas', 'persona_juridica', 'empresas'],
  personas_naturales: ['personas_naturales', 'persona_natural'],
  agencias: ['agencias', 'agencia', 'agencies'],
  navieras: ['navieras', 'naviera', 'shipping_lines', 'shipping_line'],
  buques: ['buques', 'buque', 'vessels', 'vessel', 'naves'],
  puertos: ['puertos', 'puerto', 'ports', 'port'],
  estados_contenedor: [
    'estados_contenedor',
    'estado_contenedor',
    'estados',
    'estado',
    'container_status',
    'container_statuses',
  ],
  archivos: ['archivos', 'archivo', 'files', 'file', 'documentos', 'documento', 'documents'],
  observaciones: ['observaciones', 'observacion', 'notes', 'note'],
  remesas: ['remesas', 'remesa', 'payments', 'pagos'],
  tipos_documento: ['tipos_documento', 'tipo_documento', 'document_types'],
  tipo_contenido_ui: ['tipo_contenido_ui', 'tipo_contenido', 'tipos_contenido'],
};

const COLUMN_CANDIDATES: Record<string, Record<string, string[]>> = {
  bls: {
    id: ['id_bl', 'bl_id', 'id', 'id_bill_of_lading'],
    numero: ['numero_bl', 'bl_number', 'numero', 'nro_bl', 'bl_no', 'num_bl'],
    cliente_id: ['id_cliente', 'cliente_id', 'id_client', 'client_id'],
    agencia_id: ['id_agencia', 'agencia_id', 'id_agency', 'agency_id'],
    naviera_id: ['id_naviera', 'naviera_id', 'id_shipping_line'],
    buque_id: ['id_buque', 'buque_id', 'id_vessel', 'vessel_id'],
    puerto_id: ['id_puerto', 'puerto_id', 'id_port', 'port_id'],
    eta_programada: [
      'eta_programada',
      'fecha_programada',
      'eta',
      'fecha_eta',
      'programada',
      'eta_estimada',
    ],
    eta_real: ['eta_real', 'fecha_real', 'ata', 'fecha_ata', 'fecha_llegada', 'real'],
    documento_entregado: [
      'documento_entregado',
      'documento_entregado_en',
      'doc_entregado',
      'documento',
      'documentos_entregados',
      'bl_entregado',
    ],
    emision_destino: ['emision_destino'],
    cambio_almacen: ['cambio_almacen'],
  },
  contenedores: {
    id: ['id_contenedor', 'contenedor_id', 'id', 'id_container', 'container_id'],
    numero: ['numero_contenedor', 'container_number', 'numero', 'nro_contenedor', 'contenedor'],
    bl_id: ['id_bl', 'bl_id', 'id_bill_of_lading'],
    estado_id: ['id_estado', 'estado_id', 'id_estado_contenedor', 'estado_contenedor_id'],
    fecha_entrega: ['fecha_entrega', 'entrega', 'delivery_date', 'fecha_delivery'],
    despacho: ['despacho', 'numero_despacho', 'despacho_numero', 'dispatch'],
    remesa_monto: ['remesa_monto', 'monto_remesa', 'monto'],
    pago_remesa: ['pago_remesa', 'pagado_remesa', 'remesa_pagada'],
    aforo: ['aforo'],
    garantia: ['garantia'],
  },
  clients: {
    id: ['id_cliente', 'cliente_id', 'id', 'id_client', 'client_id'],
    nombre: ['nombre', 'name', 'razon_social', 'nombre_cliente', 'cliente'],
    persona_id: ['id_persona', 'persona_id'],
    estado: ['estado', 'status'],
  },
  agencias: {
    id: ['id_agencia', 'agencia_id', 'id', 'id_agency'],
    nombre: ['nombre', 'name', 'agencia', 'nombre_agencia'],
  },
  navieras: {
    id: ['id_naviera', 'naviera_id', 'id', 'id_shipping_line'],
    nombre: ['nombre', 'name', 'naviera', 'nombre_naviera'],
  },
  buques: {
    id: ['id_buque', 'buque_id', 'id', 'id_vessel'],
    nombre: ['nombre', 'name', 'buque', 'nombre_buque', 'vessel_name'],
  },
  puertos: {
    id: ['id_puerto', 'puerto_id', 'id', 'id_port'],
    nombre: ['nombre', 'name', 'puerto', 'nombre_puerto', 'port_name'],
  },
  estados_contenedor: {
    id: ['id_estado', 'estado_id', 'id', 'id_estado_contenedor'],
    nombre: ['nombre', 'name', 'estado', 'descripcion', 'description'],
  },
  archivos: {
    id: ['id_archivo', 'archivo_id', 'id', 'id_documento', 'documento_id'],
    bl_id: ['id_bl', 'bl_id'],
    tipo_contenido_id: ['tipo_contenido_id'],
    contenido_id: ['contenido_id'],
    tipo_documento_id: ['tipo_documento_id'],
    tipo: ['tipo', 'type', 'tipo_documento', 'document_type', 'categoria'],
    nombre: ['nombre_original', 'nombre', 'name', 'filename', 'archivo', 'titulo'],
    url: ['nombre_storage', 'url', 'path', 'ruta', 'link', 'file_path'],
  },
  observaciones: {
    id: ['id_observacion', 'observacion_id', 'id'],
    bl_id: ['id_bl', 'bl_id'],
    contenedor_id: ['contenedor_id', 'id_contenedor'],
    texto: ['texto', 'observacion', 'nota', 'note', 'descripcion', 'content'],
  },
  remesas: {
    id: ['id_remesa', 'remesa_id', 'id'],
    bl_id: ['id_bl', 'bl_id'],
    monto: ['monto', 'amount', 'valor', 'importe'],
    pagado: ['pagado', 'paid', 'pago_remesa', 'estado_pago', 'pagada'],
  },
  personas: {
    id: ['id_persona', 'persona_id', 'id'],
    nombre: ['nombre', 'name', 'razon_social'],
    tipo_persona: ['tipo_persona', 'tipo'],
  },
  personas_juridicas: {
    id: ['persona_id', 'id_persona', 'id'],
    razon_social: ['razon_social', 'nombre', 'name'],
    nombre_fantasia: ['nombre_fantasia', 'fantasia'],
  },
  personas_naturales: {
    id: ['persona_id', 'id_persona', 'id'],
    nombres: ['nombres', 'nombre', 'name'],
    apellido_paterno: ['apellido_paterno', 'apellido'],
    apellido_materno: ['apellido_materno'],
  },
  tipos_documento: {
    id: ['tipo_documento_id', 'id'],
    codigo: ['codigo', 'code'],
    nombre: ['nombre', 'name'],
    mostrar_checklist: ['mostrar_checklist', 'checklist'],
  },
  tipo_contenido_ui: {
    id: ['tipo_contenido_id', 'id'],
    codigo: ['codigo', 'code'],
  },
};

let cachedSchema: SchemaMap | null = null;

export async function inspectSchema(database: string, force = false): Promise<SchemaMap> {
  if (cachedSchema && !force) return cachedSchema;

  const tableRows = await queryReadOnly<RowDataPacket[]>(
    `SELECT TABLE_NAME AS tableName
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = :database
       AND TABLE_TYPE = 'BASE TABLE'`,
    { database },
  );

  const physicalTables = new Set(
    tableRows.map((r) => String(r.tableName).toLowerCase()),
  );

  logger.info({ tableCount: physicalTables.size }, 'Schema tables discovered');

  const columnRows = await queryReadOnly<RowDataPacket[]>(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = :database`,
    { database },
  );

  const columnsByTable = new Map<string, Set<string>>();
  for (const row of columnRows) {
    const t = String(row.tableName).toLowerCase();
    const c = String(row.columnName).toLowerCase();
    if (!columnsByTable.has(t)) columnsByTable.set(t, new Set());
    columnsByTable.get(t)!.add(c);
  }

  const tables: Record<string, TableMapping> = {};

  for (const [logical, candidates] of Object.entries(TABLE_CANDIDATES)) {
    const physical = candidates.find((c) => physicalTables.has(c)) ?? null;
    const columnMap: Record<string, string | null> = {};

    if (physical) {
      const cols = columnsByTable.get(physical) ?? new Set<string>();
      const candidatesForTable = COLUMN_CANDIDATES[logical] ?? {};
      for (const [logicalCol, colCandidates] of Object.entries(candidatesForTable)) {
        columnMap[logicalCol] = colCandidates.find((c) => cols.has(c)) ?? null;
      }
    }

    tables[logical] = { logical, physical, columns: columnMap };
  }

  cachedSchema = {
    tables,
    inspectedAt: new Date().toISOString(),
    database,
  };

  logSchemaSummary(cachedSchema);
  return cachedSchema;
}

function logSchemaSummary(schema: SchemaMap): void {
  for (const [logical, mapping] of Object.entries(schema.tables)) {
    if (mapping.physical) {
      const mappedCols = Object.entries(mapping.columns)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}→${v}`);
      logger.debug({ logical, physical: mapping.physical, columns: mappedCols }, 'Table mapped');
    } else {
      logger.debug({ logical }, 'Table not found in schema');
    }
  }
}

export function resetSchemaCache(): void {
  cachedSchema = null;
}

export function getTable(schema: SchemaMap, logical: string): TableMapping | null {
  return schema.tables[logical] ?? null;
}

export function col(table: TableMapping | null, logicalCol: string): string | null {
  if (!table?.physical) return null;
  return table.columns[logicalCol] ?? null;
}

export function qn(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``;
}

export function tableExists(schema: SchemaMap, logical: string): boolean {
  return schema.tables[logical]?.physical != null;
}

export function missingTables(schema: SchemaMap, required: string[]): string[] {
  return required.filter((t) => !tableExists(schema, t));
}

export function schemaNotes(schema: SchemaMap, required: string[]): string[] {
  const missing = missingTables(schema, required);
  return missing.map((t) => `Table '${t}' not available in current schema.`);
}

export function formatSchemaReport(schema: SchemaMap): string {
  const lines: string[] = [`Schema inspection for database '${schema.database}' (${schema.inspectedAt})`];
  for (const [logical, mapping] of Object.entries(schema.tables)) {
    if (mapping.physical) {
      const cols = Object.entries(mapping.columns)
        .filter(([, v]) => v)
        .map(([k, v]) => `  ${k} → ${v}`)
        .join('\n');
      lines.push(`\n[${logical}] → ${mapping.physical}\n${cols || '  (no mapped columns)'}`);
    } else {
      lines.push(`\n[${logical}] → NOT FOUND`);
    }
  }
  return lines.join('\n');
}
