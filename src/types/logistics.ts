export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface BlSummary {
  id_bl?: number;
  numero_bl: string;
  cliente?: string;
  agencia?: string;
  naviera?: string;
  buque?: string;
  puerto?: string;
  eta_programada?: string | null;
  eta_real?: string | null;
  documento_entregado?: boolean | string | null;
  cantidad_contenedores?: number;
}

export interface ContainerSummary {
  id_contenedor?: number;
  numero_contenedor: string;
  numero_bl?: string;
  cliente?: string;
  estado?: string;
  agencia?: string;
  naviera?: string;
  buque?: string;
  puerto?: string;
  eta_programada?: string | null;
  eta_real?: string | null;
  fecha_entrega?: string | null;
  despacho?: string | null;
}

export interface EtaRiskItem {
  numero_bl?: string;
  numero_contenedor?: string;
  cliente?: string;
  agencia?: string;
  naviera?: string;
  buque?: string;
  puerto?: string;
  eta_programada?: string | null;
  eta_real?: string | null;
  estado?: string;
  documento_entregado?: boolean | string | null;
  risk_level: RiskLevel;
  risk_reason: string;
}

export interface DocumentChecklistItem {
  tipo: string;
  presente: boolean;
  metadata?: string;
}

export interface MissingDocumentsResult {
  numero_bl: string;
  cliente?: string;
  documentos_encontrados: string[];
  documentos_faltantes: string[];
  checklist: DocumentChecklistItem[];
  observacion?: string;
}

export interface ClientShipment {
  cliente: string;
  numero_bl: string;
  contenedores?: string[];
  cantidad_contenedores?: number;
  estado?: string;
  agencia?: string;
  naviera?: string;
  buque?: string;
  puerto?: string;
  eta_programada?: string | null;
  eta_real?: string | null;
  documentos_pendientes?: string[];
}

export interface AgencyPendingOperation {
  agencia: string;
  numero_bl?: string;
  numero_contenedor?: string;
  cliente?: string;
  estado?: string;
  eta_programada?: string | null;
  eta_real?: string | null;
  documento_entregado?: boolean | string | null;
  remesa_monto?: number | string | null;
  pago_remesa?: boolean | string | null;
  pendientes: string[];
}

export interface SchemaAvailability {
  available: boolean;
  message?: string;
  missingTables?: string[];
  missingColumns?: Record<string, string[]>;
}

export interface ToolResult<T> {
  success: boolean;
  data?: T;
  count?: number;
  schemaNotes?: string[];
  error?: string;
}

export const DOCUMENT_TYPES = [
  'bl',
  'garantia',
  'certificado',
  'pago_remesa',
  'pago_proveedor',
  'emision_destino',
  'cambio_almacen',
  'aforo',
  'pago_garantia',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];
