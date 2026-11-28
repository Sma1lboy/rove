/**
 * Guard: editing the agent skill's CONTENT must bump its version marker.
 *
 * Staleness (`lib/skill-install.ts`) compares marker numbers only
 * (`best.version < ROVE_SKILL_VERSION`) — it never looks at what the file
 * says. So a content edit that skips the bump ships silently: every machine
 * that installed the previous version keeps the old text, and
 * `rove skill status` reports ✓ current. That happened four times in a row
 * (#868, #869, #959, #970 all edited SKILL.md at v42), leaving installed
 * skills teaching a `send`/deferred flow that #959 had already deleted.
 *
 * The rule lived only in a comment. This pins it: the fingerprint below
 * records the skill files' hashes AND the version they belong to, and both
 * halves have to move together.
 */

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { ROVE_SKILL_VERSION } from "@sma1lboy/rove-core/lib/skill-install.ts"
import { describe, expect, test } from "vitest"

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
/** The canonical skill source. `claude-plugin/skills/rove` is a byte-identical
 *  copy, held there by `claude-plugin.test.ts` — hashing one covers both. */
const SKILL_DIR = join(ROOT, ".agents", "skills", "rove")

/**
 * sha256 of every file in the skill, as of {@link ROVE_SKILL_VERSION}.
 * Regenerate with the command the failure message prints.
 */
const FINGERPRINT = {
  version: 141,
  sha256: {
    "SKILL.md": "30ea8e8fd1e99152ed666a9f338bba53552db32e788c81e86c4343eadefa3c76",
    "references/api-flags.md": "1146ed36f62ccf44eea3a2f94ecd436a0207be684f759c76d8df5ac987c1b8c4",
  },
} as const

type SkillFile = keyof typeof FINGERPRINT.sha256

function hashOf(file: SkillFile): string {
  return createHash("sha256")
    .update(readFileSync(join(SKILL_DIR, ...file.split("/"))))
    .digest("hex")
}

/** The whole fix, spelled out — a red build here should cost one paste. */
function howToFix(): string {
  // Already bumped the constant? Then `next` is that number, not one past it.
  const next = Math.max(ROVE_SKILL_VERSION, FINGERPRINT.version + 1)
  const rows = (Object.keys(FINGERPRINT.sha256) as SkillFile[])
    .map((f) => `      ${JSON.stringify(f)}: "${hashOf(f)}",`)
    .join("\n")
  return [
    "",
    `Bump ROVE_SKILL_VERSION to ${next} in packages/rove-core/src/lib/skill-install.ts, set the`,
    `\`<!-- rove-skill-version: ${next} -->\` marker in BOTH .agents/skills/rove/SKILL.md`,
    "and claude-plugin/skills/rove/SKILL.md, then paste this into FINGERPRINT:",
    "",
    `    version: ${next},`,
    "    sha256: {",
    rows,
    "    },",
    "",
  ].join("\n")
}

describe("agent skill content is versioned", () => {
  test.each(Object.keys(FINGERPRINT.sha256) as SkillFile[])(
    "%s matches the fingerprint recorded for this skill version",
    (file) => {
      expect(hashOf(file), `${file} changed without a skill-version bump.${howToFix()}`).toBe(FINGERPRINT.sha256[file])
    },
  )

  // Without this the guard goes soft after the first bump: a stale record
  // would let every later content edit at the new version slip through.
  test("the fingerprint records the version this build ships", () => {
    expect(FINGERPRINT.version, `FINGERPRINT.version must track ROVE_SKILL_VERSION.${howToFix()}`).toBe(
      ROVE_SKILL_VERSION,
    )
  })

  test.each([join(SKILL_DIR, "SKILL.md"), join(ROOT, "claude-plugin", "skills", "rove", "SKILL.md")])(
    "%s carries the marker this build expects",
    (path) => {
      expect(readFileSync(path, "utf8")).toContain(`rove-skill-version: ${ROVE_SKILL_VERSION} `)
    },
  )
})
