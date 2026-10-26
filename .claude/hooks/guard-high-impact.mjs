#!/usr/bin/env node
// Claude Code PreToolUse hook: a backstop for .claude/rules/agent-safety.md.
//
// Reads the hook payload on stdin and prints a permission decision:
//   "deny" - actions an agent never needs (reading real secrets, force-pushing main, publishing).
//   "ask"  - legitimate but high-impact actions, so a human confirms each occurrence.
//   (no output) - normal permission flow.
// It fails open: a crash or unparsable payload prints nothing, so a bug here can't block work. It is defence in
// depth, not the control. The control is the user's confirmation that agent-safety.md requires. No dependencies,
// no network, and the only process it spawns is `git rev-parse` for the current branch.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROTECTED_BRANCHES = new Set(['main', 'master']);
// Also matches wildcards (`server/.env*`, a Grep glob of `*.env`), which the shell or ripgrep expands to the real file.
const ENV_FILE = /(^|[\\/*])\.env([.*?][\w.*?-]*)?$/i;
const ENV_TEMPLATE = /\.(example|sample|template)$/i;
const DB_FILE = /(^|[\\/])prisma[\\/][^\\/]*\.db([.-][\w.-]*)?$/i;
// Recursive deletes of these are routine build/temp cleanup and don't need a prompt.
const DISPOSABLE = /(^|[\\/])(dist|coverage|\.vite|\.tmp[\w.-]*|node_modules[\\/]\.cache)[\\/]?$|^(\/tmp|\$TEMP|\$env:TEMP)|[\\/]AppData[\\/]Local[\\/]Temp[\\/]/i;
const CATASTROPHIC = /^(\/|~|\.|\.\.|\*|\.git|[a-z]:[\\/]?|\$HOME|\$env:USERPROFILE|server[\\/]prisma)[\\/]?$/i;
// Directories that hold a git-ignored .env. Plain `grep -r` ignores .gitignore, so searching one prints the secrets.
const ENV_HOLDING_DIR = /(^|[\\/])(\.|\.\.|\*|server|client|mobile)[\\/]?$/i;

export function isSecretPath(p) {
  if (!p) return false;
  const s = String(p).replace(/^["']|["']$/g, '');
  return (ENV_FILE.test(s) && !ENV_TEMPLATE.test(s)) || DB_FILE.test(s);
}

// Split a command line into segments on ; && || | and newlines, honouring single and double quotes, and tokenize
// each segment. Good enough for policy matching, and deliberately not a full shell parser.
export function segments(command) {
  const out = [];
  let tokens = [];
  let cur = '';
  let quote = null;
  const pushToken = () => {
    if (cur) tokens.push(cur);
    cur = '';
  };
  const pushSegment = () => {
    pushToken();
    if (tokens.length) out.push(tokens);
    tokens = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ';' || c === '\n' || c === '|' || c === '&') {
      if ((c === '|' || c === '&') && command[i + 1] === c) i++;
      pushSegment();
    } else if (/\s/.test(c)) {
      pushToken();
    } else {
      cur += c;
    }
  }
  pushSegment();
  // Drop leading VAR=value assignments so `FOO=1 git push` is still seen as git.
  return out.map((t) => {
    let i = 0;
    while (i < t.length - 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i])) i++;
    return t.slice(i);
  });
}

const has = (tokens, ...flags) => tokens.some((t) => flags.includes(t));
const hasShortFlag = (tokens, letter) => tokens.some((t) => /^-[a-zA-Z]+$/.test(t) && t.includes(letter));

// Locate the git subcommand, skipping global options and their values (`git -C server push`, `git -c k=v commit`).
function gitSubcommand(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-C' || args[i] === '-c') i++;
    else if (!args[i].startsWith('-')) return { sub: args[i], rest: args.slice(i + 1), dirArg: args[args.indexOf('-C') + 1] };
  }
  return { sub: undefined, rest: [] };
}

const GIT_METADATA_ONLY = new Set(['check-ignore', 'ls-files', 'status']);

function gitDecision(args, branch) {
  const { sub, rest } = gitSubcommand(args);
  if (has(args, '--no-verify')) return ask('skips git hooks (gitleaks pre-commit)');
  switch (sub) {
    case 'push': {
      const force = has(rest, '--force', '--force-with-lease', '-f') || rest.some((a) => a.startsWith('+'));
      const targetsProtected = rest.some((a) => PROTECTED_BRANCHES.has(a.replace(/^\+/, '').split(':').pop()));
      if (force && (targetsProtected || PROTECTED_BRANCHES.has(branch))) return deny('force-push to main/master');
      return ask(force ? 'force-push rewrites remote history' : 'git push publishes commits');
    }
    case 'commit':
      if (branch && PROTECTED_BRANCHES.has(branch)) return ask(`commit directly on ${branch} (CLAUDE.md §5: use a feature branch)`);
      return null;
    case 'merge':
    case 'rebase':
    case 'filter-branch':
    case 'filter-repo':
      return ask(`git ${sub} rewrites or combines history`);
    case 'reset':
      return has(rest, '--hard', '--merge', '--keep') ? ask('git reset discards work') : null;
    case 'clean':
      return rest.some((a) => /^-[a-zA-Z]*f/.test(a) || a === '--force') ? ask('git clean deletes untracked files') : null;
    case 'checkout':
      return has(rest, '--', '.') ? ask('git checkout can discard local changes') : null;
    case 'restore':
      return has(rest, '--staged') && !has(rest, '--worktree', '-W') ? null : ask('git restore discards local changes');
    case 'stash':
      return has(rest, 'drop', 'clear') ? ask(`git stash ${rest[0]} deletes stashed work`) : null;
    case 'branch':
      return has(rest, '-D', '--delete', '-d') ? ask('deletes a branch') : null;
    case 'config':
      return rest.some((a) => /hookspath/i.test(a)) ? ask('changes the git hooks path') : null;
    default:
      return null;
  }
}

function ghDecision(args) {
  const [group, action] = args;
  if (group === 'pr' && ['create', 'merge', 'close', 'comment', 'review', 'edit', 'ready'].includes(action)) return ask(`gh pr ${action} acts on GitHub`);
  if (group === 'release' || group === 'repo' || group === 'secret' || group === 'variable') return ask(`gh ${group} acts on GitHub`);
  if (group === 'workflow' && action === 'run') return ask('starts a GitHub Actions workflow');
  if (group === 'run' && ['rerun', 'cancel', 'delete'].includes(action)) return ask(`gh run ${action} acts on GitHub`);
  if (group === 'issue' && ['create', 'close', 'comment', 'edit', 'delete'].includes(action)) return ask(`gh issue ${action} acts on GitHub`);
  if (group === 'api' && args.some((a, i) => (a === '-X' || a === '--method') && args[i + 1] && args[i + 1].toUpperCase() !== 'GET')) return ask('gh api write call');
  return null;
}

function prismaDecision(args) {
  const [group, action] = args;
  if (group === 'migrate' && ['dev', 'reset', 'deploy', 'resolve'].includes(action)) return ask(`prisma migrate ${action} changes a database`);
  if (group === 'db' && ['push', 'execute', 'seed'].includes(action)) return ask(`prisma db ${action} changes a database`);
  return null;
}

function npmDecision(tool, args, dir) {
  // Skip leading global options so `npm --prefix server install x` is still seen as an install.
  const first = args.findIndex((a, i) => !a.startsWith('-') && args[i - 1] !== '--prefix');
  const [sub, script] = first < 0 ? [] : args.slice(first);
  if (sub === 'publish') return deny(`${tool} publish`);
  if (['install', 'i', 'add', 'remove', 'uninstall', 'rm', 'update', 'upgrade', 'up'].includes(sub)) return ask(`${tool} ${sub} changes dependencies`);
  if (sub === 'audit' && script === 'fix') return ask('npm audit fix changes dependencies');
  const run = sub === 'run' || sub === 'run-script' ? script : sub;
  const inServer =
    path.basename(dir || '') === 'server' || (has(args, '--prefix') && args.some((a) => /(^|[\\/])server$/.test(a)));
  if (run === 'start' && inServer) return ask('server `npm start` runs `prisma migrate deploy` first');
  if (run === 'migrate' || run === 'seed') return ask(`npm run ${run} changes a database`);
  if ((run === 'assistant:prune-events' || run === 'attendance:clear-test-data') && !has(args, '--dry-run')) return ask(`${run} deletes data (add --dry-run to preview)`);
  return null;
}

function deleteDecision(targets) {
  const real = targets.filter((t) => !t.startsWith('-'));
  if (real.some((t) => CATASTROPHIC.test(t))) return deny(`recursive delete of ${real.find((t) => CATASTROPHIC.test(t))}`);
  if (real.length && real.every((t) => DISPOSABLE.test(t))) return null;
  return ask('recursive delete');
}

export function decideCommand(command, { cwd, getBranch = () => null } = {}) {
  let dir = cwd;
  const results = [];
  for (const tokens of segments(command || '')) {
    const [cmd0, ...args] = tokens;
    const cmd = (cmd0 || '').toLowerCase().replace(/\.exe$/, '');
    if (cmd === 'cd' || cmd === 'set-location' || cmd === 'pushd') {
      if (args[0]) dir = path.resolve(dir || '.', args[0]);
      continue;
    }
    // Secrets: any command that names a real .env file or a Prisma DB file, except checks that read only metadata
    // (existence, ignore status), never contents.
    const metadataOnly =
      ['ls', 'test', '[', 'dir', 'test-path'].includes(cmd) || (cmd === 'git' && GIT_METADATA_ONLY.has(gitSubcommand(args).sub));
    if (!metadataOnly && args.some(isSecretPath)) {
      results.push(deny('reads or writes a real .env or database file; use .env.example instead'));
      continue;
    }
    let r = null;
    if (cmd === 'git') {
      const { dirArg } = gitSubcommand(args);
      r = gitDecision(args, getBranch(args.includes('-C') && dirArg ? path.resolve(dir || '.', dirArg) : dir));
    } else if (cmd === 'gh') r = ghDecision(args);
    else if (cmd === 'prisma') r = prismaDecision(args);
    else if ((cmd === 'npx' || cmd === 'pnpx') && args.find((a) => !a.startsWith('-')) === 'prisma') r = prismaDecision(args.slice(args.indexOf('prisma') + 1));
    else if (['npm', 'pnpm', 'yarn'].includes(cmd)) r = npmDecision(cmd, args, dir);
    else if (cmd === 'grep' && (hasShortFlag(args, 'r') || hasShortFlag(args, 'R') || has(args, '--recursive', '--dereference-recursive'))) {
      const targets = args.filter((a) => !a.startsWith('-')).slice(1); // the first non-flag argument is the pattern
      if (targets.length === 0 || targets.some((t) => ENV_HOLDING_DIR.test(t))) r = ask('recursive grep reads git-ignored .env files; use the Grep tool or `git grep`');
    }
    else if (cmd === 'node' && args.some((a) => /(^|[\\/])seed\.js$/.test(a))) r = ask('seed script changes a database');
    else if (cmd === 'rm' && (hasShortFlag(args, 'r') || hasShortFlag(args, 'R') || has(args, '--recursive'))) r = deleteDecision(args);
    else if ((cmd === 'remove-item' || cmd === 'ri' || cmd === 'rmdir' || cmd === 'rd') && args.some((a) => /^-r(ecurse)?$/i.test(a) || /^\/s$/i.test(a))) r = deleteDecision(args);
    else if (cmd === 'railway' && ['up', 'deploy', 'redeploy', 'down', 'variables'].includes(args[0])) r = ask(`railway ${args[0]} affects a deployed service`);
    else if (cmd === 'vercel' && !['whoami', 'ls', 'list', 'logs', 'inspect', 'help', '--version'].includes(args[0])) r = ask('vercel deploys or changes a project');
    else if ((cmd === 'eas' && ['build', 'submit', 'update'].includes(args[0])) || (cmd === 'expo' && args[0] === 'publish')) r = ask('publishes a mobile build or update');
    if (r) results.push(r);
  }
  return strongest(results);
}

export function decideFile(toolName, filePath) {
  if (isSecretPath(filePath)) return deny(`${toolName} on a real .env or database file; use .env.example instead`);
  return null;
}

export function decide(payload, opts = {}) {
  const { tool_name: tool, tool_input: input = {}, cwd } = payload || {};
  if (tool === 'Bash' || tool === 'PowerShell') return decideCommand(input.command, { cwd, ...opts });
  if (['Read', 'Edit', 'Write', 'NotebookEdit'].includes(tool)) return decideFile(tool, input.file_path || input.notebook_path);
  // Grep skips git-ignored files, except when its path names the file or its glob selects it.
  if (tool === 'Grep') return decideFile(tool, input.path) || decideFile(tool, input.glob);
  return null;
}

function ask(reason) {
  return { decision: 'ask', reason };
}
function deny(reason) {
  return { decision: 'deny', reason };
}
function strongest(results) {
  return results.find((r) => r.decision === 'deny') || results.find((r) => r.decision === 'ask') || null;
}

function currentBranch(dir) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: dir || process.cwd(),
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return; // Fail open: no decision, normal permission flow.
  }
  const result = decide(payload, { getBranch: currentBranch });
  if (!result) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: result.decision,
        permissionDecisionReason: `SarasTech guard (.claude/rules/agent-safety.md): ${result.reason}.`,
      },
    })
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {}); // Fail open on any unexpected error.
}
