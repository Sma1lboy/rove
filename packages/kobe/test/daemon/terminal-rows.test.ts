/**
 * Alt-screen row recovery (issue #97).
 *
 * The incident: a task whose engine put up a "you've hit your weekly limit"
 * dialog and waited. Its durable death record kept ONE readable line —
 * `Enter to confirm · Esc to cancel` — so the question, its three options,
 * and the reason were all gone, and the tab was indistinguishable from a
 * crash. The tail budget was 40 lines and it kept 1, because a full-screen
 * engine paints with cursor motion and writes no newline for the screen: the
 * old `replace(ANSI_RE, "")` deleted the row breaks along with the colors and
 * concatenated the whole screen into a single line.
 *
 * The fixture is that screen, reduced to the shape that matters: CSI row
 * motion, and not one `\n` in the whole capture.
 */

import { plainTail } from "@sma1lboy/kobe-daemon/daemon/pty-exit-store"
import { terminalRows } from "@sma1lboy/kobe-daemon/daemon/terminal-rows"
import { describe, expect, it } from "vitest"

/** A rate-limit dialog as claude actually paints it: every row reached with
 *  `ESC[nB` cursor motion, never a newline. */
const ALT_SCREEN_DIALOG =
  "\x1b[38;2;153;153;153m  ⎿ \x1b[38;2;255;107;128mYou've hit your weekly limit · resets Sep 2 at 3am" +
  "\r\x1b[2B\x1b[38;2;153;153;153m✻\x1b[3GChurned for 0s · done 1:19 AM" +
  "\r\x1b[1B\x1b[3C\x1b[1mWhat do you want to do?" +
  "\r\x1b[3C\x1b[2B\x1b[22m❯\x1b[6G\x1b[38;2;153;153;153m1. \x1b[39mStop and wait for limit to reset" +
  "\r\x1b[5C\x1b[1B\x1b[38;2;153;153;153m2. \x1b[39mWait here, then continue automatically" +
  "\r\x1b[5C\x1b[1B\x1b[38;2;153;153;153m3. \x1b[39mUpgrade your plan" +
  "\r\x1b[3C\x1b[2B\x1b[3mEnter to confirm · Esc to cancel\x1b[23m\x1b[39m"

describe("terminalRows", () => {
  it("recovers the rows of an alt-screen paint that contains no newline", () => {
    expect(ALT_SCREEN_DIALOG).not.toContain("\n") // the premise: nothing to split on

    const rows = terminalRows(ALT_SCREEN_DIALOG).filter((line) => line.trim() !== "")

    // The question and every option survive — not just the last footer line.
    expect(rows.length).toBeGreaterThan(1)
    expect(rows.some((l) => l.includes("What do you want to do?"))).toBe(true)
    expect(rows.some((l) => l.includes("Stop and wait for limit to reset"))).toBe(true)
    expect(rows.some((l) => l.includes("Upgrade your plan"))).toBe(true)
    // And the WHY, which is what made this dialog answerable at all.
    expect(rows.some((l) => l.includes("hit your weekly limit"))).toBe(true)
  })

  it("keeps each row separate rather than concatenating the screen", () => {
    const rows = terminalRows(ALT_SCREEN_DIALOG).filter((line) => line.trim() !== "")
    // The bug's signature: one line carrying both the question and the footer.
    const merged = rows.find((l) => l.includes("What do you want to do?") && l.includes("Esc to cancel"))
    expect(merged).toBeUndefined()
  })

  it("breaks a row on absolute cursor positioning too", () => {
    // The real capture ended `...Esc to cancel\x1b[44;1H\x1b[40;4H` — a status
    // line jumped to with ESC[row;colH rather than stepped down to. Treated as
    // "some other row", not as the row it names: this is not an emulator.
    expect(terminalRows("footer\x1b[44;1Hstatus")).toEqual(["footer", "status"])
  })

  it("still splits ordinary newline-terminated shell output, and honors CR overwrites", () => {
    expect(terminalRows("one\ntwo\r\nthree")).toEqual(["one", "two", "three"])
    // A progress line rewritten in place reports only its final state.
    expect(terminalRows("Installing [1/9]\rInstalling [9/9]")).toEqual(["Installing [9/9]"])
  })

  it("clips to maxLineChars only when the caller asks", () => {
    expect(terminalRows("abcdef", 3)).toEqual(["abc"])
    expect(terminalRows("abcdef")).toEqual(["abcdef"])
  })

  it("bounds the rows one escape can synthesize", () => {
    // `ESC[999999B` must not turn a 20-byte capture into a million-row array.
    expect(terminalRows("a\x1b[999999Bb").length).toBeLessThanOrEqual(202)
  })
})

describe("plainTail (the death record's tail)", () => {
  it("keeps the dialog's question, not just its last painted line", () => {
    const tail = plainTail(ALT_SCREEN_DIALOG)
    // Before the fix this was exactly ["Enter to confirm · Esc to cancel"].
    expect(tail.length).toBeGreaterThan(1)
    expect(tail.join("\n")).toContain("What do you want to do?")
    expect(tail[tail.length - 1]).toContain("Enter to confirm")
  })
})
