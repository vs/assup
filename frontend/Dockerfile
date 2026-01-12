FROM node:20-alpine AS builder

WORKDIR /app

ARG VITE_API_URL=http://localhost:3000

# Copy root package files for workspace
COPY package*.json ./
COPY tsconfig.base.json ./

# Copy shared package
COPY packages/shared ./packages/shared

# Copy frontend package
COPY frontend/package*.json ./frontend/

# Install all dependencies from root (handles workspace linking)
RUN npm ci

# Copy frontend source
COPY frontend ./frontend

# Build shared package first, then frontend
RUN npm run build -w @assup/shared && \
    VITE_API_URL=$VITE_API_URL npm run build -w frontend

FROM nginx:alpine

COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
