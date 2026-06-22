import { EtaRiskItem, RiskLevel } from '../types/logistics.js';
import { daysBetween, parseDbDate, today } from '../utils/date.js';

export class RiskService {
  assessEtaRisk(rows: Record<string, unknown>[]): EtaRiskItem[] {
    const now = today();
    return rows.map((row) => {
      const etaProgramada = parseDbDate(row.eta_programada);
      const etaReal = parseDbDate(row.eta_real);
      const documentoEntregado = row.documento_entregado;
      const estado = row.estado != null ? String(row.estado) : undefined;

      const reasons: string[] = [];
      let riskLevel: RiskLevel = 'low';

      if (etaProgramada) {
        const daysToEta = daysBetween(now, etaProgramada);

        if (!etaReal && daysToEta < 0) {
          reasons.push('ETA vencida sin fecha real (ATA)');
          riskLevel = 'critical';
        } else if (!etaReal && daysToEta >= 0 && daysToEta <= 7) {
          reasons.push(`ETA dentro de ${daysToEta} días sin ATA confirmada`);
          riskLevel = bumpRisk(riskLevel, daysToEta <= 3 ? 'high' : 'medium');
        } else if (!etaReal && daysToEta <= 14) {
          reasons.push(`ETA programada en ${daysToEta} días`);
          riskLevel = bumpRisk(riskLevel, 'low');
        }
      }

      if (this.isDocumentPending(documentoEntregado)) {
        reasons.push('Documento entregado pendiente');
        riskLevel = bumpRisk(riskLevel, 'medium');
      }

      if (!estado || estado.trim() === '' || /sin estado|unknown|pendiente/i.test(estado)) {
        reasons.push('Contenedor sin estado claro');
        riskLevel = bumpRisk(riskLevel, 'medium');
      }

      if (reasons.length === 0) {
        reasons.push('Sin riesgos detectados en ventana consultada');
      }

      return {
        numero_bl: row.numero_bl != null ? String(row.numero_bl) : undefined,
        numero_contenedor: row.numero_contenedor != null ? String(row.numero_contenedor) : undefined,
        cliente: row.cliente != null ? String(row.cliente) : undefined,
        agencia: row.agencia != null ? String(row.agencia) : undefined,
        naviera: row.naviera != null ? String(row.naviera) : undefined,
        buque: row.buque != null ? String(row.buque) : undefined,
        puerto: row.puerto != null ? String(row.puerto) : undefined,
        eta_programada: etaProgramada,
        eta_real: etaReal,
        estado,
        documento_entregado: documentoEntregado as boolean | string | null,
        risk_level: riskLevel,
        risk_reason: reasons.join('; '),
      };
    });
  }

  private isDocumentPending(value: unknown): boolean {
    if (value == null) return true;
    if (value === false || value === 0 || value === '0') return true;
    if (typeof value === 'string' && /^(no|pendiente|false|0)$/i.test(value.trim())) return true;
    return false;
  }
}

const RISK_ORDER: RiskLevel[] = ['low', 'medium', 'high', 'critical'];

function bumpRisk(current: RiskLevel, proposed: RiskLevel): RiskLevel {
  return RISK_ORDER.indexOf(proposed) > RISK_ORDER.indexOf(current) ? proposed : current;
}
