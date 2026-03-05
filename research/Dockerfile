FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files for workspace
COPY package*.json ./
COPY tsconfig.base.json ./

# Copy shared package
COPY packages/shared ./packages/shared

# Copy research package
COPY research/package*.json ./research/
COPY research/prisma ./research/prisma
COPY research/prisma.config.ts ./research/prisma.config.ts

# Install all dependencies from root (handles workspace linking)
# Delete lockfile to force fresh resolution of platform-specific optional dependencies
RUN rm -f package-lock.json && npm install

# Copy research source
COPY research ./research

# Build shared package first, generate Prisma client, then build research
RUN npm run build -w @assup/shared && \
    cd research && npx prisma generate && cd .. && \
    npm run build -w assup-research

FROM node:20-alpine

WORKDIR /app

# Copy root package files
COPY package*.json ./
COPY tsconfig.base.json ./

# Copy shared package (needed at runtime)
COPY packages/shared ./packages/shared

# Copy research package.json and prisma
COPY research/package*.json ./research/
COPY --from=builder /app/research/prisma ./research/prisma
COPY --from=builder /app/research/prisma.config.ts ./research/prisma.config.ts

# Install production dependencies and generate Prisma client for runtime
RUN rm -f package-lock.json && npm install --omit=dev && \
    cd research && npx prisma generate

# Copy built artifacts
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/research/dist ./research/dist

EXPOSE 3002

WORKDIR /app/research
CMD ["npm", "start"]
