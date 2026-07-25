module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: [
    '<rootDir>/core',
    '<rootDir>/plugins',
    '<rootDir>/electron',
    '<rootDir>/server',
    '<rootDir>/web/src/utils',
  ],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
};
