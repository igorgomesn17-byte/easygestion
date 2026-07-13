// ============================================================
// Esquemas de Validação com Zod
// Validação rigorosa de entrada em todos os endpoints
// ============================================================

const { z } = require('zod');

// ========== VENDAS ==========
const schemaVendaItem = z.object({
  produto_id: z.number().int().positive('produto_id deve ser um número positivo'),
  variacao_id: z.number().int().positive('variacao_id deve ser um número positivo'),
  qtd: z.number().int().positive('Quantidade deve ser positiva').max(999, 'Quantidade máxima: 999'),
  preco: z.number().positive('Preço deve ser positivo'),
  nome_produto: z.string().optional(),
});

const schemaVenda = z.object({
  cliente_id: z.number().int().positive().optional().nullable(),
  itens: z.array(schemaVendaItem).min(1, 'Mínimo 1 item na venda'),
  taxa_percentual: z.number().min(0, 'Taxa não pode ser negativa').max(10, 'Taxa máxima: 10%'),
  desconto: z.number().min(0, 'Desconto não pode ser negativo').max(10000, 'Desconto máximo: R$10.000'),
  forma_pagamento: z.enum(['pix', 'débito', 'crédito', 'dinheiro'], {
    errorMap: () => ({ message: 'Forma de pagamento inválida' })
  }),
  parcelas: z.number().int().min(1).max(12).optional().default(1),
  observacao: z.string().max(500).optional().nullable(),
});

// ========== FINANCEIRO ==========
const schemaFinanceiro = z.object({
  descricao: z.string().min(1, 'Descrição obrigatória').max(255),
  categoria: z.enum(['aluguel', 'energia', 'fornecedor', 'salário', 'juros', 'imposto', 'outro'], {
    errorMap: () => ({ message: 'Categoria inválida' })
  }),
  valor: z.number().positive('Valor deve ser positivo').max(999999, 'Valor máximo: R$999.999'),
  tipo: z.enum(['fixa', 'variável'], {
    errorMap: () => ({ message: 'Tipo deve ser "fixa" ou "variável"' })
  }),
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data inválido (YYYY-MM-DD)'),
  paga: z.boolean().optional().default(false),
  empresa_ou_pessoal: z.enum(['empresa', 'pessoal']).optional().default('empresa'),
});

// ========== PRODUTOS ==========
const schemaProduto = z.object({
  codigo: z.string().min(1, 'Código obrigatório').max(50),
  nome: z.string().min(1, 'Nome obrigatório').max(255),
  descricao: z.string().max(1000).optional().nullable(),
  preco: z.number().positive('Preço deve ser positivo'),
  custo: z.number().min(0, 'Custo não pode ser negativo').optional(),
  categoria: z.string().max(100).optional().nullable(),
  categoria_id: z.number().int().positive().optional().nullable(),
  ativo: z.boolean().optional().default(true),
});

// ========== ESTOQUE / VARIAÇÕES ==========
// Uma variacao e' um SKU: o par (cor, tamanho) de um produto. A cor entrou aqui na
// migration 029 — sem ela, este schema validaria uma grade que o banco rejeita.
// (Hoje nenhuma rota importa este schema; a validacao real mora em lib/sku.js.)
const schemaVariacao = z.object({
  cor: z.string().max(40).optional(),          // vazio -> 'Unica' (ver lib/sku.js)
  tamanho: z.string().min(1, 'Tamanho obrigatório').max(10),
  quantidade: z.number().int().min(0, 'Quantidade não pode ser negativa').max(9999),
  codigo_barras: z.string().max(48).optional().nullable(),
});

const schemaMovimentoEstoque = z.object({
  produto_id: z.number().int().positive(),
  tipo: z.enum(['entrada', 'saída', 'ajuste']),
  quantidade: z.number().int().positive('Quantidade deve ser positiva'),
  motivo: z.string().max(255).optional(),
  referencia: z.string().max(100).optional(),
});

