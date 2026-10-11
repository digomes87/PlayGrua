import { defineConfig } from 'vitest/config';

const REPOSITORY_NAME = 'PlayGrua';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? `/${REPOSITORY_NAME}/` : '/',
  build: { target: 'es2022', sourcemap: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: { include: ['src/physics/**', 'src/sim/**'] },
  },
}));
