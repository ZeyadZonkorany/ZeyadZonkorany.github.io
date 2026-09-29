import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const prepareOnly = args.includes('--prepare-only');
if (args.some((arg) => arg !== '--prepare-only')) {
  console.error('Usage: npm run publish [-- --prepare-only]');
  process.exit(1);
}

function run(command, arguments_, cwd = root) {
  execFileSync(command, arguments_, { cwd, stdio: 'inherit' });
}

let worktree;
let worktreeAdded = false;
try {
  // Fetch first so a normal, non-forced push cannot replace another publisher’s work.
  if (!prepareOnly) run('git', ['fetch', 'origin', 'gh-pages']);
  run('npm', ['run', 'check']);
  run('npm', ['run', 'build']);

  worktree = await mkdtemp(path.join(tmpdir(), 'zonkor-publish-'));
  run('git', ['worktree', 'add', '--detach', worktree, 'origin/gh-pages']);
  worktreeAdded = true;
  // This directory is our temporary checkout of generated website files.
  for (const entry of await readdir(worktree)) {
    if (entry !== '.git') await rm(path.join(worktree, entry), { recursive: true, force: true });
  }
  await cp(path.join(root, 'dist'), worktree, { recursive: true });
  await writeFile(path.join(worktree, '.nojekyll'), '');
  run('git', ['add', '--all'], worktree);
  const changes = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: worktree, encoding: 'utf8' }).trim();

  if (prepareOnly) {
    console.log('Website prepared and validated. The built files are in dist/. No push was made.');
  } else if (!changes) {
    console.log('The published files already match this build.');
  } else {
    run('git', ['commit', '-m', `Publish journal ${new Date().toISOString().slice(0, 10)}`], worktree);
    run('git', ['push', 'origin', 'HEAD:refs/heads/gh-pages'], worktree);
    console.log('Built website pushed to gh-pages. GitHub Pages must be configured to publish from that branch.');
  }
} catch (error) {
  console.error('Publishing stopped. The source articles remain in your main checkout.');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (worktreeAdded) {
    try {
      run('git', ['worktree', 'remove', '--force', worktree]);
    } catch {
      console.error(`Temporary publishing checkout remains at ${worktree}.`);
    }
  } else if (worktree) {
    await rm(worktree, { recursive: true, force: true });
  }
}
