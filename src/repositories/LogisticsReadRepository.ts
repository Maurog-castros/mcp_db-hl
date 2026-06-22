import { RowDataPacket } from 'mysql2/promise';
import { getEnv } from '../config/env.js';
import { queryReadOnly } from '../db/pool.js';
import {
  col,
  getTable,
  inspectSchema,
  qn,
  schemaNotes,
  tableExists,
  type SchemaMap,
} from '../db/schemaInspector.js';
import {
  AgencyPendingOperation,
  BlSummary,
  ClientShipment,
  ContainerSummary,
  DOCUMENT_TYPES,
  DocumentChecklistItem,
  MissingDocumentsResult,
  type DocumentType,
} from '../types/logistics.js';
import { parseDbDate } from '../utils/date.js';
import { sanitizeRows } from '../utils/sanitize.js';

export class LogisticsReadRepository {
  private schema: SchemaMap | null = null;

  async init(): Promise<SchemaMap> {
    const env = getEnv();
    this.schema = await inspectSchema(env.DB_NAME);
    return this.schema;
  }

  getSchema(): SchemaMap {
    if (!this.schema) throw new Error('Repository not initialized. Call init() first.');
    return this.schema;
  }

  async findBlByNumber(blNumber: string, limit: number): Promise<{ rows: BlSummary[]; notes: string[] }> {
    const schema = this.getSchema();
    const notes = schemaNotes(schema, ['bls']);
    const blTable = getTable(schema, 'bls');
    if (!blTable?.physical) {
      return { rows: [], notes: [...notes, 'BL search unavailable: bls table not found.'] };
    }

    const idCol = col(blTable, 'id');
    const numCol = col(blTable, 'numero');
    if (!numCol) {
      return { rows: [], notes: [...notes, 'BL search unavailable: numero column not mapped.'] };
    }

    const selectParts = [`b.${qn(numCol)} AS numero_bl`];
    if (idCol) selectParts.unshift(`b.${qn(idCol)} AS id_bl`);

    const joins = this.buildBlJoins(schema, 'b');
    selectParts.push(...joins.selectExtras);

    const containerCount = this.buildContainerCountSubquery(schema, 'b', idCol, numCol);
    if (containerCount) selectParts.push(containerCount);

    const etaProg = col(blTable, 'eta_programada');
    const etaReal = col(blTable, 'eta_real');
    const docEnt = col(blTable, 'documento_entregado');
    if (etaProg) selectParts.push(`b.${qn(etaProg)} AS eta_programada`);
    if (etaReal) selectParts.push(`b.${qn(etaReal)} AS eta_real`);
    if (docEnt) selectParts.push(`b.${qn(docEnt)} AS documento_entregado`);

    const sql = `
      SELECT ${selectParts.join(', ')}
      FROM ${qn(blTable.physical)} b
      ${joins.joinClauses.join('\n')}
      WHERE b.${qn(numCol)} LIKE :pattern
      ORDER BY b.${qn(numCol)}
      LIMIT :limit
    `;

    const rows = await queryReadOnly<RowDataPacket[]>(sql, {
      pattern: `%${blNumber}%`,
      limit,
    });

    return { rows: this.mapBlRows(sanitizeRows(rows as Record<string, unknown>[])), notes };
  }

  async findContainerByNumber(
    containerNumber: string,
    limit: number,
  ): Promise<{ rows: ContainerSummary[]; notes: string[] }> {
    const schema = this.getSchema();
    const notes = schemaNotes(schema, ['contenedores']);
    const contTable = getTable(schema, 'contenedores');
    if (!contTable?.physical) {
      return { rows: [], notes: [...notes, 'Container search unavailable: contenedores table not found.'] };
    }

    const idCol = col(contTable, 'id');
    const numCol = col(contTable, 'numero');
    if (!numCol) {
      return { rows: [], notes: [...notes, 'Container search unavailable: numero column not mapped.'] };
    }

    const selectParts = [`c.${qn(numCol)} AS numero_contenedor`];
    if (idCol) selectParts.unshift(`c.${qn(idCol)} AS id_contenedor`);

    const blIdCol = col(contTable, 'bl_id');
    const blTable = getTable(schema, 'bls');
    const blNumCol = blTable ? col(blTable, 'numero') : null;

    if (blIdCol && blTable?.physical && blNumCol) {
      selectParts.push(`b.${qn(blNumCol)} AS numero_bl`);
    }

    const fechaEnt = col(contTable, 'fecha_entrega');
    const despachoCol = col(contTable, 'despacho');
    if (fechaEnt) selectParts.push(`c.${qn(fechaEnt)} AS fecha_entrega`);
    if (despachoCol) selectParts.push(`c.${qn(despachoCol)} AS despacho`);

    const estadoJoin = this.buildEstadoJoin(schema, 'c', col(contTable, 'estado_id'));
    selectParts.push(...estadoJoin.selectExtras);

    const blJoins = blIdCol && blTable?.physical
      ? this.buildBlJoins(schema, 'b', blIdCol, 'c')
      : { joinClauses: [], selectExtras: [] as string[] };
    selectParts.push(...blJoins.selectExtras);

    const blJoinClause =
      blIdCol && blTable?.physical
        ? `LEFT JOIN ${qn(blTable.physical)} b ON c.${qn(blIdCol)} = b.${qn(col(blTable, 'id') ?? 'id')}`
        : '';

    const sql = `
      SELECT ${selectParts.join(', ')}
      FROM ${qn(contTable.physical)} c
      ${blJoinClause}
      ${estadoJoin.joinClause}
      ${blJoins.joinClauses.join('\n')}
      WHERE c.${qn(numCol)} LIKE :pattern
      ORDER BY c.${qn(numCol)}
      LIMIT :limit
    `;

    const rows = await queryReadOnly<RowDataPacket[]>(sql, {
      pattern: `%${containerNumber}%`,
      limit,
    });

    return {
      rows: this.mapContainerRows(sanitizeRows(rows as Record<string, unknown>[])),
      notes,
    };
  }

