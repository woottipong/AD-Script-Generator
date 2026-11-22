import { register, registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const nmDir = process.env.PW_NODE_MODULES;
if (nmDir) {
  if (typeof registerHooks === 'function') {
    const fallbackAnchor = pathToFileURL(path.join(nmDir, '_playwright_anchor.mjs')).href;
    registerHooks({
      resolve(specifier, context, nextResolve) {
        try {
          return nextResolve(specifier, context);
        } catch (err) {
          if (
            specifier === '@playwright/test' ||
            specifier.startsWith('@playwright/test/') ||
            specifier === 'playwright' ||
            specifier.startsWith('playwright/')
          ) {
            return nextResolve(specifier, { ...context, parentURL: fallbackAnchor });
          }
          throw err;
        }
      },
    });
  } else {
    register(new URL('./playwright-hook.mjs', import.meta.url), { data: nmDir });
  }
}
