# Alpine: пакет python3 без pip — нужен py3-pip (или postinstall сам вызовет apk в /.dockerenv).
FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache python3 py3-pip

COPY package.json package-lock.json requirements.txt ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build

ENV PORT=3000
EXPOSE 3000
CMD ["node", "start.mjs"]
