FROM node:22.19.0 AS builder

RUN npm install -g pnpm@10.27.0

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile --config.minimum-release-age=0

COPY . .

RUN pnpm build


FROM node:22.19.0 AS runner

RUN npm install -g pnpm@10.27.0

WORKDIR /app

ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml ./

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

CMD ["node", "dist/main"]