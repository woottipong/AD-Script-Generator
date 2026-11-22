import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const localCli = path.join(repoRoot, 'node_modules/@playwright/test/cli.js');
const args = process.argv.slice(2);

let cliPath = localCli;
const env = { ...process.env };

if (!fs.existsSync(localCli)) {
  const binDir = execFileSync(
    'npx',
    [
      '--yes',
      '--package',
      '@playwright/test',
      'node',
      '-e',
      "const fs=require('fs'),p=require('path');console.log(process.env.PATH.split(p.delimiter).find(d=>fs.existsSync(p.join(d,'playwright'))))",
    ],
    { encoding: 'utf8' }
  ).trim();
  const npxNodeModules = path.resolve(binDir, '..');
  cliPath = path.join(npxNodeModules, '@playwright/test/cli.js');
  const resolveBootstrap = pathToFileURL(path.join(import.meta.dirname, 'playwright-resolve.mjs')).href;
  env.PW_NODE_MODULES = npxNodeModules;
  env.NODE_PATH = [npxNodeModules, env.NODE_PATH].filter(Boolean).join(path.delimiter);
  env.NODE_OPTIONS = [env.NODE_OPTIONS, `--import=${resolveBootstrap}`].filter(Boolean).join(' ');
}

const result = spawnSync(process.execPath, [cliPath, ...args], { stdio: 'inherit', env });
process.exit(result.status ?? 1);
