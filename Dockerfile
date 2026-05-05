# Alpine: python3 + pip; postinstall ставит зависимости с --break-system-packages (PEP 668).
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
