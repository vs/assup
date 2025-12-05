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
    host: '0.0.0.0',
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
