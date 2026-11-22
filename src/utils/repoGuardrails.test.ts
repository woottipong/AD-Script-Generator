import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

function walkFiles(dir: string, predicate: (filePath: string) => boolean): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git' || entry.name === '.data') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, predicate));
    } else if (predicate(full)) {
      results.push(full);
    }
  }
  return results;
}

test('node:sqlite is imported only by jobStore and its test', () => {
  const allowed = new Set([
    path.join(REPO_ROOT, 'src/utils/jobStore.ts'),
    path.join(REPO_ROOT, 'src/utils/jobStore.test.ts'),
  ]);
  const tsFiles = [
    path.join(REPO_ROOT, 'server.ts'),
    ...walkFiles(path.join(REPO_ROOT, 'src'), (f) => f.endsWith('.ts') || f.endsWith('.tsx')),
  ];
  const importPattern = /\b(?:from\s+|import\s+|require\s*\(\s*)['"]node:sqlite['"]/;
  const violations: string[] = [];
  for (const file of tsFiles) {
    if (allowed.has(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (importPattern.test(content)) {
      violations.push(path.relative(REPO_ROOT, file));
    }
  }
  assert.deepEqual(violations, [], `Route/app code must go through jobStore instead of importing node:sqlite directly: ${violations.join(', ')}`);
});

test('server.ts never sends raw HTTP 403/502/503/504 status codes', () => {
  const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'server.ts'), 'utf8');
  const matches = [...serverSrc.matchAll(/\.status\(\s*(403|502|503|504)\s*\)/g)].map((m) => m[0]);
  assert.deepEqual(
    matches,
    [],
    `API error paths must use sanitizeApiStatusCode instead of raw ${matches.join(', ')}`
  );
});

test('all /api/* route handlers in server.ts are registered after the auth gate', () => {
  const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'server.ts'), 'utf8');
  const authGateIdx = serverSrc.indexOf("code: 'UNAUTHENTICATED'");
  assert.ok(authGateIdx > 0, 'Expected /api auth gate returning UNAUTHENTICATED in server.ts');

  const routeRegex = /app\.(get|post|put|patch|delete)\(\s*['"](\/api\/[^'"]+)['"]/g;
  const beforeGate: string[] = [];
  for (const match of serverSrc.matchAll(routeRegex)) {
    if ((match.index ?? 0) < authGateIdx) {
      beforeGate.push(`${match[1].toUpperCase()} ${match[2]}`);
    }
  }
  assert.deepEqual(
    beforeGate,
    [],
    `Found /api routes registered before the auth gate: ${beforeGate.join(', ')}`
  );
});

test('all relative markdown file links in repository docs resolve to existing files', () => {
  const docFiles = [
    ...['AGENTS.md', 'CODING_STANDARDS.md', 'README.md', 'PRODUCT.md', 'GLOSSARY.md', 'DESIGN.md']
      .map((f) => path.join(REPO_ROOT, f))
      .filter((f) => fs.existsSync(f)),
    ...walkFiles(path.join(REPO_ROOT, 'docs'), (f) => f.endsWith('.md')),
  ];

  const broken: string[] = [];
  const linkRegex = /\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/g;

  for (const file of docFiles) {
    const content = fs.readFileSync(file, 'utf8');
    // Strip fenced code blocks so code examples are not checked as markdown links.
    const withoutCodeBlocks = content.replace(/```[\s\S]*?```/g, '');
    for (const match of withoutCodeBlocks.matchAll(linkRegex)) {
      const target = match[1].trim();
      if (!target || target.startsWith('http://') || target.startsWith('https://') || target.startsWith('mailto:')) {
        continue;
      }
      const resolved = path.resolve(path.dirname(file), target);
      if (!fs.existsSync(resolved)) {
        broken.push(`${path.relative(REPO_ROOT, file)} -> ${target}`);
      }
    }
  }

  assert.deepEqual(broken, [], `Broken relative markdown links:\n${broken.join('\n')}`);
});

test('vite.config.ts retains Vite defaults and blocks .data in server.fs.deny', async () => {
  const mod = await import('../../vite.config');
  const exported = mod.default;
  const config = typeof exported === 'function'
    ? await exported({ mode: 'development', command: 'serve' })
    : await exported;
  const deny = config.server?.fs?.deny ?? [];
  assert.ok(deny.includes('.env'), 'server.fs.deny should retain .env');
  assert.ok(deny.includes('**/.git/**'), 'server.fs.deny should retain **/.git/**');
  assert.ok(deny.some((entry) => entry.includes('.data')), 'server.fs.deny should block .data');
});
