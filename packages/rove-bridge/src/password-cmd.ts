/**
 * `--set-password`, `--clear-password`, `--unlock`: one-shot actions on the browser login
 * password. The password is read from the terminal with echo off, never from argv or env.
 */

import {
  EMPTY_LOCKOUT,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  clearPassword,
  hashPassword,
  webPasswordPaths,
  writeLockout,
  writePassword,
} from "./web-password.ts"

/** One line from the TTY with echo off. Rejects when stdin is not a terminal or on Ctrl-C. */
export function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin
  if (!stdin.isTTY) return Promise.reject(new Error("--set-password needs an interactive terminal"))
  process.stdout.write(question)
  stdin.setRawMode(true)
  stdin.setEncoding("utf8")
  stdin.resume()
  return new Promise((resolve, reject) => {
    let value = ""
    const finish = (): void => {
      stdin.off("data", onData)
      stdin.setRawMode(false)
      stdin.pause()
      process.stdout.write("\n")
    }
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          finish()
          resolve(value)
          return
        }
        if (ch === "\u0003" || ch === "\u0004") {
          finish()
          reject(new Error("cancelled"))
          return
        }
        if (ch === "\u007f" || ch === "\b") value = [...value].slice(0, -1).join("")
        else if (ch >= " ") value += ch
      }
    }
    stdin.on("data", onData)
  })
}

export async function runPasswordAction(
  action: "set-password" | "clear-password" | "unlock",
  bridgeDir: string,
  prompt: (question: string) => Promise<string> = promptHidden,
): Promise<number> {
  const paths = webPasswordPaths(bridgeDir)
  if (action === "unlock") {
    writeLockout(paths.lockout, EMPTY_LOCKOUT)
    console.log("password login unlocked")
    return 0
  }
  if (action === "clear-password") {
    console.log(clearPassword(paths.password) ? "browser password removed" : "no browser password was set")
    writeLockout(paths.lockout, EMPTY_LOCKOUT)
    return 0
  }
  const first = await prompt("New browser password: ")
  if (first.length < MIN_PASSWORD_LENGTH || first.length > MAX_PASSWORD_LENGTH) {
    console.error(`the password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters; nothing changed`)
    return 1
  }
  if ((await prompt("Again: ")) !== first) {
    console.error("the two entries differ; nothing changed")
    return 1
  }
  writePassword(paths.password, await hashPassword(first))
  writeLockout(paths.lockout, EMPTY_LOCKOUT)
  console.log(
    `browser password set (${paths.password}). A page without a token now shows a password field;\neach login gets its own device token (see --list-devices).`,
  )
  return 0
}
