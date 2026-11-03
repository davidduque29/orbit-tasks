import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/orbit-tasks/',
  plugins: [react()],
});
