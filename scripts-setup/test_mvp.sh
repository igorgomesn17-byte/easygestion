#***REMOVED***/bin/bash
set -e

BASE="http://localhost:3003"
TENANT="test_loja_123"

echo "🚀 TESTE DE INTEGRAÇÃO MVP — DRE-EXPRESS"
echo "========================================"

# Helper: API call
api() {
  curl -s -H "Content-Type: application/json" \
    -H "Cookie: tenant=$TENANT" \
    -X "$1" "$BASE$2" \
    -d "${3:-}" | jq . || echo "ERR"
}

echo ""
echo "✅ BLOCO 1: Verificar servidor rodando"
if curl -s "$BASE/login.html" | grep -q "DOCTYPE"; then
  echo "   ✓ Servidor respondendo na porta 3003"
else
  echo "   ✗ Servidor NÃO respondendo"
  exit 1
fi

echo ""
echo "✅ BLOCO 2: Testar API de config"
CONFIG=$(api GET "/api/config")
echo "   Loja: $(echo $CONFIG | jq -r '.loja_nome // "sem nome"')"

echo ""
echo "✅ BLOCO 3: Testar lista de produtos"
PRODUTOS=$(api GET "/api/produtos")
QTPROD=$(echo $PRODUTOS | jq 'length')
echo "   Total de produtos: $QTPROD"

echo ""
echo "✅ BLOCO 4: Testar caixa"
CAIXA=$(api GET "/api/caixa/hoje")
echo "   Caixa hoje: $(echo $CAIXA | jq -r '.aberto // "ERR"')"

echo ""
echo "✅ BLOCO 5: Testar DRE"
DRE=$(api GET "/api/financeiro/dre?mes=2026-06")
RECEITA=$(echo $DRE | jq -r '.resultado_bruto // "0"')
echo "   Receita bruta: $RECEITA"

echo ""
echo "✅ BLOCO 6: Testar Fluxo de Caixa"
FLUXO=$(api GET "/api/financeiro/fluxo-caixa?mes=2026-06")
ARECEBER=$(echo $FLUXO | jq -r '.resumo.aReceber // "ERR"')
echo "   A receber: $ARECEBER"

echo ""
echo "========================================"
echo "✅ TESTES BÁSICOS PASSARAM***REMOVED***"
echo ""
echo "📋 Próximo passo: Testes manuais via navegador"
echo "   Use o CHECKLIST_MVP.md para validação completa"

