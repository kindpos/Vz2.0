import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: [
      'terminal/**/*.test.js',
      'overseer/**/*.test.js',
    ],
    exclude: [
      'node_modules/**',
      'backend/**',
      '.git/**',
    ],
  },
});
