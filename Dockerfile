# Base node image
FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json package-lock.json ./
# Include prisma schema for generate during install if any
COPY prisma ./prisma
# --no-audit skips vulnerability metadata fetch; --loglevel=error silences
# transitive deprecation notices (e.g. tsconfck via vite-tsconfig-paths) that
# are upstream's responsibility to resolve, not actionable here.
RUN npm ci --no-audit --loglevel=error

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js telemetry
ENV NEXT_TELEMETRY_DISABLED=1

# Generate Prisma Client
RUN npx prisma generate

# Build Next.js app
RUN npm run build

# Production image, copy all the files and run next
FROM base AS web
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy prisma schema and engine
COPY --from=builder /app/prisma ./prisma

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000

CMD ["node", "server.js"]

# Worker image
FROM base AS worker
WORKDIR /app

ENV NODE_ENV=production

# The worker uses tsx, so we need to bring all dependencies including devDependencies
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client
RUN npx prisma generate

CMD ["npm", "run", "worker:start"]
