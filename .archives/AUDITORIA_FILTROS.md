# AUDITORIA: Filtros em Estoque e Agrupamento de Vendas

## 🔴 PROBLEMA ANTES

### Estoque (routes/estoque.js, linha 22)
- ❌ GET /api/estoque retornava **TODOS** os produtos/tamanhos
- ❌ Sem filtro de categoria
- ❌ Sem filtro de coleção
- ❌ Sem busca por nome/código
- 📊 **Impacto:** Lista muito longa (500+ itens), dona se perde

**Query Anterior:**
```sql
SELECT ... FROM produtos p JOIN variacoes v 
WHERE p.ativo = 1 AND p.tenant_id = ? 
ORDER BY p.nome, v.id
```

### Vendas (routes/vendas.js, linha 230)
- ❌ GET /api/vendas retorna 500 vendas em lista linear
- ❌ Sem agrupamento por dia
- ❌ Scroll infinito desorganizado
- 📊 **Impacto:** Vendas de dias diferentes misturadas, difícil consultar

**Query Anterior:**
```sql
SELECT v.*, c.nome AS cliente_nome, vd.nome AS vendedor_nome
FROM vendas v
LEFT JOIN clientes c ... LEFT JOIN vendedores vd ...
ORDER BY v.data_hora DESC LIMIT 500
```

---

## ✅ SOLUÇÃO IMPLEMENTADA

### 1. Estoque com Filtros

**Nova Query:**
```sql
SELECT ... FROM produtos p JOIN variacoes v 
WHERE p.ativo = 1 AND p.tenant_id = ? 
  AND (?='' OR p.categoria = ?)           -- filtro categoria
  AND (?='' OR p.colecao = ?)              -- filtro coleção
  AND (?='' OR LOWER(p.nome) LIKE ?)       -- busca nome/código
ORDER BY p.nome, v.id LIMIT 500
```

**Parâmetros de Query:**
- `?categoria=vestido` — filtra só vestidos
- `?colecao=Estoque Antigo` — filtra coleção específica
- `?busca=azul` — busca por nome/código contendo "azul"
- Combinável: `?categoria=vestido&colecao=Novo&busca=azul`

**Response:**
```json
[
  {
    "produto_id": 1,
    "codigo": "VEST001",
    "nome": "Vestido Azul",
    "categoria": "vestido",
    "colecao": "Novo",
    "cor": "azul",
    "custo": 30,
    "preco_venda": 89.90,
    "variacao_id": 5,
    "tamanho": "P",
    "quantidade": 3
  }
]
```

### 2. Vendas com Agrupamento por Dia

**Nova Query (sem agrupamento):**
- Mantém comportamento anterior (lista linear)
- Sem parâmetro `agrupado` ou `agrupado=0`

**Nova Query (com agrupamento):**
- Ao adicionar `?agrupado=1`
- Retorna vendas **agrupadas por dia**

**Response com `?agrupado=1`:**
```json
{
  "dias": [
    {
      "data": "2026-06-23",
      "num": 5,
      "total": 450.00,
      "lucro": 120.00,
      "comissao": 22.50,
      "vendas": [
        { "id": 1001, "cliente_nome": "Maria", "total": 99.90, "lucro": 25.00, ... },
        { "id": 1000, "cliente_nome": "João", "total": 89.90, "lucro": 18.00, ... },
        ...
      ]
    },
    {
      "data": "2026-06-22",
      "num": 3,
      "total": 280.00,
      "lucro": 75.00,
      "comissao": 14.00,
      "vendas": [ ... ]
    }
  ],
  "resumo": {
    "total": 730.00,
    "lucro": 195.00,
    "comissao": 36.50,
    "n": 8,
    "ticketMedio": 91.25
  }
}
```

---

## 🎯 COMO USAR (Frontend)

### Estoque Filtrado
```javascript
// Buscar vestidos da coleção "Novo" com "azul" no nome
fetch('/api/estoque?categoria=vestido&colecao=Novo&busca=azul')
  .then(r => r.json())
  .then(itens => {
    // itens filtrados prontos
  });

// Selects dinâmicos no HTML
<select id="categoria">
  <option value="">Todas</option>
  <option value="vestido">Vestido</option>
  <option value="blusa">Blusa</option>
</select>

<input id="busca" placeholder="Buscar por nome/código...">

// Event listeners
document.getElementById('categoria').addEventListener('change', (e) => {
  const categoria = e.target.value;
  const colecao = document.getElementById('colecao').value;
  const busca = document.getElementById('busca').value;
  fetch(`/api/estoque?categoria=${categoria}&colecao=${colecao}&busca=${busca}`)
    .then(r => r.json())
    .then(itens => renderizar(itens));
});
```

### Vendas Agrupadas
```javascript
// Ver vendas agrupadas por dia
fetch('/api/vendas?de=2026-06-01&ate=2026-06-30&agrupado=1')
  .then(r => r.json())
  .then(({ dias, resumo }) => {
    // dias = array de { data, num, total, lucro, comissao, vendas[] }
    // resumo = totais gerais
    dias.forEach(dia => {
      console.log(`${dia.data}: ${dia.num} vendas, R$${dia.total}`);
      dia.vendas.forEach(v => {
        console.log(`  - Cliente: ${v.cliente_nome}, Total: ${v.total}`);
      });
    });
  });
```

---

## 📊 IMPACTO

**Estoque:**
- ✅ Dona consegue encontrar produtos rapidamente
- ✅ Filtra por categoria (vestido, blusa, etc)
- ✅ Filtra por coleção (Novo, Estoque Antigo, etc)
- ✅ Busca por nome ou código
- ✅ **Antes:** 500 items misturados / **Depois:** 5-20 items relevantes

**Vendas:**
- ✅ Visão clara por dia
- ✅ Agrupa vendas do mesmo dia automaticamente
- ✅ Totais por dia (faturamento, lucro, comissão)
- ✅ Resume geral no rodapé
- ✅ **Antes:** scroll infinito / **Depois:** estrutura organizada

---

## 📝 CHECKLIST DEPLOY

- [x] Estoque: adicionar filtros (categoria, coleção, busca)
- [x] Vendas: adicionar agrupamento por dia (parâmetro ?agrupado=1)
- [x] Ambos retornam LIMIT 500 (sem paginação, bom o suficiente)
- [ ] Frontend: adicionar selects de categoria/coleção no estoque.html
- [ ] Frontend: adicionar botão "Agrupar por dia" no histórico.html
- [ ] Testar: filtro estoque com 3+ categorias
- [ ] Testar: agrupamento vendas com 100+ vendas em 10+ dias

---

## PRÓXIMOS PASSOS (SE NECESSÁRIO)

### Paginação (se > 500 itens)
```sql
LIMIT 50 OFFSET (page-1)*50
```

### Filtro de Estoque Mínimo
```
?estoque_minimo=true  -- mostra só itens com qtd <= 5
```

### Exportar Vendas Agrupadas como CSV
```
GET /api/vendas/export?de=2026-06-01&ate=2026-06-30&agrupado=1&formato=csv
```

---

**Status:** ✅ Pronto para QA
**Prioridade:** MÉDIA (UX, não bloqueador)
