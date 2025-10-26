#!/usr/bin/env node
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');

const { writeMarketingPreviewSnapshots } = require('../../apps/web/src/server/cms/preview');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');

for (const envPath of ['.env', 'apps/web/.env', 'apps-cms-payload/.env']) {
  dotenv.config({ path: path.join(ROOT, envPath), override: false });
}

const parseArgs = (argv) => {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [key, rawValue] = token.split('=');
    const name = key.replace(/^--/, '');
    if (rawValue !== undefined) {
      args[name] = rawValue;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[name] = next;
      i += 1;
    } else {
      args[name] = true;
    }
  }
  return args;
};

const args = parseArgs(process.argv);

const resolveMode = () => {
  const mode = typeof args.mode === 'string' ? args.mode.toLowerCase() : undefined;
  if (mode === 'published') return [false];
  if (mode === 'draft') return [true];
  if (Array.isArray(args.preview)) {
    return args.preview.map((value) => value === 'true');
  }
  if (typeof args.preview === 'string') {
    return [args.preview === 'true'];
  }
  if (args['published-only']) return [false];
  if (args['draft-only']) return [true];
  return [false, true];
};

const previewStates = resolveMode();

const includeRoutes = typeof args.routes === 'string' && args.routes.length
  ? args.routes.split(',').map((route) => route.trim()).filter(Boolean)
  : undefined;

const outFile = args.out
  ? path.resolve(process.cwd(), args.out)
  : path.resolve(ROOT, 'apps/web/src/server/cms/__fixtures__/marketing-preview-snapshots.json');

writeMarketingPreviewSnapshots({
  outFile,
  previewStates,
  collectOptions: { includeRoutes }
})
  .then((payload) => {
    const states = previewStates.map((state) => (state ? 'draft' : 'published')).join(', ');
    // eslint-disable-next-line no-console
    console.log(`✅ Generated marketing preview snapshots (${states}) -> ${outFile}`);
    // eslint-disable-next-line no-console
    console.log(`   Snapshot count: ${payload.snapshots.length}`);
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Failed to generate marketing preview snapshots');
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  });
