// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  esbuild: {
    // Allow JSX syntax in .js files as well as .jsx
    include: /\.(jsx|tsx|js|ts)$/,
  },
});