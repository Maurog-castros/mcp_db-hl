import { describe, expect, it } from 'vitest';
import { assertReadOnlySql } from '../db/pool.js';
import { RiskService } from '../services/RiskService.js';
import { addDays, daysBetween, formatDate, isValidDateString, today } from '../utils/date.js';
import { clampLimit, sanitizeRow } from '../utils/sanitize.js';

describe('assertReadOnlySql', () => {
  it('allows SELECT queries', () => {
    expect(() => assertReadOnlySql('SELECT * FROM bls WHERE id = :id')).not.toThrow();
  });

  it('allows WITH ... SELECT queries', () => {
    expect(() =>
      assertReadOnlySql('WITH cte AS (SELECT 1 AS x) SELECT * FROM cte'),
    ).not.toThrow();
  });

  it('blocks INSERT', () => {
    expect(() => assertReadOnlySql('INSERT INTO bls VALUES (1)')).toThrow(/read-only/i);
  });

  it('blocks UPDATE', () => {
    expect(() => assertReadOnlySql('UPDATE bls SET x = 1')).toThrow(/read-only/i);
  });

  it('blocks DELETE', () => {
    expect(() => assertReadOnlySql('DELETE FROM bls')).toThrow(/read-only/i);
  });

  it('blocks DROP', () => {
    expect(() => assertReadOnlySql('DROP TABLE bls')).toThrow(/read-only/i);
  });

  it('blocks non-SELECT statements', () => {
    expect(() => assertReadOnlySql('SHOW TABLES')).toThrow(/SELECT/i);
  });
});

describe('sanitizeRow', () => {
  it('removes sensitive fields', () => {
    const row = sanitizeRow({
      id: 1,
      numero_bl: 'BL123',
      password: 'secret',
      session_token: 'abc',
    });
    expect(row).toEqual({ id: 1, numero_bl: 'BL123' });
  });
});

describe('clampLimit', () => {
  it('uses default when undefined', () => {
    expect(clampLimit(undefined, 20, 100)).toBe(20);
  });

  it('caps at maxRows', () => {
    expect(clampLimit(500, 20, 100)).toBe(100);
  });
});

describe('date utils', () => {
  it('validates date strings', () => {
    expect(isValidDateString('2025-06-22')).toBe(true);
    expect(isValidDateString('invalid')).toBe(false);
  });

  it('adds days correctly', () => {
    expect(addDays('2025-06-22', 7)).toBe('2025-06-29');
  });

  it('computes days between', () => {
    expect(daysBetween('2025-06-22', '2025-06-29')).toBe(7);
  });

  it('formats today', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('RiskService', () => {
  const service = new RiskService();

  it('marks overdue ETA without ATA as critical', () => {
    const past = formatDate(new Date(Date.now() - 5 * 86400000));
    const results = service.assessEtaRisk([
      {
        numero_bl: 'BL001',
        eta_programada: past,
        eta_real: null,
        documento_entregado: 1,
        estado: 'En tránsito',
      },
    ]);
    expect(results[0]?.risk_level).toBe('critical');
    expect(results[0]?.risk_reason).toContain('ETA vencida');
  });

  it('marks pending documents as medium or higher', () => {
    const soon = addDays(today(), 5);
    const results = service.assessEtaRisk([
      {
        numero_bl: 'BL002',
        eta_programada: soon,
        eta_real: null,
        documento_entregado: 0,
        estado: 'En puerto',
      },
    ]);
    expect(['medium', 'high']).toContain(results[0]?.risk_level);
  });
});
