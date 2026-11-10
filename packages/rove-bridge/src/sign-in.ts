/**
 * How a browser gets in, one of three: `open` (this computer's own browser needs nothing), `password`
 * (a page without a token signs in), `token` (only the printed link or a device token). `auth` in
 * `bridge/config.json` picks it and is read per connection, so a change needs no restart. Tokens work in
 * every mode; phones always pair with one.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { LOCAL_CREDENTIAL, directFromThisComputer } from "./local-access.ts"
import { BridgeError } from "./protocol.ts"
import {
  EMPTY_LOCKOUT,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  hashPassword,
  readPassword,
  webPasswordPaths,
  writeLockout,
  writePassword,
} from "./web-password.ts"

export const SIGN_IN_MODES = ["open", "password", "token"] as const
export type SignInMode = (typeof SIGN_IN_MODES)[number]

export interface SignIn {
  mode(): SignInMode
  /** This request gets in with no token: the mode is `open` and it came straight from this computer. */
  opens(req: Request, peer: string | undefined): boolean
  /** The modes this run can be in: `open` only where nothing but this computer reaches the bridge. */
  modes(): readonly SignInMode[]
  hasPassword(): boolean
  /** `password` sets or replaces the password. Leaving `open` returns a device token for the browser that asked. */
  set(mode: SignInMode, password?: string): Promise<string | null>
}

function readRaw(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return {}
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"))
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  } catch {
    return null
  }
}

/** Writes `auth`, keeping the file's other keys. */
export function writeSignInMode(configPath: string, mode: SignInMode): void {
  const { requireToken: _legacy, ...rest } = readRaw(configPath) ?? {}
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 })
  writeFileSync(configPath, `${JSON.stringify({ ...rest, auth: mode }, null, 2)}\n`, { mode: 0o600 })
}

export function createSignIn(opts: {
  readonly bridgeDir: string
  readonly configPath: string
  /** Nothing but this computer reaches the bridge as started (`plainLocalRun`). */
  readonly plain: boolean
  /** Called when the mode leaves `open`: ends the tokenless sessions and mints the asking browser's token. */
  readonly leaveOpen: () => string
}): SignIn {
  const paths = webPasswordPaths(opts.bridgeDir)
  const hasPassword = (): boolean => readPassword(paths.password) !== null
  const mode = (): SignInMode => {
    const raw = readRaw(opts.configPath)
    const picked = raw?.auth
    if (picked === "token") return "token"
    if (picked === "password" && hasPassword()) return "password"
    // A config that no longer parses, or the older `requireToken`, must not leave the door open.
    if (picked === "open" && opts.plain) return "open"
    if (hasPassword()) return "password"
    return opts.plain && raw !== null && raw.requireToken !== true ? "open" : "token"
  }
  const modes = (): readonly SignInMode[] => (opts.plain ? SIGN_IN_MODES : ["password", "token"])
  return {
    mode,
    opens: (req, peer) => mode() === "open" && directFromThisComputer(req, peer),
    modes,
    hasPassword,
    async set(next, password) {
      if (!modes().includes(next)) throw new BridgeError("BAD_ARGS", `this bridge cannot be ${next}`)
      if (next === "password" && password === undefined && !hasPassword()) {
        throw new BridgeError("BAD_ARGS", "a password is needed first")
      }
      // Read before a new password is written: one on disk already reads as `password`.
      const wasOpen = mode() === "open"
      if (next === "password" && password !== undefined) {
        if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
          throw new BridgeError(
            "BAD_ARGS",
            `the password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`,
          )
        }
        writePassword(paths.password, await hashPassword(password))
        writeLockout(paths.lockout, EMPTY_LOCKOUT)
      }
      writeSignInMode(opts.configPath, next)
      return wasOpen && next !== "open" ? opts.leaveOpen() : null
    },
  }
}

/** `auth.status` and `auth.setMode {mode, password?}`. Only a browser that got in without a token is handed one to stay in. */
export async function authOp(
  signIn: SignIn | undefined,
  op: "auth.status" | "auth.setMode",
  args: Readonly<Record<string, unknown>>,
  credential: string,
): Promise<unknown> {
  if (!signIn) throw new BridgeError("UNSUPPORTED", "this bridge serves no browser client")
  if (op === "auth.status") {
    return {
      mode: signIn.mode(),
      modes: signIn.modes(),
      hasPassword: signIn.hasPassword(),
      minPassword: MIN_PASSWORD_LENGTH,
    }
  }
  const next = SIGN_IN_MODES.find((mode) => mode === args.mode)
  if (!next) throw new BridgeError("BAD_ARGS", "mode is open|password|token")
  if (args.password !== undefined && typeof args.password !== "string") {
    throw new BridgeError("BAD_ARGS", "password must be a string")
  }
  const token = await signIn.set(next, args.password)
  return credential === LOCAL_CREDENTIAL && token ? { token } : {}
}
