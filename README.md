MCP para Base de Datos MySQL / MariaDB



Permitiría que agente IA consulte datos operativos de HL-Go sin tocar directamente el código PHP.

Casos útiles:

Consultar BL por número.
Buscar contenedores por estado.
Detectar ETA próximas o atrasadas.
Ver documentos pendientes.
Cruzar cliente, agencia, naviera, puerto y estado.
Generar reportes operativos.

Encaja perfecto porque la planilla es el módulo central y reúne BL, contenedores, cliente, naviera, agencia, puerto, buque, estados, fechas, remesas, documentos y observaciones.

Recomendación técnica:
Crear un MCP read-only primero, con queries allowlist. Nada de SQL libre desde IA.

Ejemplo de tools MCP:

find_bl_by_number
find_container_by_number
get_eta_risk_report
get_missing_documents_by_bl
get_client_shipments
get_agency_pending_operations
