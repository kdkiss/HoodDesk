import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/lib/portfolio/cost-basis.ts',
        'components/trading/types.ts',
        'components/swap/active-dca-orders.tsx',
        'components/swap/token-select-modal.tsx',
      ],
      exclude: [
        'node_modules/**',
        '.next/**',
        '**/__tests__/**',
        '**/*.test.ts',
        '**/*.test.tsx',
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 92,
        statements: 97,
      },
    },
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
  },
});
