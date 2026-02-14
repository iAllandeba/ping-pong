FROM node:20-alpine

WORKDIR /app

# Copiar apenas arquivos de dependências primeiro
COPY package*.json ./

# Instalar dependências somente de produção
RUN npm ci --only=production && npm cache clean --force

COPY . .

ENV PORT=3000

EXPOSE 3000

# Usuário não-root por segurança (já existe na imagem node)
USER node

CMD ["node", "./server/server.js"]