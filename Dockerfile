# ============================================================
# EASYGESTION - Docker Image
# Build: docker build -t easygestion .
# Run: docker run -p 3001:3001 -e ADMIN_SENHA_HASH=... easygestion
# ============================================================

FROM node:24-alpine

# Instalar curl para healthcheck
RUN apk add --no-cache curl

# Workdir
WORKDIR /app

# Copiar package files
COPY package*.json ./

# Instalar dependências (production only)
RUN npm install --omit=dev

# Copiar código
COPY . .

# Criar diretório de banco de dados
RUN mkdir -p /app/db

# Expose porta
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3001/api/me || exit 1

# Start app
CMD ["npm", "start"]
