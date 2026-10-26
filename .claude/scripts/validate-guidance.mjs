#!/usr/bin/env node
// Validates the AI guidance files against the repository: skills, rules, settings, and the instruction files.
// Read-only, no dependencies, no network. Run from the repo root:  node .claude/scripts/validate-guidance.mjs
// Exits 1 if any ERROR is found. WARN lines are advisory.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const problems = [];
const error = (file, msg) => problems.push({ level: 'ERROR', file, msg });
const warn = (file, msg) => problems.push({ level: 'WARN', file, msg });
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

// Claude Code skill frontmatter keys (code.claude.com/docs/en/skills). Claude Code ignores any other key silently.
const SKILL_KEYS = new Set([
  'name', 'description', 'when_to_use', 'argument-hint', 'arguments', 'disable-model-invocation', 'user-invocable',
  'allowed-tools', 'disallowed-tools', 'model', 'effort', 'context', 'agent', 'background', 'hooks', 'paths', 'shell',
  'metadata', 'license', 'compatibility',
]);
// Built-in Claude Code skills/commands that a same-named project skill would shadow.
const BUILT_IN_NAMES = new Set([
  'code-review', 'security-review', 'review', 'simplify', 'init', 'loop', 'schedule', 'run', 'help', 'clear',
  'compact', 'config', 'memory', 'agents', 'hooks', 'permissions', 'doctor',
]);
const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z_-]{30,}/, /\bsk-[A-Za-z0-9]{20,}/, /\bghp_[A-Za-z0-9]{20,}/, /xkeysib-[a-f0-9]{20,}/,
  /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];
// Repo-relative paths cited in backticks are checked only under these roots.
const PATH_ROOTS = /^(server|client|mobile|docs|\.claude|\.github|\.githooks)\//;

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

// Minimal frontmatter reader: top-level `key: value` pairs and `key:` followed by `  - item` lists.
function frontmatter(file, text) {
  if (!text.startsWith('---\n')) return { present: false };
  const end = text.indexOf('\n---', 4);
  if (end === -1) {
    error(file, 'frontmatter opens with --- but never closes');
    return { present: true, data: {} };
  }
  const data = {};
  let listKey = null;
  for (const line of text.slice(4, end).split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      data[listKey].push(unquote(item[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) {
      error(file, `unparsable frontmatter line: ${line}`);
      continue;
    }
    const [, key, value] = kv;
    if (value === '') {
      data[key] = [];
      listKey = key;
    } else {
      data[key] = unquote(value);
      listKey = null;
    }
  }
  return { present: true, data, body: text.slice(end + 4) };
}

function unquote(v) {
  const s = v.trim();
  return /^(["']).*\1$/.test(s) ? s.slice(1, -1) : s;
}

function trackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return out.split('\n').filter(Boolean);
  } catch {
    warn('.', 'git ls-files failed; skipping glob checks');
    return null;
  }
}

function checkCitedPaths(file, text) {
  const body = text.replace(/```[\s\S]*?```/g, ''); // paths inside code blocks are examples, not citations
  for (const m of body.matchAll(/`([^`\s]+)`/g)) {
    let p = m[1].replace(/[),.;:]+$/, '');
    // .claude/work/ holds runtime handoffs that the skills create, so they need not exist yet.
    if (!PATH_ROOTS.test(p) || /[<>*{}$|]/.test(p) || p.startsWith('.claude/work/')) continue;
    p = p.replace(/#.*$/, '').replace(/:\d+(-\d+)?$/, '');
    if (!fs.existsSync(path.join(ROOT, p))) error(file, `cites \`${p}\`, which does not exist`);
  }
}

function checkSecrets(file, text) {
  for (const re of SECRET_PATTERNS) if (re.test(text)) error(file, `matches secret pattern ${re}`);
}

