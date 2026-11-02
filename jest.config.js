module.exports = {
  // Expo SDK 54 官方测试 preset（用户确认的方案 A）：复用 babel.config.js（含 legacy decorators），
  // 并自带 react-native 的 transformIgnorePatterns 与模块 mock。
  preset: 'jest-expo',
  // 只收集本工程的测试（默认规则已排除 node_modules，此处显式限定 src 下的测试文件）。
  testMatch: ['<rootDir>/src/**/*.test.@(ts|tsx)'],
};
