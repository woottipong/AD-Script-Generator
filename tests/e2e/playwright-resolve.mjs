import { register, registerHooks } from 'node:module';
import { anchorFor, isPlaywrightSpecifier } from './playwright-hook.mjs';

const nmDir = process.env.PW_NODE_MODULES;
if (nmDir) {
  if (typeof registerHooks === 'function') {
    const fallbackAnchor = anchorFor(nmDir);
    registerHooks({
      resolve(specifier, context, nextResolve) {
        try {
          return nextResolve(specifier, context);
        } catch (err) {
          if (isPlaywrightSpecifier(specifier)) {
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
