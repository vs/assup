FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files and lockfile for deterministic installs
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./

# Copy workspace package.json files (required for npm ci to resolve workspace graph)
COPY packages/shared/package.json ./packages/shared/
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/
COPY research/package.json ./research/
COPY desktop/package.json ./desktop/

# Install dependencies without running postinstall scripts
RUN npm ci --ignore-scripts --workspace=@assup/shared --workspace=assup-research --include-workspace-root

# Copy shared and research sources
COPY packages/shared ./packages/shared
COPY research ./research

# Build shared, generate Prisma client, build research
RUN npm run build -w @assup/shared && \
    cd research && DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate && cd .. && \
    npm run build -w assup-research

FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# Copy root package files and lockfile
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./

# Copy all workspace package.json files for dependency resolution
COPY packages/shared/package.json ./packages/shared/
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/
COPY research/package.json ./research/
COPY desktop/package.json ./desktop/
COPY --from=builder /app/research/prisma ./research/prisma
COPY --from=builder /app/research/prisma.config.ts ./research/prisma.config.ts

# Install production dependencies and generate Prisma client for runtime
# --ignore-scripts is safe here: no native modules needed at runtime, only node_modules
RUN npm ci --omit=dev --ignore-scripts --workspace=@assup/shared --workspace=assup-research && \
    cd research && DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate

# Copy built artifacts
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/research/dist ./research/dist

EXPOSE 3002

WORKDIR /app/research
CMD ["npm", "start"]
