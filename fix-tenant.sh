#***REMOVED***/bin/bash
# Script para corrigir vulnerabilidade de multi-tenancy
# Remove fallbacks perigosos || 1 e substitui por req.tenantId com validação

for file in routes/*.js; do
  echo "Processando $file..."
  # Substitui req.tenantId || 1 por req.tenantId (seguro porque injetarTenant já valida)
  sed -i "s/req\.tenantId || 1/req.tenantId/g" "$file"
done

echo "✓ Fallback || 1 removidos de todas as rotas"