  async getEtaRiskCandidates(
    fromDate: string,
    toDate: string,
    agencyId: number | undefined,
    portId: number | undefined,
    limit: number,
  ): Promise<{ rows: Record<string, unknown>[]; notes: string[] }> {
    const schema = this.getSchema();
    const notes = schemaNotes(schema, ['contenedores']);
    const contTable = getTable(schema, 'contenedores');
    const blTable = getTable(schema, 'bls');

    if (!contTable?.physical || !blTable?.physical) {
      return {
        rows: [],
        notes: [...notes, 'ETA risk report requires contenedores and bls tables.'],
      };
    }

    const blIdOnCont = col(contTable, 'bl_id');
    const blIdOnBl = col(blTable, 'id');
    const blNumCol = col(blTable, 'numero');
    const contNumCol = col(contTable, 'numero');
    const etaProg = col(blTable, 'eta_programada');
    const etaReal = col(blTable, 'eta_real');
    const docEnt = col(blTable, 'documento_entregado');
    const agenciaIdCol = col(blTable, 'agencia_id');
    const puertoIdCol = col(blTable, 'puerto_id');

    if (!blIdOnCont || !blIdOnBl || !etaProg) {
      return {
        rows: [],
        notes: [...notes, 'ETA risk report unavailable: required date/BL columns not mapped.'],
      };
    }

    const selectParts: string[] = [];
    if (blNumCol) selectParts.push(`b.${qn(blNumCol)} AS numero_bl`);
    if (contNumCol) selectParts.push(`c.${qn(contNumCol)} AS numero_contenedor`);
    selectParts.push(`b.${qn(etaProg)} AS eta_programada`);
    if (etaReal) selectParts.push(`b.${qn(etaReal)} AS eta_real`);
    if (docEnt) selectParts.push(`b.${qn(docEnt)} AS documento_entregado`);

    const joins = this.buildBlJoins(schema, 'b');
    selectParts.push(...joins.selectExtras);

    const estadoJoin = this.buildEstadoJoin(schema, 'c', col(contTable, 'estado_id'));
    selectParts.push(...estadoJoin.selectExtras);

    const conditions: string[] = [];

    if (etaReal) {
      conditions.push(
        `(b.${qn(etaReal)} IS NULL OR b.${qn(etaReal)} = '' OR b.${qn(etaReal)} = '0000-00-00')`,
      );
    }

    conditions.push(
      `b.${qn(etaProg)} IS NOT NULL`,
      `b.${qn(etaProg)} != ''`,
      `b.${qn(etaProg)} != '0000-00-00'`,
      `b.${qn(etaProg)} <= :toDate`,
    );

    const params: Record<string, unknown> = { toDate, limit };

    conditions.push(`(b.${qn(etaProg)} >= :fromDate OR b.${qn(etaProg)} < CURDATE())`);
    params.fromDate = fromDate;

    if (agencyId != null && agenciaIdCol) {
      conditions.push(`b.${qn(agenciaIdCol)} = :agencyId`);
      params.agencyId = agencyId;
    }
    if (portId != null && puertoIdCol) {
      conditions.push(`b.${qn(puertoIdCol)} = :portId`);
      params.portId = portId;
    }

    const sql = `
      SELECT ${selectParts.join(', ')}
      FROM ${qn(contTable.physical)} c
      INNER JOIN ${qn(blTable.physical)} b ON c.${qn(blIdOnCont)} = b.${qn(blIdOnBl)}
      ${estadoJoin.joinClause}
      ${joins.joinClauses.join('\n')}
      WHERE ${conditions.join(' AND ')}
      ORDER BY b.${qn(etaProg)} ASC
      LIMIT :limit
    `;

    const rows = await queryReadOnly<RowDataPacket[]>(sql, params);
    return { rows: sanitizeRows(rows as Record<string, unknown>[]), notes };
  }

