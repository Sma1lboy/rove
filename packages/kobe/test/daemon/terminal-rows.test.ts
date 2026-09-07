/**
 * Alt-screen row recovery.
 *
 * A full-screen engine — say one holding a "you've hit your weekly limit"
 * dialog — paints with cursor motion and writes no newline for the screen. A
 * bare `replace(ANSI_RE, "")` deletes the row breaks along with the colors
 * and concatenates the whole screen into a single line, so a 40-line tail
 * budget keeps ONE readable line (`Enter to confirm · Esc to cancel`) and the
 * question, its options, and the reason are all gone — a death record
 * indistinguishable from a crash.
 *
 * The fixture is that screen, reduced to the shape that matters: CSI row
 * motion, and not one `\n` in the whole capture.
 */

import { plainTail } from "@sma1lboy/kobe-daemon/daemon/pty-exit-store"
import { stripTerminalControls, terminalRows } from "@sma1lboy/kobe-daemon/daemon/terminal-rows"
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
    // Concatenating the screen collapses this to exactly
    // ["Enter to confirm · Esc to cancel"].
    expect(tail.length).toBeGreaterThan(1)
    expect(tail.join("\n")).toContain("What do you want to do?")
    expect(tail[tail.length - 1]).toContain("Enter to confirm")
  })
})

/**
 * A shell dying under SIGKILL, as `pty-exits.json` actually captured it: an
 * SGR colour, a BEL the shell rang, a backspace from a spinner, and the
 * charset-select `ESC ( B` a full redraw emits. Every one of those reached
 * `get-task`'s `exit.tail` verbatim, because the old escape grammar covered
 * neither bare C0 nor `ESC <intermediate> <final>`.
 */
const SIGKILL_TAIL = "boot\x1b[31mRED\x1b[0m\x07back\bspace\x1b(Bcharset"

describe("control bytes never reach a non-terminal consumer", () => {
  const bareControls = (text: string): string[] =>
    [...text].filter((ch) => ch.charCodeAt(0) < 0x20 && ch !== "\n" && ch !== "\t")

  it("strips bare C0 and ESC-intermediate escapes the CSI/OSC grammar misses", () => {
    // The premise: the sequences below are exactly the ones that used to survive.
    expect(bareControls(SIGKILL_TAIL).length).toBeGreaterThan(0)

    expect(terminalRows(SIGKILL_TAIL)).toEqual(["bootREDbackspacecharset"])
    expect(bareControls(plainTail(SIGKILL_TAIL).join("\n"))).toEqual([])
  })

  it("keeps the bytes that carry line structure", () => {
    // \t survives; \r still means "overwrite this row", not "delete me".
    expect(terminalRows("a\tb")).toEqual(["a\tb"])
    expect(terminalRows("first\rsecond")).toEqual(["second"])
  })

  it("leaves ordinary text alone", () => {
    expect(stripTerminalControls("plain text — no escapes")).toBe("plain text — no escapes")
  })
})
