#!/usr/bin/env node
import dotenv from 'dotenv';
import { spawn } from 'node:child_process';

// Load env from root and web to pick up SANITY_* vars locally
for (const path of ['.env', 'apps/web/.env', 'apps/cms/.env']) {
  dotenv.config({ path, override: false });
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const part = argv[i];
    if (part.startsWith('--')) {
      const [key, value] = part.split('=');
      const name = key.replace(/^--/, '');
      if (typeof value === 'string' && value.length > 0) {
        args[name] = value;
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[name] = argv[++i];
      } else {
        args[name] = true;
      }
    }
  }
  return args;
}

async function ensureDataset({ projectId, dataset, visibility = 'public', token }) {
  if (!projectId) throw new Error('Missing projectId');
  if (!dataset) throw new Error('Missing dataset');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };

  // Check existing datasets
  const listRes = await fetch(`https://api.sanity.io/v1/projects/${projectId}/datasets`, {
    headers
  });
  if (!listRes.ok) {
    const body = await listRes.text();
    throw new Error(`Failed to list datasets (${listRes.status}): ${body}`);
  }
  const listJson = await listRes.json();
  const exists = Array.isArray(listJson) && listJson.some((d) => d?.name === dataset);
  if (exists) {
    console.log(`Dataset '${dataset}' already exists in project '${projectId}'.`);
    return;
  }

  // Create dataset
  const createRes = await fetch(
    `https://api.sanity.io/v1/projects/${projectId}/datasets/${dataset}`,
    {
      method: 'PUT',
      headers,
      body: JSON.stringify({ aclMode: visibility === 'private' ? 'private' : 'public' })
    }
  );
  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`Failed to create dataset '${dataset}' (${createRes.status}): ${body}`);
  }
  console.log(`Created dataset '${dataset}' in project '${projectId}' with visibility '${visibility}'.`);
}

function runCliFallback({ projectId, dataset, visibility }) {
  return new Promise((resolve, reject) => {
    const args = ['--filter', '@smplat/cms', 'exec', 'sanity', 'dataset', 'create', dataset, '--visibility', visibility];
    if (projectId) {
      args.push('--project', projectId);
    }
    const child = spawn('pnpm', args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env
      }
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`CLI exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

(async () => {
  try {
    const args = parseArgs(process.argv);
    const projectId = args.project || process.env.SANITY_PROJECT_ID || 'smplat';
    const dataset = args.dataset || process.env.SANITY_DATASET;
    const visibility = (args.visibility || process.env.SANITY_DATASET_VISIBILITY || 'public').toLowerCase();
    const token = args.token || process.env.SANITY_MANAGEMENT_TOKEN || process.env.SANITY_AUTH_TOKEN;

    if (!dataset) {
      console.error('Usage: node ensure-sanity-dataset.mjs --dataset <name> [--project <id>] [--visibility public|private] [--token <mgmtToken>]');
      process.exit(2);
    }

    if (token) {
      await ensureDataset({ projectId, dataset, visibility, token });
      process.exit(0);
    }

    console.warn('No SANITY_MANAGEMENT_TOKEN provided, attempting CLI fallback (requires prior login or SANITY_AUTH_TOKEN)...');
    await runCliFallback({ projectId, dataset, visibility });
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();