  async getMissingDocumentsByBl(blNumber: string): Promise<{ result: MissingDocumentsResult; notes: string[] }> {
    const schema = this.getSchema();
    const notes: string[] = [];
    const blTable = getTable(schema, 'bls');
    const archTable = getTable(schema, 'archivos');
    const obsTable = getTable(schema, 'observaciones');

    if (!blTable?.physical) {
      return {
        result: {
          numero_bl: blNumber,
          documentos_encontrados: [],
          documentos_faltantes: [...DOCUMENT_TYPES],
          checklist: DOCUMENT_TYPES.map((t) => ({ tipo: t, presente: false })),
          observacion: 'BL table not available in current schema.',
        },
        notes: schemaNotes(schema, ['bls']),
      };
    }

    const numCol = col(blTable, 'numero');
    const idCol = col(blTable, 'id');
    if (!numCol || !idCol) {
      return {
        result: {
          numero_bl: blNumber,
          documentos_encontrados: [],
          documentos_faltantes: [...DOCUMENT_TYPES],
          checklist: DOCUMENT_TYPES.map((t) => ({ tipo: t, presente: false })),
          observacion: 'BL identifier columns not mapped.',
        },
        notes: ['Required BL columns not available.'],
      };
    }

    const blRows = await queryReadOnly<RowDataPacket[]>(
      `SELECT ${qn(idCol)} AS id_bl, ${qn(numCol)} AS numero_bl
       FROM ${qn(blTable.physical)}
       WHERE ${qn(numCol)} LIKE :pattern
       LIMIT 5`,
      { pattern: `%${blNumber}%` },
    );

    if (blRows.length === 0) {
      return {
        result: {
          numero_bl: blNumber,
          documentos_encontrados: [],
          documentos_faltantes: [...DOCUMENT_TYPES],
          checklist: DOCUMENT_TYPES.map((t) => ({ tipo: t, presente: false })),
          observacion: 'No BL found matching the provided number.',
        },
        notes,
      };
    }

    const bl = blRows[0]!;
    const blId = bl.id_bl;
    const exactBlNumber = String(bl.numero_bl);

    let cliente: string | undefined;
    const clientJoin = this.buildBlJoins(schema, 'b');
    if (clientJoin.selectExtras.length > 0) {
      const clientSql = `
        SELECT ${clientJoin.selectExtras.join(', ')}
        FROM ${qn(blTable.physical)} b
        ${clientJoin.joinClauses.join('\n')}
        WHERE b.${qn(idCol)} = :blId
        LIMIT 1
      `;
      const clientRows = await queryReadOnly<RowDataPacket[]>(clientSql, { blId });
      if (clientRows[0]) {
        cliente = clientRows[0].cliente != null ? String(clientRows[0].cliente) : undefined;
      }
    }

    const foundTypes = new Set<string>();
    const checklist: DocumentChecklistItem[] = [];

    if (archTable?.physical) {
      const contTable = getTable(schema, 'contenedores');
      const tiposDocTable = getTable(schema, 'tipos_documento');
      const contenidoCol = col(archTable, 'contenido_id');
      const tipoContenidoCol = col(archTable, 'tipo_contenido_id');
      const tipoDocIdCol = col(archTable, 'tipo_documento_id');
      const nombreCol = col(archTable, 'nombre');
      const urlCol = col(archTable, 'url');

      if (
        contTable?.physical &&
        contenidoCol &&
        tipoDocIdCol &&
        tiposDocTable?.physical &&
        col(contTable, 'bl_id')
      ) {
        const contIdCol = col(contTable, 'id')!;
        const blIdOnCont = col(contTable, 'bl_id')!;
        const contNumCol = col(contTable, 'numero');
        const tdCodigo = col(tiposDocTable, 'codigo')!;
        const tdNombre = col(tiposDocTable, 'nombre')!;

        const tipoContFilter = tipoContenidoCol
          ? `AND a.${qn(tipoContenidoCol)} = 2`
          : '';

        const docRows = await queryReadOnly<RowDataPacket[]>(
          `SELECT td.${qn(tdCodigo)} AS codigo, td.${qn(tdNombre)} AS tipo_nombre,
                  ${nombreCol ? `a.${qn(nombreCol)}` : `NULL`} AS nombre,
                  ${urlCol ? `a.${qn(urlCol)}` : `NULL`} AS url,
                  ${contNumCol ? `c.${qn(contNumCol)}` : `NULL`} AS numero_contenedor
           FROM ${qn(archTable.physical)} a
           INNER JOIN ${qn(contTable.physical)} c
             ON a.${qn(contenidoCol)} = c.${qn(contIdCol)} ${tipoContFilter}
           INNER JOIN ${qn(tiposDocTable.physical)} td
             ON a.${qn(tipoDocIdCol)} = td.${qn(col(tiposDocTable, 'id')!)}
           WHERE c.${qn(blIdOnCont)} = :blId
           LIMIT 200`,
          { blId },
        );

        for (const doc of docRows) {
          const matched =
            this.mapCodigoToDocumentType(String(doc.codigo ?? '')) ??
            this.matchDocumentType(String(doc.codigo ?? ''), String(doc.tipo_nombre ?? doc.nombre ?? ''));
          if (matched) {
            foundTypes.add(matched);
            checklist.push({
              tipo: matched,
              presente: true,
              metadata: [
                doc.numero_contenedor ? String(doc.numero_contenedor) : null,
                doc.nombre ? String(doc.nombre) : null,
                doc.url ? String(doc.url) : null,
              ]
                .filter(Boolean)
                .join(' | '),
            });
          }
        }
      } else {
        notes.push('archivos/contenedores/tipos_documento not fully mapped for document checklist.');
      }
    } else {
      notes.push('archivos table not available; document checklist based on metadata only.');
    }

    for (const docType of DOCUMENT_TYPES) {
      if (!foundTypes.has(docType)) {
        checklist.push({ tipo: docType, presente: false });
      }
    }

    const emisionDestinoCol = col(blTable, 'emision_destino');
    const cambioAlmacenCol = col(blTable, 'cambio_almacen');
    if (emisionDestinoCol) {
      const flagRows = await queryReadOnly<RowDataPacket[]>(
        `SELECT ${qn(emisionDestinoCol)} AS v FROM ${qn(blTable.physical)} WHERE ${qn(idCol)} = :blId`,
        { blId },
      );
      if (flagRows[0]?.v === 1 || flagRows[0]?.v === '1') foundTypes.add('emision_destino');
    }
    if (cambioAlmacenCol) {
      const flagRows = await queryReadOnly<RowDataPacket[]>(
        `SELECT ${qn(cambioAlmacenCol)} AS v FROM ${qn(blTable.physical)} WHERE ${qn(idCol)} = :blId`,
        { blId },
      );
      if (flagRows[0]?.v === 1 || flagRows[0]?.v === '1') foundTypes.add('cambio_almacen');
    }

    const contTable = getTable(schema, 'contenedores');
    if (contTable?.physical) {
      const aforoCol = col(contTable, 'aforo');
      const garantiaCol = col(contTable, 'garantia');
      const blIdOnCont = col(contTable, 'bl_id');
      if (blIdOnCont && (aforoCol || garantiaCol)) {
        const flagSelect = [
          aforoCol ? `MAX(${qn(aforoCol)}) AS aforo` : null,
          garantiaCol ? `MAX(${qn(garantiaCol)}) AS garantia` : null,
        ].filter(Boolean);
        if (flagSelect.length > 0) {
          const flagRows = await queryReadOnly<RowDataPacket[]>(
            `SELECT ${flagSelect.join(', ')} FROM ${qn(contTable.physical)} WHERE ${qn(blIdOnCont)} = :blId`,
            { blId },
          );
          if (aforoCol && (flagRows[0]?.aforo === 1 || flagRows[0]?.aforo === '1')) foundTypes.add('aforo');
          if (garantiaCol && (flagRows[0]?.garantia === 1 || flagRows[0]?.garantia === '1')) {
            foundTypes.add('garantia');
          }
        }
      }
    }

    const docEntCol = col(blTable, 'documento_entregado');
    if (docEntCol) {
      const entRows = await queryReadOnly<RowDataPacket[]>(
        `SELECT ${qn(docEntCol)} AS documento_entregado
         FROM ${qn(blTable.physical)}
         WHERE ${qn(idCol)} = :blId`,
        { blId },
      );
      const ent = entRows[0]?.documento_entregado;
      if (ent && (ent === 1 || ent === '1' || ent === true || String(ent).toLowerCase() === 'si')) {
        foundTypes.add('bl');
      }
    }

    const documentos_encontrados = [...foundTypes];
    const documentos_faltantes = DOCUMENT_TYPES.filter((t) => !foundTypes.has(t));

    let observacion: string | undefined;
    if (!archTable?.physical) {
      observacion =
        'Document migration may only expose metadata or links in observaciones. Full document checklist unavailable.';
    }

    if (obsTable?.physical) {
      const contenedorIdObs = col(obsTable, 'contenedor_id');
      const textoCol = col(obsTable, 'texto');
      const contTableObs = getTable(schema, 'contenedores');

      if (contenedorIdObs && textoCol && contTableObs?.physical && col(contTableObs, 'bl_id')) {
        const obsRows = await queryReadOnly<RowDataPacket[]>(
          `SELECT o.${qn(textoCol)} AS texto
           FROM ${qn(obsTable.physical)} o
           INNER JOIN ${qn(contTableObs.physical)} c ON o.${qn(contenedorIdObs)} = c.${qn(col(contTableObs, 'id')!)}
           WHERE c.${qn(col(contTableObs, 'bl_id')!)} = :blId
           ORDER BY o.${qn(col(obsTable, 'id') ?? 'observacion_id')} DESC
           LIMIT 5`,
          { blId },
        );
        const obsTexts = obsRows.map((r) => String(r.texto)).filter(Boolean);
        if (obsTexts.length > 0) {
          observacion = [observacion, ...obsTexts].filter(Boolean).join(' | ');
        }
      } else {
        notes.push('observaciones linked via contenedor_id; join path not fully mapped.');
      }
    }

    return {
      result: {
        numero_bl: exactBlNumber,
        cliente,
        documentos_encontrados,
        documentos_faltantes,
        checklist,
        observacion,
      },
      notes,
    };
  }

