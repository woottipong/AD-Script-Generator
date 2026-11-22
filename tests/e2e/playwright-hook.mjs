import path from 'node:path';
import { pathToFileURL } from 'node:url';

let fallbackAnchor;

export function initialize(nodeModulesDir) {
  fallbackAnchor = pathToFileURL(path.join(nodeModulesDir, '_playwright_anchor.mjs')).href;
}

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (
      fallbackAnchor &&
      (specifier === '@playwright/test' ||
        specifier.startsWith('@playwright/test/') ||
        specifier === 'playwright' ||
        specifier.startsWith('playwright/'))
    ) {
      return nextResolve(specifier, { ...context, parentURL: fallbackAnchor });
    }
    throw err;
  }
}
