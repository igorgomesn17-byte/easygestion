// ============================================================
// Configuração OpenAPI/Swagger
// ============================================================

const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'EasyGestão API',
      version: '0.1.0',
      description: 'ERP SaaS para lojistas de moda. PDV + Financeiro + NFC-e',
      contact: {
        name: 'Igor Desidério',
        email: 'igor@easygestion.com.br'
      }
    },
    servers: [
      {
        url: process.env.SITE_URL || 'http://localhost:3001',
        description: 'API Server'
      }
    ],
    components: {
      securitySchemes: {
        sessionAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'ds.sid',
          description: 'Session ID em cookie'
        }
      }
    },
    security: [
      {
        sessionAuth: []
      }
    ],
    tags: [
      { name: 'Auth', description: 'Autenticação e Login' },
      { name: 'Clientes', description: 'Gestão de Clientes' },
      { name: 'Produtos', description: 'Gestão de Produtos e Estoque' },
      { name: 'Vendas', description: 'PDV e Vendas' },
      { name: 'Financeiro', description: 'Relatórios e DRE' },
      { name: 'Admin', description: 'Admininstração' }
    ]
  },
  apis: ['./routes/*.js']
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