  async getClientShipments(
    clientQuery: string,
    status: string | undefined,
    fromDate: string | undefined,
    toDate: string | undefined,
    limit: number,
  ): Promise<{ rows: ClientShipment[]; notes: string[] }> {
    const schema = this.getSchema();
    const notes: string[] = [];
    const blTable = getTable(schema, 'bls');
    const contTable = getTable(schema, 'contenedores');
    const clientsTable = getTable(schema, 'clients');

    if (!blTable?.physical) {
      return { rows: [], notes: [...schemaNotes(schema, ['bls']), 'Client shipments unavailable.'] };
    }

    const blIdCol = col(blTable, 'id');
    const blNumCol = col(blTable, 'numero');
    const clienteIdCol = col(blTable, 'cliente_id');
    const etaProg = col(blTable, 'eta_programada');
    const etaReal = col(blTable, 'eta_real');

    const clientNameExpr = this.resolveClientNameExpr(schema, 'b');
    if (!clientNameExpr) {
      return {
        rows: [],
        notes: [...notes, 'Client name resolution unavailable: clients/personas tables not mapped.'],
      };
    }

    const selectParts = [
      `${clientNameExpr} AS cliente`,
      blNumCol ? `b.${qn(blNumCol)} AS numero_bl` : `NULL AS numero_bl`,
    ];
    if (etaProg) selectParts.push(`b.${qn(etaProg)} AS eta_programada`);
    if (etaReal) selectParts.push(`b.${qn(etaReal)} AS eta_real`);

    const blJoins = this.buildBlJoins(schema, 'b');
    selectParts.push(...blJoins.selectExtras.filter((s) => !s.includes('cliente')));

    const estadoAgg = contTable?.physical
      ? this.buildContainerStatusAgg(schema, 'b', blIdCol, col(contTable, 'bl_id'))
      : null;
    if (estadoAgg) selectParts.push(estadoAgg);

    const conditions = [`${clientNameExpr} LIKE :clientPattern`];
    const params: Record<string, unknown> = {
      clientPattern: `%${clientQuery}%`,
      limit,
    };

    if (fromDate && etaProg) {
      conditions.push(`b.${qn(etaProg)} >= :fromDate`);
      params.fromDate = fromDate;
    }
    if (toDate && etaProg) {
      conditions.push(`b.${qn(etaProg)} <= :toDate`);
      params.toDate = toDate;
    }

    if (status && contTable?.physical) {
      const estadoTable = getTable(schema, 'estados_contenedor');
      const estadoIdOnCont = col(contTable, 'estado_id');
      const estadoNameCol = estadoTable ? col(estadoTable, 'nombre') : null;
      const estadoIdCol = estadoTable ? col(estadoTable, 'id') : null;
      if (estadoTable?.physical && estadoIdOnCont && estadoNameCol && estadoIdCol && blIdCol) {
        conditions.push(`EXISTS (
          SELECT 1 FROM ${qn(contTable.physical)} c
          LEFT JOIN ${qn(estadoTable.physical)} e ON c.${qn(estadoIdOnCont)} = e.${qn(estadoIdCol)}
          WHERE c.${qn(col(contTable, 'bl_id')!)} = b.${qn(blIdCol)}
            AND e.${qn(estadoNameCol)} LIKE :statusPattern
        )`);
        params.statusPattern = `%${status}%`;
      } else {
        notes.push('Status filter unavailable: estados_contenedor not mapped.');
      }
    }

    const sql = `
      SELECT ${selectParts.join(', ')}
      FROM ${qn(blTable.physical)} b
      ${blJoins.joinClauses.join('\n')}
      ${this.buildClientJoins(schema, 'b', clienteIdCol)}
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${etaProg ? `b.${qn(etaProg)} DESC` : `b.${qn(blNumCol ?? 'id')}`}
      LIMIT :limit
    `;

    const rows = await queryReadOnly<RowDataPacket[]>(sql, params);

    const shipments: ClientShipment[] = [];
    for (const row of sanitizeRows(rows as Record<string, unknown>[])) {
      const numero_bl = String(row.numero_bl ?? '');
      let contenedores: string[] | undefined;
      if (contTable?.physical && blIdCol) {
        contenedores = await this.getContainerNumbersForBl(schema, row.id_bl as number | undefined, numero_bl);
      }
      shipments.push({
        cliente: String(row.cliente ?? clientQuery),
        numero_bl,
        contenedores,
        cantidad_contenedores: contenedores?.length,
        estado: row.estado != null ? String(row.estado) : undefined,
        agencia: row.agencia != null ? String(row.agencia) : undefined,
        naviera: row.naviera != null ? String(row.naviera) : undefined,
        buque: row.buque != null ? String(row.buque) : undefined,
        puerto: row.puerto != null ? String(row.puerto) : undefined,
        eta_programada: parseDbDate(row.eta_programada),
        eta_real: parseDbDate(row.eta_real),
      });
    }

    return { rows: shipments, notes };
  }

