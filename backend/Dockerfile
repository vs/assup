FROM node:22-alpine AS builder

WORKDIR /app

# Copy root package files and lockfile for deterministic installs
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./

# Copy workspace package.json files (required for npm ci to resolve workspace graph)
COPY packages/shared/package.json ./packages/shared/
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/
COPY desktop/package.json ./desktop/

# Install dependencies without running postinstall scripts
RUN npm ci --ignore-scripts --workspace=@assup/shared --workspace=assup-backend --include-workspace-root

# Copy shared and backend sources
COPY packages/shared ./packages/shared
COPY backend ./backend

# Fetch Prisma engine binaries (skipped by --ignore-scripts above)
RUN node node_modules/@prisma/engines/scripts/postinstall.js

# Build shared, generate Prisma client, build backend, compile seed script
RUN npm run build -w @assup/shared && \
    cd backend && DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate && cd .. && \
    npm run build -w backend && \
    cd backend && npx tsc prisma/seed.ts --outDir dist/prisma --esModuleInterop --module NodeNext --moduleResolution NodeNext --skipLibCheck

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install Chromium for Seeking Alpha headless browser scraping
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV CHROME_PATH=/usr/bin/chromium-browser

# Copy root package files and lockfile
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./

# Copy all workspace package.json files for dependency resolution
COPY packages/shared/package.json ./packages/shared/
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/
COPY desktop/package.json ./desktop/
COPY --from=builder /app/backend/prisma ./backend/prisma

# Install production dependencies and generate Prisma client for runtime
# --ignore-scripts is safe here: no native modules needed at runtime, only node_modules
RUN npm ci --omit=dev --ignore-scripts --workspace=@assup/shared --workspace=assup-backend && \
    node node_modules/@prisma/engines/scripts/postinstall.js && \
    cd backend && DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate

# Install Claude Code CLI globally for research synthesis
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user with home dir (claude-code refuses --dangerously-skip-permissions as root)
RUN addgroup -S assup && adduser -S assup -G assup -h /home/assup -s /bin/sh

# Create minimal Claude config so CLI doesn't crash on startup
RUN mkdir -p /home/assup/.claude && \
    echo '{"hasCompletedOnboarding":true}' > /home/assup/.claude.json && \
    chown -R assup:assup /home/assup/.claude /home/assup/.claude.json

# Copy built artifacts
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/prisma.config.ts ./backend/prisma.config.ts
COPY --from=builder /app/backend/dist/prisma ./backend/dist/prisma

# Ensure the non-root user can access the app directory
RUN chown -R assup:assup /app

EXPOSE 3000

USER assup
ENV HOME=/home/assup
WORKDIR /app/backend
CMD ["npm", "start"]
