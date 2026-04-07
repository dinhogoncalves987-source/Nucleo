import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      // Proxy para Bubble.io — resolve CORS em desenvolvimento
      '/bubble-api': {
        target: 'https://thebeautyhub.com.br',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/bubble-api/, ''),
        configure: (proxy) => {
          proxy.on('error', (err) => console.warn('[Bubble Proxy]', err.message))
        },
      },
    },
  },
})
