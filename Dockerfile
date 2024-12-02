FROM node:20.16.0-alpine AS base

ENV APP_DIR=/app

RUN mkdir -p ${APP_DIR}
WORKDIR ${APP_DIR}

# Install dependencies only when needed
FROM base AS deps

ENV CI=1
ENV HUSKY=0

# Install dependencies based on the preferred package manager
COPY package.json pnpm-lock.yaml* ./

RUN corepack enable pnpm
RUN pnpm config set store-dir ~/.pnpm-store

# First install the dependencies (as they change less often)
RUN --mount=type=cache,id=pnpm,target=~/.pnpm-store pnpm install --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder

ENV CI=1

COPY --from=deps ${APP_DIR}/node_modules ./node_modules
COPY . .

RUN corepack enable pnpm && pnpm run build

FROM nginx:stable-alpine AS runner

COPY --from=builder /app/nginx /etc/nginx/conf.d
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
