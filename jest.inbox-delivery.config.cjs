const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('./tsconfig.base.json');
module.exports = {
  testEnvironment: 'node',
  transform: { '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true, diagnostics: false, tsconfig: { ...compilerOptions, module: 'commonjs', target: 'ES2022', incremental: false } }] },
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, { prefix: '<rootDir>/' }),
  testMatch: [
    '<rootDir>/apps/backend/src/public-api/routes/v1/public.integrations.inbox-delivery.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/database/prisma/posts/posts.inbox-delivery.spec.ts',
  ],
  maxWorkers: 1, cache: false, collectCoverage: false, testTimeout: 5000, reporters: ['default'],
};
