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
COPY patches ./patches

RUN corepack enable pnpm
RUN pnpm config set store-dir ~/.pnpm-store

# First install the dependencies (as they change less often)
RUN --mount=type=cache,id=pnpm,target=~/.pnpm-store pnpm install --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder

# Define all origins that are allowed to frame this website
ARG ALLOWED_FRAME_ANCESTORS
ENV VITE_ALLOWED_FRAME_ANCESTORS=${ALLOWED_FRAME_ANCESTORS}

ENV CI=1

COPY --from=deps ${APP_DIR}/node_modules ./node_modules
COPY . .

RUN corepack enable pnpm && pnpm run build

FROM nginx:stable-alpine AS runner

ARG ALLOWED_FRAME_ANCESTORS
ENV ALLOWED_FRAME_ANCESTORS=${ALLOWED_FRAME_ANCESTORS}

COPY --from=builder /app/nginx/nginx.conf /etc/nginx/
COPY --from=builder /app/nginx/default.conf.template /etc/nginx/templates/
COPY --from=builder /app/dist /usr/share/nginx/html

RUN chmod -R a+wx /etc/nginx/conf.d

EXPOSE 8080
