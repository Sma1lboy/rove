/**
 * Guard: editing the agent skill's CONTENT must bump its version marker.
 *
 * `kobeSkillState` decides staleness by comparing marker numbers only
 * (`best.version < KOBE_SKILL_VERSION`) — it never looks at what the file
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
import { describe, expect, test } from "vitest"
import { KOBE_SKILL_VERSION } from "../../src/lib/skill-install.ts"

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
/** The canonical skill source. `claude-plugin/skills/rove` is a byte-identical
 *  copy, held there by `claude-plugin.test.ts` — hashing one covers both. */
const SKILL_DIR = join(ROOT, ".agents", "skills", "kobe")

/**
 * sha256 of every file in the skill, as of {@link KOBE_SKILL_VERSION}.
 * Regenerate with the command the failure message prints.
 */
const FINGERPRINT = {
  version: 45,
  sha256: {
    "SKILL.md": "676dcf4f75d7b445c8e513d0e81d84c19c8a8f2c7f347482a3f567d52b468af2",
    "references/api-flags.md": "d4c63e13b893e21976a4e9605645b6270355ce2d963dd8107098f62d04382b26",
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
  const next = Math.max(KOBE_SKILL_VERSION, FINGERPRINT.version + 1)
  const rows = (Object.keys(FINGERPRINT.sha256) as SkillFile[])
    .map((f) => `      ${JSON.stringify(f)}: "${hashOf(f)}",`)
    .join("\n")
  return [
    "",
    `Bump KOBE_SKILL_VERSION to ${next} in src/lib/skill-install.ts, set the`,
    `\`<!-- rove-skill-version: ${next} -->\` marker in BOTH .agents/skills/kobe/SKILL.md`,
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
    expect(FINGERPRINT.version, `FINGERPRINT.version must track KOBE_SKILL_VERSION.${howToFix()}`).toBe(
      KOBE_SKILL_VERSION,
    )
  })

  test("both SKILL.md copies carry the marker this build expects", () => {
    for (const path of [join(SKILL_DIR, "SKILL.md"), join(ROOT, "claude-plugin", "skills", "rove", "SKILL.md")]) {
      expect(readFileSync(path, "utf8"), path).toContain(`rove-skill-version: ${KOBE_SKILL_VERSION} `)
    }
  })
})
