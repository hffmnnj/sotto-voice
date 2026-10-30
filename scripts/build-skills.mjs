// Build-time generator: packages canonical skills as dependency-free
// exported strings. No runtime filesystem access.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const skills = [
  {
    name: "agent-voice",
    skillPath: join(root, "skills", "agent-voice", "SKILL.md"),
    outPath: join(root, "src", "agent-voice.generated.ts"),
    exportName: "AGENT_VOICE_INSTRUCTIONS",
  },
  {
    name: "turn-injection",
    skillPath: join(root, "skills", "turn-injection", "SKILL.md"),
    outPath: join(root, "src", "turn-injection.generated.ts"),
    exportName: "TURN_INJECTION_INSTRUCTIONS",
  },
];

function fail(skillPath, message) {
  console.error(`build-skills: ${message} (${skillPath})`);
  process.exit(1);
}

for (const skill of skills) {
  let raw;
  try {
    raw = readFileSync(skill.skillPath, "utf8");
  } catch {
    fail(skill.skillPath, "canonical skill not found");
  }

  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) fail(skill.skillPath, "missing or malformed YAML frontmatter (expected --- blocks)");
  const [, frontmatter, bodyRaw] = match;

  const name = frontmatter.match(/^name:\s*(.+?)\s*$/m)?.[1];
  if (!name) fail(skill.skillPath, "frontmatter is missing required field: name");
  if (name !== skill.name)
    fail(skill.skillPath, `unexpected skill name: ${JSON.stringify(name)}`);
  const description = frontmatter.match(/^description:\s*(.+?)\s*$/m)?.[1];
  if (!description)
    fail(skill.skillPath, "frontmatter is missing required field: description");

  const body = bodyRaw.trim();
  if (!body) fail(skill.skillPath, "skill body is empty after frontmatter");

  const output =
    `// Generated from skills/${skill.name}/SKILL.md. Do not edit manually.\n` +
    `// Rebuild with: node scripts/build-skills.mjs\n` +
    `export const ${skill.exportName}: string = ${JSON.stringify(body)};\n`;

  const previous = (() => {
    try {
      return readFileSync(skill.outPath, "utf8");
    } catch {
      return undefined;
    }
  })();
  if (previous !== output) {
    mkdirSync(dirname(skill.outPath), { recursive: true });
    writeFileSync(skill.outPath, output);
  }
}