  async getAgencyPendingOperations(
    agencyId: number | undefined,
    agencyName: string | undefined,
    limit: number,
  ): Promise<{ rows: AgencyPendingOperation[]; notes: string[] }> {
    const schema = this.getSchema();
    const notes: string[] = [];
    const blTable = getTable(schema, 'bls');
    const contTable = getTable(schema, 'contenedores');
    const agenciaTable = getTable(schema, 'agencias');

    if (!blTable?.physical || !contTable?.physical) {
      return {
        rows: [],
        notes: [...schemaNotes(schema, ['bls', 'contenedores']), 'Agency pending operations unavailable.'],
      };
    }

    const blIdCol = col(blTable, 'id');
    const blNumCol = col(blTable, 'numero');
    const agenciaIdCol = col(blTable, 'agencia_id');
    const etaProg = col(blTable, 'eta_programada');
    const etaReal = col(blTable, 'eta_real');
    const docEnt = col(blTable, 'documento_entregado');
    const contNumCol = col(contTable, 'numero');
    const blIdOnCont = col(contTable, 'bl_id');

    const agenciaNameCol = agenciaTable ? col(agenciaTable, 'nombre') : null;
    const agenciaIdOnAg = agenciaTable ? col(agenciaTable, 'id') : null;

    const clientNameExpr = this.resolveClientNameExpr(schema, 'b');

    const selectParts = [
      agenciaNameCol && agenciaTable?.physical && agenciaIdCol
        ? `a.${qn(agenciaNameCol)} AS agencia`
        : `'Unknown' AS agencia`,
      blNumCol ? `b.${qn(blNumCol)} AS numero_bl` : `NULL AS numero_bl`,
      contNumCol ? `c.${qn(contNumCol)} AS numero_contenedor` : `NULL AS numero_contenedor`,
      clientNameExpr ? `${clientNameExpr} AS cliente` : `NULL AS cliente`,
    ];

    if (etaProg) selectParts.push(`b.${qn(etaProg)} AS eta_programada`);
    if (etaReal) selectParts.push(`b.${qn(etaReal)} AS eta_real`);
    if (docEnt) selectParts.push(`b.${qn(docEnt)} AS documento_entregado`);

    const estadoJoin = this.buildEstadoJoin(schema, 'c', col(contTable, 'estado_id'));
    selectParts.push(...estadoJoin.selectExtras);

    const remesaMontoCol = col(contTable, 'remesa_monto');
    const pagoRemesaCol = col(contTable, 'pago_remesa');
    if (remesaMontoCol) selectParts.push(`c.${qn(remesaMontoCol)} AS remesa_monto`);
    if (pagoRemesaCol) selectParts.push(`c.${qn(pagoRemesaCol)} AS pago_remesa`);

    if (!remesaMontoCol && !pagoRemesaCol) {
      notes.push('remesa fields on contenedores not mapped; payment data omitted.');
    }

    const conditions: string[] = [];
    const params: Record<string, unknown> = { limit };

    const pendingParts: string[] = [];
    if (etaReal) {
      pendingParts.push(`(b.${qn(etaReal)} IS NULL OR b.${qn(etaReal)} = '' OR b.${qn(etaReal)} = '0000-00-00')`);
    }
    if (docEnt) {
      pendingParts.push(
        `(b.${qn(docEnt)} IS NULL OR b.${qn(docEnt)} = 0 OR b.${qn(docEnt)} = '' OR b.${qn(docEnt)} = '0')`,
      );
    }
    if (pendingParts.length > 0) {
      conditions.push(`(${pendingParts.join(' OR ')})`);
    }

    if (agencyId != null && agenciaIdCol) {
      conditions.push(`b.${qn(agenciaIdCol)} = :agencyId`);
      params.agencyId = agencyId;
    } else if (agencyName && agenciaNameCol && agenciaTable?.physical) {
      conditions.push(`a.${qn(agenciaNameCol)} LIKE :agencyName`);
      params.agencyName = `%${agencyName}%`;
    }

    const remesaJoin = '';

    const sql = `
      SELECT ${selectParts.join(', ')}
      FROM ${qn(contTable.physical)} c
      INNER JOIN ${qn(blTable.physical)} b ON c.${qn(blIdOnCont!)} = b.${qn(blIdCol!)}
      ${agenciaTable?.physical && agenciaIdCol ? `LEFT JOIN ${qn(agenciaTable.physical)} a ON b.${qn(agenciaIdCol)} = a.${qn(agenciaIdOnAg ?? 'id')}` : ''}
      ${estadoJoin.joinClause}
      ${remesaJoin}
      ${this.buildClientJoins(schema, 'b', col(blTable, 'cliente_id'))}
      ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY ${etaProg ? `b.${qn(etaProg)} ASC` : `b.${qn(blIdCol!)}`}
      LIMIT :limit
    `;

    const rows = await queryReadOnly<RowDataPacket[]>(sql, params);

    const results: AgencyPendingOperation[] = rows.map((row) => {
      const pendientes: string[] = [];
      if (!row.eta_real || row.eta_real === '0000-00-00') pendientes.push('Sin ATA/ETA real');
      if (
        row.documento_entregado == null ||
        row.documento_entregado === 0 ||
        row.documento_entregado === '0' ||
        row.documento_entregado === false
      ) {
        pendientes.push('Documento no entregado');
      }
      if (row.pago_remesa != null && (row.pago_remesa === 0 || row.pago_remesa === '0' || row.pago_remesa === false)) {
        pendientes.push('Pago remesa pendiente');
      }
      if (!row.estado) pendientes.push('Estado contenedor no definido');

      return {
        agencia: String(row.agencia ?? 'Unknown'),
        numero_bl: row.numero_bl != null ? String(row.numero_bl) : undefined,
        numero_contenedor: row.numero_contenedor != null ? String(row.numero_contenedor) : undefined,
        cliente: row.cliente != null ? String(row.cliente) : undefined,
        estado: row.estado != null ? String(row.estado) : undefined,
        eta_programada: parseDbDate(row.eta_programada),
        eta_real: parseDbDate(row.eta_real),
        documento_entregado: row.documento_entregado as boolean | string | null,
        remesa_monto: row.remesa_monto as number | string | null,
        pago_remesa: row.pago_remesa as boolean | string | null,
        pendientes,
      };
    });

    return { rows: results, notes };
  }

