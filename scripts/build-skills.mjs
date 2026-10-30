// Build-time generator: packages the canonical agent-voice skill as a
// dependency-free exported string. No runtime filesystem access.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const skillPath = join(root, "skills", "agent-voice", "SKILL.md");
const outPath = join(root, "src", "agent-voice.generated.ts");

function fail(message) {
  console.error(`build-skills: ${message} (${skillPath})`);
  process.exit(1);
}

let raw;
try {
  raw = readFileSync(skillPath, "utf8");
} catch {
  fail("canonical skill not found");
}

const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
if (!match) fail("missing or malformed YAML frontmatter (expected --- blocks)");
const [, frontmatter, bodyRaw] = match;

const name = frontmatter.match(/^name:\s*(.+?)\s*$/m)?.[1];
if (!name) fail("frontmatter is missing required field: name");
if (name !== "agent-voice") fail(`unexpected skill name: ${JSON.stringify(name)}`);
const description = frontmatter.match(/^description:\s*(.+?)\s*$/m)?.[1];
if (!description) fail("frontmatter is missing required field: description");

const body = bodyRaw.trim();
if (!body) fail("skill body is empty after frontmatter");

const output =
  `// Generated from skills/agent-voice/SKILL.md. Do not edit manually.\n` +
  `// Rebuild with: node scripts/build-skills.mjs\n` +
  `export const AGENT_VOICE_INSTRUCTIONS: string = ${JSON.stringify(body)};\n`;

const previous = (() => {
  try {
    return readFileSync(outPath, "utf8");
  } catch {
    return undefined;
  }
})();
if (previous !== output) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, output);
}
