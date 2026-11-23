import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function anchorFor(nodeModulesDir) {
  return pathToFileURL(path.join(nodeModulesDir, '_playwright_anchor.mjs')).href;
}

export function isPlaywrightSpecifier(specifier) {
  return (
    specifier === '@playwright/test' ||
    specifier.startsWith('@playwright/test/') ||
    specifier === 'playwright' ||
    specifier.startsWith('playwright/')
  );
}

let fallbackAnchor;

export function initialize(nodeModulesDir) {
  fallbackAnchor = anchorFor(nodeModulesDir);
}

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (fallbackAnchor && isPlaywrightSpecifier(specifier)) {
      return nextResolve(specifier, { ...context, parentURL: fallbackAnchor });
    }
    throw err;
  }
}