  private mapCodigoToDocumentType(codigo: string): DocumentType | null {
    const normalized = codigo.toUpperCase().replace(/\s+/g, '_');
    const map: Record<string, DocumentType> = {
      BL: 'bl',
      GARANTIA: 'garantia',
      CERTIFICADO: 'certificado',
      PAGO_REMESA: 'pago_remesa',
      PAGO_PROVEEDOR: 'pago_proveedor',
      EMISION_DESTINO: 'emision_destino',
      CAMBIO_ALMACEN: 'cambio_almacen',
      AFORO: 'aforo',
      AFORO_FISICO: 'aforo',
      AFORO_SCANNER: 'aforo',
      PAGO_GARANTIA: 'pago_garantia',
    };
    return map[normalized] ?? null;
  }

  private matchDocumentType(tipo: string, nombre: string): DocumentType | null {
    const combined = `${tipo} ${nombre}`.toLowerCase();
    for (const docType of DOCUMENT_TYPES) {
      const normalized = docType.replace(/_/g, ' ');
      if (combined.includes(docType) || combined.includes(normalized)) {
        return docType;
      }
    }
    if (/bl|bill.?of.?lading/i.test(combined)) return 'bl';
    if (/garant/i.test(combined)) return combined.includes('pago') ? 'pago_garantia' : 'garantia';
    if (/certif/i.test(combined)) return 'certificado';
    if (/remesa|payment/i.test(combined)) return 'pago_remesa';
    if (/proveedor|supplier/i.test(combined)) return 'pago_proveedor';
    if (/emisi/i.test(combined) && /destino/i.test(combined)) return 'emision_destino';
    if (/almac/i.test(combined)) return 'cambio_almacen';
    if (/aforo/i.test(combined)) return 'aforo';
    return null;
  }

