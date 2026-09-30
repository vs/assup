import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Loopback only: /api is proxied to the unauthenticated backend. Inside
    // Docker it must listen on all interfaces; the port mapping keeps it local.
    host: process.env.DOCKER ? '0.0.0.0' : '127.0.0.1',
    port: 5173,
    watch: {
      usePolling: true, // Required for Docker volume mounts
    },
    proxy: {
      '/api': {
        target: process.env.DOCKER ? 'http://backend:3000' : 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
