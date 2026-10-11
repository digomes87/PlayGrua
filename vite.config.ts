import { defineConfig } from 'vitest/config';

const REPOSITORY_NAME = 'PlayGrua';

/** Production build and preview are served from the GitHub Pages project path. */
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? `/${REPOSITORY_NAME}/` : '/',
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 700 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: { include: ['src/physics/**', 'src/sim/**'] },
  },
}));
