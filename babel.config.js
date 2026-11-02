module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['@babel/plugin-proposal-decorators', { legacy: true }],
      // @formatjs/intl-* polyfill 源码使用 class static block（切片 5 polyfill 依赖），
      // babel-preset-expo 默认未启用该语法解析；此插件已在 node_modules（传递依赖），非新增安装。
      '@babel/plugin-transform-class-static-block',
    ],
  };
};