// ========== CAIXA ==========
const schemaAbrirCaixa = z.object({
  fundo_troco: z.number().min(0, 'Fundo de troco não pode ser negativo').max(10000),
  observacao: z.string().max(500).optional().nullable(),
});

const schemaFecharCaixa = z.object({
  contado: z.number().min(0, 'Valor contado não pode ser negativo'),
  observacao: z.string().max(500).optional().nullable(),
});

const schemaSangria = z.object({
  valor: z.number().positive('Valor deve ser positivo'),
  motivo: z.string().max(255).optional(),
});

const schemaSuprimento = z.object({
  valor: z.number().positive('Valor deve ser positivo'),
  motivo: z.string().max(255).optional(),
});

// ========== CLIENTES ==========
const schemaCliente = z.object({
  nome: z.string().min(1, 'Nome obrigatório').max(255),
  telefone: z.string().max(20).optional().nullable(),
  email: z.string().email('Email inválido').optional().nullable(),
  cpf_cnpj: z.string().max(20).optional().nullable(),
  cidade: z.string().max(100).optional().nullable(),
  aniversario: z.string().regex(/^\d{2}\/\d{2}$/, 'Formato DD/MM').optional().nullable(),
  origem: z.enum(['loja', 'instagram', 'whatsapp', 'indicacao', 'outro']).optional(),
});

// ========== TROCAS ==========
const schemaTraca = z.object({
  venda_origem_id: z.number().int().positive('Venda inválida'),
  itens_devolvidos: z.array(z.object({
    item_id: z.number().int().positive(),
    qtd: z.number().int().positive(),
  })).min(1, 'Mínimo 1 item devolvido'),
  itens_levados: z.array(z.object({
    produto_id: z.number().int().positive(),
    variacao_id: z.number().int().positive(),
    qtd: z.number().int().positive(),
    preco: z.number().positive(),
  })).optional(),
  observacao: z.string().max(500).optional(),
});

// ========== USUÁRIOS ==========
const schemaUsuario = z.object({
  nome: z.string().min(1, 'Nome obrigatório').max(255),
  email: z.string().email('Email inválido'),
  senha: z.string().min(8, 'Senha deve ter no mínimo 8 caracteres'),
  papel: z.enum(['admin', 'vendedor', 'gerente']).optional().default('vendedor'),
});

const schemaLoginTenant = z.object({
  email: z.string().email('Email inválido'),
  senha: z.string().min(1, 'Senha obrigatória'),
});

// ========== ASSINATURAS ==========
const schemaCheckoutSession = z.object({
  tipo_plano: z.enum(['mensal', 'anual'], {
    errorMap: () => ({ message: 'Plano deve ser "mensal" ou "anual"' })
  }),
});

// ========== VALES ==========
const schemaVale = z.object({
  cliente_id: z.number().int().positive('Cliente inválido'),
  valor: z.number().positive('Valor deve ser positivo'),
  descricao: z.string().max(500).optional(),
  data_criacao: z.string().datetime().optional(),
});

// ========== HELPER: Função para validar e retornar erros amigáveis ==========
const validarSchema = (schema, dados) => {
  try {
    const resultado = schema.parse(dados);
    return { valido: true, dados: resultado };
  } catch (erro) {
    if (erro instanceof z.ZodError) {
      const erros = erro.errors.map(e => ({
        campo: e.path.join('.'),
        mensagem: e.message,
        tipo: e.code
      }));
      return { valido: false, erros };
    }
    throw erro;
  }
};

module.exports = {
  // Vendas
  schemaVenda,
  schemaVendaItem,
  // Financeiro
  schemaFinanceiro,
  // Produtos
  schemaProduto,
  // Estoque
  schemaVariacao,
  schemaMovimentoEstoque,
  // Caixa
  schemaAbrirCaixa,
  schemaFecharCaixa,
  schemaSangria,
  schemaSuprimento,
  // Clientes
  schemaCliente,
  // Trocas
  schemaTraca,
  // Usuários
  schemaUsuario,
  schemaLoginTenant,
  // Assinaturas
  schemaCheckoutSession,
  // Vales
  schemaVale,
  // Helper
  validarSchema,
};
