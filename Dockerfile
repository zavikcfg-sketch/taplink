# Сборка образа: postinstall ставит Python-зависимости; нужны файлы в первом COPY.
FROM node:20-bookworm-slim
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*

# Вместе с package*.json — иначе postinstall не найдёт скрипт / requirements.
COPY package.json package-lock.json requirements.txt install-py-deps.mjs ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build

ENV PORT=3000
EXPOSE 3000
CMD ["node", "start.mjs"]
