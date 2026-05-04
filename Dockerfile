# Сборка образа: postinstall ставит Python-зависимости; нужны файлы в первом COPY.
FROM node:20-bookworm-slim
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*

# postinstall в package.json сам вызывает pip (requirements.txt по возможности).
COPY package.json package-lock.json requirements.txt ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build

ENV PORT=3000
EXPOSE 3000
CMD ["node", "start.mjs"]
