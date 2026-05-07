import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: [
      '.trycloudflare.com',
      '.saleheddinetouil.tech',
      '.loca.lt',
      '.lhr.life',
      '.ngrok-free.app',
      '.ngrok.app',
      '.ngrok.io',
      '.serveousercontent.com',
    ],
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
