const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Required to resolve package.json `exports` fields from workspace packages.
config.resolver.unstable_enablePackageExports = true;

// The workspace TS packages (@amarnai/tokens, /shared, /api-client) ship their
// source with NodeNext-style ".js" import specifiers (e.g. `from "./colors.js"`),
// which Node/Next resolve to the ".ts" source but Metro does not. Map a failing
// relative ".js" import to its ".ts"/".tsx" sibling. Real ".js" files still
// resolve first, so this only kicks in for the TS-source case.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  const isRelative = moduleName.startsWith('./') || moduleName.startsWith('../');
  if (isRelative && moduleName.endsWith('.js')) {
    try {
      return resolve(context, moduleName, platform);
    } catch {
      const base = moduleName.slice(0, -'.js'.length);
      for (const ext of ['.ts', '.tsx']) {
        try {
          return resolve(context, base + ext, platform);
        } catch {
          // try the next extension
        }
      }
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
