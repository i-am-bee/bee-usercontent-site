FROM node:20.11.1-alpine AS base

# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat

ENV APP_DIR=/app

RUN mkdir -p ${APP_DIR}
WORKDIR ${APP_DIR}

# Install dependencies only when needed
FROM base AS deps

ENV CI=1
ENV HUSKY=0

# Install dependencies based on the preferred package manager
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable pnpm && pnpm i --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder

ENV CI=1

COPY --from=deps ${APP_DIR}/node_modules ./node_modules
COPY . .

RUN corepack enable pnpm && pnpm run build;

# Production image, copy all the files and run next
FROM base AS runner

ENV NODE_ENV production

# https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md
RUN deluser --remove-home node \
  && addgroup -S node -g 1001 \
  && adduser -S -G node -u 1001 node

COPY --from=builder ${APP_DIR}/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown node:node .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=node:node ${APP_DIR}/.next/standalone ./
COPY --from=builder --chown=node:node ${APP_DIR}/.next/static ./.next/static

USER node

EXPOSE 3000

ENV PORT 3000

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
CMD node server.js