function checkSkills(files) {
  const dir = path.join(ROOT, '.claude', 'skills');
  if (!fs.existsSync(dir)) return error('.claude/skills', 'directory missing');
  const names = new Map();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, 'SKILL.md');
    const shown = rel(file);
    if (!fs.existsSync(file)) {
      error(shown, 'skill directory has no SKILL.md');
      continue;
    }
    const text = read(file);
    const fm = frontmatter(shown, text);
    if (!fm.present) {
      error(shown, 'frontmatter must start on line 1 with ---');
      continue;
    }
    const { data } = fm;
    for (const key of Object.keys(data)) if (!SKILL_KEYS.has(key)) warn(shown, `unknown frontmatter key "${key}" (ignored by Claude Code)`);
    if (!data.name) error(shown, 'missing name (SarasTech convention: always set it, equal to the folder)');
    else {
      if (data.name !== entry.name) error(shown, `name "${data.name}" must match folder "${entry.name}" so /${entry.name} and the folder agree`);
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(data.name)) error(shown, 'name must be lowercase letters, digits, and hyphens');
      if (BUILT_IN_NAMES.has(data.name)) error(shown, `name "${data.name}" would shadow a built-in Claude Code skill/command`);
      if (names.has(data.name)) error(shown, `duplicate skill name, also in ${names.get(data.name)}`);
      names.set(data.name, shown);
    }
    if (!data.description) error(shown, 'missing description');
    else if ((data.description + (data.when_to_use || '')).length > 1536) error(shown, 'description + when_to_use exceeds 1536 chars');
    for (const key of ['disable-model-invocation', 'user-invocable', 'background']) {
      if (key in data && !/^(true|false|yes|no|on|off|1|0)$/i.test(data[key])) error(shown, `${key} must be boolean`);
    }
    const lines = text.split('\n').length;
    if (lines > 500) warn(shown, `${lines} lines; keep SKILL.md under 500`);
    checkCitedPaths(shown, text);
    checkSecrets(shown, text);
  }
  if (names.size === 0) error('.claude/skills', 'no skills found');
}

function checkRules(files) {
  const dir = path.join(ROOT, '.claude', 'rules');
  if (!fs.existsSync(dir)) return error('.claude/rules', 'directory missing');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const file of walk(dir).filter((f) => f.endsWith('.md'))) {
    const shown = rel(file);
    const text = read(file);
    const fm = frontmatter(shown, text);
    if (fm.present) {
      for (const key of Object.keys(fm.data)) if (key !== 'paths') error(shown, `rules support only "paths"; "${key}" is ignored`);
      const globs = Array.isArray(fm.data.paths) ? fm.data.paths : String(fm.data.paths || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (globs.length === 0) error(shown, 'paths frontmatter is empty');
      if (files && typeof path.matchesGlob === 'function') {
        for (const g of globs) if (!files.some((f) => path.matchesGlob(f, g))) error(shown, `paths glob "${g}" matches no file in the repo`);
      } else if (files) {
        warn(shown, 'this Node version has no path.matchesGlob; glob coverage not checked');
      }
    }
    checkCitedPaths(shown, text);
    checkSecrets(shown, text);
  }
}

function checkSettings() {
  const file = path.join(ROOT, '.claude', 'settings.json');
  if (!fs.existsSync(file)) return warn('.claude/settings.json', 'not found; the high-impact guard hook is not registered');
  let json;
  try {
    json = JSON.parse(read(file));
  } catch (e) {
    return error('.claude/settings.json', `invalid JSON: ${e.message}`);
  }
  for (const group of json.hooks?.PreToolUse || []) {
    for (const h of group.hooks || []) {
      for (const arg of [h.command, ...(h.args || [])]) {
        const m = String(arg).match(/\$\{?CLAUDE_PROJECT_DIR\}?\/(.+)$/);
        if (m && !fs.existsSync(path.join(ROOT, m[1]))) error('.claude/settings.json', `hook script ${m[1]} does not exist`);
      }
    }
  }
}

function checkInstructionFiles() {
  for (const f of ['CLAUDE.md', 'AGENTS.md', 'mobile/AGENTS.md']) {
    const file = path.join(ROOT, f);
    if (!fs.existsSync(file)) {
      warn(f, 'not found');
      continue;
    }
    const text = read(file);
    checkCitedPaths(f, text);
    checkSecrets(f, text);
    if (f === 'CLAUDE.md' && text.split('\n').length > 200) warn(f, 'over 200 lines; adherence drops');
  }
}

const files = trackedFiles();
checkSkills(files);
checkRules(files);
checkSettings();
checkInstructionFiles();

for (const p of problems) console.log(`${p.level.padEnd(5)} ${p.file}: ${p.msg}`);
const errors = problems.filter((p) => p.level === 'ERROR').length;
console.log(`\n${errors} error(s), ${problems.length - errors} warning(s).`);
process.exit(errors ? 1 : 0);