  private buildBlJoins(
    schema: SchemaMap,
    alias: string,
    fkCol?: string,
    fkSourceAlias?: string,
  ): { joinClauses: string[]; selectExtras: string[] } {
    const joinClauses: string[] = [];
    const selectExtras: string[] = [];
    const blTable = getTable(schema, 'bls');
    if (!blTable?.physical) return { joinClauses, selectExtras };

    const srcAlias = fkSourceAlias ?? alias;

    const joinEntity = (
      logical: string,
      fkLogical: string,
      selectAlias: string,
    ) => {
      const entityTable = getTable(schema, logical);
      const fk = fkCol ?? col(blTable, fkLogical);
      const entityId = entityTable ? col(entityTable, 'id') : null;
      const entityName = entityTable ? col(entityTable, 'nombre') : null;
      if (entityTable?.physical && fk && entityId && entityName) {
        joinClauses.push(
          `LEFT JOIN ${qn(entityTable.physical)} ${selectAlias}_t ON ${srcAlias}.${qn(fk)} = ${selectAlias}_t.${qn(entityId)}`,
        );
        selectExtras.push(`${selectAlias}_t.${qn(entityName)} AS ${selectAlias}`);
      }
    };

    joinEntity('clients', 'cliente_id', 'cliente');
    const clientExpr = this.resolveClientNameExpr(schema, alias);
    if (!selectExtras.some((s) => s.includes('cliente')) && clientExpr) {
      selectExtras.push(`${clientExpr} AS cliente`);
      joinClauses.push(this.buildClientJoins(schema, alias, col(blTable, 'cliente_id')));
    }
    joinEntity('agencias', 'agencia_id', 'agencia');
    joinEntity('navieras', 'naviera_id', 'naviera');
    joinEntity('buques', 'buque_id', 'buque');
    joinEntity('puertos', 'puerto_id', 'puerto');

    return { joinClauses, selectExtras };
  }

  private buildEstadoJoin(
    schema: SchemaMap,
    contAlias: string,
    estadoFkCol: string | null,
  ): { joinClause: string; selectExtras: string[] } {
    const estadoTable = getTable(schema, 'estados_contenedor');
    if (!estadoTable?.physical || !estadoFkCol) {
      return { joinClause: '', selectExtras: [] };
    }
    const estadoId = col(estadoTable, 'id');
    const estadoName = col(estadoTable, 'nombre');
    if (!estadoId || !estadoName) {
      return { joinClause: '', selectExtras: [] };
    }
    return {
      joinClause: `LEFT JOIN ${qn(estadoTable.physical)} estado_t ON ${contAlias}.${qn(estadoFkCol)} = estado_t.${qn(estadoId)}`,
      selectExtras: [`estado_t.${qn(estadoName)} AS estado`],
    };
  }

  private buildContainerCountSubquery(
    schema: SchemaMap,
    blAlias: string,
    blIdCol: string | null,
    blNumCol: string | null,
  ): string | null {
    const contTable = getTable(schema, 'contenedores');
    if (!contTable?.physical || !blIdCol) return null;
    const blIdOnCont = col(contTable, 'bl_id');
    if (!blIdOnCont) return null;
    return `(SELECT COUNT(*) FROM ${qn(contTable.physical)} cnt WHERE cnt.${qn(blIdOnCont)} = ${blAlias}.${qn(blIdCol)}) AS cantidad_contenedores`;
  }

  private resolveClientNameExpr(schema: SchemaMap, _blAlias: string): string | null {
    const clientsTable = getTable(schema, 'clients');
    if (!clientsTable?.physical) return null;

    const clientNameCol = col(clientsTable, 'nombre');
    if (clientNameCol) return `cli.${qn(clientNameCol)}`;

    const pjTable = getTable(schema, 'personas_juridicas');
    const pnTable = getTable(schema, 'personas_naturales');
    const pjRazon = pjTable ? col(pjTable, 'razon_social') : null;
    const pnNombres = pnTable ? col(pnTable, 'nombres') : null;
    const pnApPat = pnTable ? col(pnTable, 'apellido_paterno') : null;
    const pnApMat = pnTable ? col(pnTable, 'apellido_materno') : null;

    if (pjRazon && pnNombres && pjTable?.physical && pnTable?.physical) {
      const naturalName = `NULLIF(TRIM(CONCAT_WS(' ', pn.${qn(pnNombres)}, ${
        pnApPat ? `pn.${qn(pnApPat)}` : `''`
      }, ${pnApMat ? `pn.${qn(pnApMat)}` : `''`})), '')`;
      return `COALESCE(pj.${qn(pjRazon)}, ${naturalName})`;
    }

    if (pjRazon && pjTable?.physical) return `pj.${qn(pjRazon)}`;

    const personasTable = getTable(schema, 'personas');
    const personaName = personasTable ? col(personasTable, 'nombre') : null;
    if (personaName && personasTable?.physical) return `per.${qn(personaName)}`;

    return null;
  }

