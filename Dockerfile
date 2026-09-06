# syntax=docker/dockerfile:1

# ---- Build stage ----
# Node 24 matches the repo's CI/runtime version.
FROM node:24-slim AS build
WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Build the app. `next/font/google` downloads fonts at build time, so this
# stage needs network access (the default for `docker build`).
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* values are inlined by Next at build time; declare them so
# `docker build --build-arg` (or compose `build.args`) can set them.
ARG NEXT_PUBLIC_UMAMI_SCRIPT_URL
ARG NEXT_PUBLIC_UMAMI_HOST_URL
ARG NEXT_PUBLIC_UMAMI_WEBSITE_ID
ARG NEXT_PUBLIC_GTNH_DATASET_MANIFEST_URL
ENV NEXT_PUBLIC_UMAMI_SCRIPT_URL=$NEXT_PUBLIC_UMAMI_SCRIPT_URL \
    NEXT_PUBLIC_UMAMI_HOST_URL=$NEXT_PUBLIC_UMAMI_HOST_URL \
    NEXT_PUBLIC_UMAMI_WEBSITE_ID=$NEXT_PUBLIC_UMAMI_WEBSITE_ID \
    NEXT_PUBLIC_GTNH_DATASET_MANIFEST_URL=$NEXT_PUBLIC_GTNH_DATASET_MANIFEST_URL

RUN npm run build

# ---- Runtime stage ----
FROM node:24-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

# Production dependencies only (keeps the image smaller than copying the
# full build-stage node_modules).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Application artefacts. next.config.ts is deliberately NOT copied: `next start`
# reads the resolved config from .next/required-server-files.json.
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public

# Run as an unprivileged user.
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs
USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/version').then(function(r){ if(!r.ok) process.exit(1); }).catch(function(){ process.exit(1); })"

CMD ["npm", "start"]
