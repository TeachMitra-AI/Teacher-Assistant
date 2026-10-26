// Run: node --test .claude/hooks/guard-high-impact.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decide } from './guard-high-impact.mjs';

const HOOK = fileURLToPath(new URL('./guard-high-impact.mjs', import.meta.url));
const bash = (command, opts = {}) => decide({ tool_name: 'Bash', tool_input: { command }, cwd: opts.cwd || '/repo' }, opts);
const decision = (command, opts) => bash(command, opts)?.decision ?? 'none';
const onBranch = (b) => ({ getBranch: () => b });

test('routine development commands pass through with no decision', () => {
  for (const c of [
    'npm test',
    'npm run lint',
    'npm run build',
    'npm ci',
    'npx vitest run test/auth.test.js',
    'npx prisma generate',
    'git status --porcelain',
    'git diff main...HEAD',
    'git log --oneline -5',
    'git restore --staged README.md',
    'git checkout -b feature/x',
    'cat server/.env.example',
    'git check-ignore -v server/.env',
    'ls -la server/.env',
    'rm -rf client/dist',
    'rm -rf "C:\\Users\\me\\AppData\\Local\\Temp\\scratch\\out"',
    'gh pr view 12',
    'gh run view 123 --log-failed',
    'npm run attendance:clear-test-data -- --dry-run',
    'cd mobile && npm start',
    'ls server/.env*',
    'grep -rnE "secret" server/src client/src',
    'grep -n KEY server/src/index.js',
  ]) {
    assert.equal(decision(c, onBranch('feature/x')), 'none', c);
  }
});

test('reading or staging real secrets and DB files is denied', () => {
  for (const c of [
    'cat server/.env',
    'type server\\.env',
    'Get-Content client/.env.local',
    'grep GEMINI server/.env',
    'git add server/.env',
    'echo KEY=1 >> mobile/.env',
    'sqlite3 server/prisma/dev.db .tables',
    'cp server/prisma/dev.db.backup /tmp/x.db',
    'cat server/.env*',
  ]) {
    assert.equal(decision(c), 'deny', c);
  }
  const grep = (input) => decide({ tool_name: 'Grep', tool_input: { pattern: '.', ...input } })?.decision ?? 'none';
  assert.equal(grep({ path: 'server/.env' }), 'deny');
  assert.equal(grep({ path: 'server', glob: '.env*' }), 'deny');
  assert.equal(grep({ path: 'server', glob: '*.js' }), 'none');
  assert.equal(grep({ path: 'server/.env.example' }), 'none');
  assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: 'C:\\repo\\server\\.env' } })?.decision, 'deny');
  assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: '/repo/server/prisma/dev-RAJEEV.db' } })?.decision, 'deny');
  assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: '/repo/server/.env.example' } }), null);
  assert.equal(decide({ tool_name: 'Edit', tool_input: { file_path: '/repo/server/src/index.js' } }), null);
});

test('git push always asks; force-push to main is denied', () => {
  assert.equal(decision('git push origin feature/x', onBranch('feature/x')), 'ask');
  assert.equal(decision('git -C server push', onBranch('feature/x')), 'ask');
  assert.equal(decision('git push --force origin feature/x', onBranch('feature/x')), 'ask');
  assert.equal(decision('git push --force origin main', onBranch('feature/x')), 'deny');
  assert.equal(decision('git push origin +HEAD:main', onBranch('feature/x')), 'deny');
  assert.equal(decision('git push -f', onBranch('main')), 'deny');
});

test('commits ask only on main/master; --no-verify always asks', () => {
  assert.equal(decision('git commit -m "feat: x"', onBranch('feature/x')), 'none');
  assert.equal(decision('git commit -m "feat: x"', onBranch('main')), 'ask');
  assert.equal(decision('git commit --no-verify -m x', onBranch('feature/x')), 'ask');
  assert.equal(decision('git commit -m x', onBranch(null)), 'none');
});

test('history rewrites and work-discarding git commands ask', () => {
  for (const c of [
    'git merge main',
    'git rebase main',
    'git reset --hard HEAD~1',
    'git clean -fd',
    'git checkout -- .',
    'git restore .',
    'git stash drop',
    'git branch -D old',
    'git config core.hooksPath /dev/null',
  ]) {
    assert.equal(decision(c, onBranch('feature/x')), 'ask', c);
  }
});

test('database, dependency, deploy and GitHub write actions ask', () => {
  for (const c of [
    'npx prisma migrate dev --name add_x',
    'npx prisma migrate reset',
    'prisma db push --accept-data-loss',
    'npm run migrate',
    'npm run seed',
    'node src/seed.js',
    'npm run assistant:prune-events',
    'npm install lodash',
    'npm i -D vitest',
    'npm audit fix',
    'npm --prefix server install lodash',
    'npx --yes prisma migrate reset',
    'grep -rn GEMINI server',
    'grep -r KEY .',
    'railway up',
    'vercel --prod',
    'eas build -p android',
    'gh pr create --fill',
    'gh pr merge 12 --squash',
    'gh api -X POST repos/o/r/issues',
    'rm -rf server/src',
    'Remove-Item -Recurse -Force server\\src',
  ]) {
    assert.equal(decision(c, onBranch('feature/x')), 'ask', c);
  }
  assert.equal(decision('npm start', { cwd: '/repo/server', ...onBranch('feature/x') }), 'ask');
  assert.equal(decision('cd server && npm start', onBranch('feature/x')), 'ask');
});

test('publishing and catastrophic deletes are denied', () => {
  for (const c of ['npm publish', 'rm -rf /', 'rm -rf ~', 'rm -rf .', 'rm -rf .git', 'rm -rf server/prisma', 'Remove-Item -Recurse C:\\']) {
    assert.equal(decision(c), 'deny', c);
  }
});

test('the strongest decision wins across chained commands', () => {
  assert.equal(decision('npm test && git push', onBranch('feature/x')), 'ask');
  assert.equal(decision('git push; cat server/.env', onBranch('feature/x')), 'deny');
  assert.equal(decision('FOO=1 git push', onBranch('feature/x')), 'ask');
});

test('CLI prints a PreToolUse decision, and fails open on bad input', () => {
  const run = (input) => spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' });

  const denied = run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'cat server/.env' }, cwd: '.' }));
  assert.equal(denied.status, 0);
  const out = JSON.parse(denied.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /agent-safety\.md/);

  const allowed = run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm test' }, cwd: '.' }));
  assert.equal(allowed.status, 0);
  assert.equal(allowed.stdout, '');

  const garbage = run('not json');
  assert.equal(garbage.status, 0);
  assert.equal(garbage.stdout, '');
});
