FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files for workspace
COPY package*.json ./
COPY tsconfig.base.json ./

# Copy shared package
COPY packages/shared ./packages/shared

# Copy backend package
COPY backend/package*.json ./backend/
COPY backend/prisma ./backend/prisma

# Install all dependencies from root (handles workspace linking)
# Delete lockfile to force fresh resolution of platform-specific optional dependencies
RUN rm -f package-lock.json && npm install

# Copy backend source
COPY backend ./backend

# Build shared package first, then backend
RUN npm run build -w @assup/shared && \
    npm run build -w backend

FROM node:20-alpine

WORKDIR /app

# Copy root package files
COPY package*.json ./
COPY tsconfig.base.json ./

# Copy shared package (needed at runtime)
COPY packages/shared ./packages/shared

# Copy backend package.json and prisma
COPY backend/package*.json ./backend/
COPY --from=builder /app/backend/prisma ./backend/prisma

# Install production dependencies
RUN rm -f package-lock.json && npm install --omit=dev

# Copy built artifacts
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/prisma.config.ts ./backend/prisma.config.ts
COPY --from=builder /app/backend/node_modules/@prisma/client ./backend/node_modules/@prisma/client
COPY --from=builder /app/backend/node_modules/.prisma ./backend/node_modules/.prisma

EXPOSE 3000

WORKDIR /app/backend
CMD ["npm", "start"]
