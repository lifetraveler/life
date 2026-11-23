/**
 * 测试 helper（src/ui/__tests__）：console.warn 静默收集 spy。
 * 模块导入时一次性 spyOn，随 jest 每个测试文件独立的模块注册表生效；
 * 用例内 beforeEach consoleWarnSpy.mockClear() 后按调用断言。
 */
export const consoleWarnSpy = jest
  .spyOn(console, 'warn')
  .mockImplementation(() => undefined);
