const path = require('path');

// The Lingui macro plugin searches upward from cwd for a lingui config, but the
// shared config lives in packages/i18n (outside the mobile app tree). Point the
// plugin at it explicitly, mirroring apps/web's vitest setup.
process.env.LINGUI_CONFIG = path.resolve(
  __dirname,
  '../../packages/i18n/lingui.config.ts',
);

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['@lingui/babel-plugin-lingui-macro'],
  };
};