  private buildClientJoins(schema: SchemaMap, blAlias: string, clienteIdCol: string | null): string {
    const clientsTable = getTable(schema, 'clients');
    const blTable = getTable(schema, 'bls');
    if (!clientsTable?.physical || !blTable?.physical || !clienteIdCol) return '';

    const clientIdCol = col(clientsTable, 'id');
    if (!clientIdCol) return '';

    let joins = `LEFT JOIN ${qn(clientsTable.physical)} cli ON ${blAlias}.${qn(clienteIdCol)} = cli.${qn(clientIdCol)}`;

    const personaIdCol = col(clientsTable, 'persona_id');
    const personasTable = getTable(schema, 'personas');
    if (personaIdCol && personasTable?.physical) {
      const personaId = col(personasTable, 'id');
      if (personaId) {
        joins += `\nLEFT JOIN ${qn(personasTable.physical)} per ON cli.${qn(personaIdCol)} = per.${qn(personaId)}`;
      }
    }

    const pjTable = getTable(schema, 'personas_juridicas');
    const pnTable = getTable(schema, 'personas_naturales');
    if (personaIdCol && pjTable?.physical) {
      const pjPersonaId = col(pjTable, 'id');
      if (pjPersonaId) {
        joins += `\nLEFT JOIN ${qn(pjTable.physical)} pj ON cli.${qn(personaIdCol)} = pj.${qn(pjPersonaId)}`;
      }
    }
    if (personaIdCol && pnTable?.physical) {
      const pnPersonaId = col(pnTable, 'id');
      if (pnPersonaId) {
        joins += `\nLEFT JOIN ${qn(pnTable.physical)} pn ON cli.${qn(personaIdCol)} = pn.${qn(pnPersonaId)}`;
      }
    }

    return joins;
  }

  private buildContainerStatusAgg(
    schema: SchemaMap,
    blAlias: string,
    blIdCol: string | null,
    contBlIdCol: string | null,
  ): string | null {
    const contTable = getTable(schema, 'contenedores');
    const estadoTable = getTable(schema, 'estados_contenedor');
    if (!contTable?.physical || !blIdCol || !contBlIdCol) return null;

    const estadoIdOnCont = col(contTable, 'estado_id');
    const estadoId = estadoTable ? col(estadoTable, 'id') : null;
    const estadoName = estadoTable ? col(estadoTable, 'nombre') : null;

    if (estadoTable?.physical && estadoIdOnCont && estadoId && estadoName) {
      return `(SELECT e.${qn(estadoName)}
               FROM ${qn(contTable.physical)} c
               LEFT JOIN ${qn(estadoTable.physical)} e ON c.${qn(estadoIdOnCont)} = e.${qn(estadoId)}
               WHERE c.${qn(contBlIdCol)} = ${blAlias}.${qn(blIdCol)}
               LIMIT 1) AS estado`;
    }
    return null;
  }

  private async getContainerNumbersForBl(
    schema: SchemaMap,
    blId: number | undefined,
    blNumber: string,
  ): Promise<string[]> {
    const contTable = getTable(schema, 'contenedores');
    const blTable = getTable(schema, 'bls');
    if (!contTable?.physical) return [];

    const contNumCol = col(contTable, 'numero');
    const blIdOnCont = col(contTable, 'bl_id');
    if (!contNumCol || !blIdOnCont) return [];

    let sql: string;
    let params: Record<string, unknown>;

    if (blId != null) {
      sql = `SELECT ${qn(contNumCol)} AS numero FROM ${qn(contTable.physical)} WHERE ${qn(blIdOnCont)} = :blId LIMIT 50`;
      params = { blId };
    } else if (blTable?.physical) {
      const blNumCol = col(blTable, 'numero');
      const blIdCol = col(blTable, 'id');
      if (!blNumCol || !blIdCol) return [];
      sql = `SELECT c.${qn(contNumCol)} AS numero
             FROM ${qn(contTable.physical)} c
             INNER JOIN ${qn(blTable.physical)} b ON c.${qn(blIdOnCont)} = b.${qn(blIdCol)}
             WHERE b.${qn(blNumCol)} = :blNumber LIMIT 50`;
      params = { blNumber };
    } else {
      return [];
    }

    const rows = await queryReadOnly<RowDataPacket[]>(sql, params);
    return rows.map((r) => String(r.numero));
  }

  private mapBlRows(rows: Record<string, unknown>[]): BlSummary[] {
    return rows.map((row) => ({
      id_bl: row.id_bl != null ? Number(row.id_bl) : undefined,
      numero_bl: String(row.numero_bl ?? ''),
      cliente: row.cliente != null ? String(row.cliente) : undefined,
      agencia: row.agencia != null ? String(row.agencia) : undefined,
      naviera: row.naviera != null ? String(row.naviera) : undefined,
      buque: row.buque != null ? String(row.buque) : undefined,
      puerto: row.puerto != null ? String(row.puerto) : undefined,
      eta_programada: parseDbDate(row.eta_programada),
      eta_real: parseDbDate(row.eta_real),
      documento_entregado: row.documento_entregado as boolean | string | null,
      cantidad_contenedores:
        row.cantidad_contenedores != null ? Number(row.cantidad_contenedores) : undefined,
    }));
  }

  private mapContainerRows(rows: Record<string, unknown>[]): ContainerSummary[] {
    return rows.map((row) => ({
      id_contenedor: row.id_contenedor != null ? Number(row.id_contenedor) : undefined,
      numero_contenedor: String(row.numero_contenedor ?? ''),
      numero_bl: row.numero_bl != null ? String(row.numero_bl) : undefined,
      cliente: row.cliente != null ? String(row.cliente) : undefined,
      estado: row.estado != null ? String(row.estado) : undefined,
      agencia: row.agencia != null ? String(row.agencia) : undefined,
      naviera: row.naviera != null ? String(row.naviera) : undefined,
      buque: row.buque != null ? String(row.buque) : undefined,
      puerto: row.puerto != null ? String(row.puerto) : undefined,
      eta_programada: parseDbDate(row.eta_programada),
      eta_real: parseDbDate(row.eta_real),
      fecha_entrega: parseDbDate(row.fecha_entrega),
      despacho: row.despacho != null ? String(row.despacho) : undefined,
    }));
  }
}
