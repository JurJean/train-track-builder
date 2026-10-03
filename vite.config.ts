import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        gallery: 'gallery.html',
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
