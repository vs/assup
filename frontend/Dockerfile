FROM node:22-alpine AS builder

WORKDIR /app

ARG VITE_API_URL=http://localhost:3000

# Copy root package files and lockfile for deterministic installs
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./

# Copy workspace package.json files (required for npm ci to resolve workspace graph)
COPY packages/shared/package.json ./packages/shared/
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/
COPY desktop/package.json ./desktop/

# Install dependencies without running postinstall scripts
RUN npm ci --ignore-scripts --workspace=@assup/shared --workspace=frontend --include-workspace-root

# Copy shared and frontend sources
COPY packages/shared ./packages/shared
COPY frontend ./frontend

# Build shared and frontend
RUN npm run build -w @assup/shared && \
    VITE_API_URL=$VITE_API_URL npm run build -w frontend

FROM nginx:alpine

COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
