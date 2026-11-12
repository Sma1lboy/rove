/**
 * What a machine says about itself to a hub placing work (`--machine auto`):
 * its system, its size, and how busy it is at `at`. Read by the machine's own
 * daemon and returned in `daemon.status`, so it is the machine's reading and
 * not something a hub infers from task rows.
 */

import { arch, cpus, freemem, loadavg, platform, totalmem } from "node:os"

export interface MachineLoad {
  readonly platform: string
  readonly arch: string
  readonly cores: number
  readonly memTotalMb: number
  readonly memFreeMb: number
  /** 1-minute load average per core. Absent on Windows, which keeps none: a 0 there would read as idle. */
  readonly load?: number
  readonly at: string
}

const mb = (bytes: number): number => Math.round(bytes / 1024 / 1024)

export function readMachineLoad(): MachineLoad {
  const cores = Math.max(1, cpus().length)
  return {
    platform: platform(),
    arch: arch(),
    cores,
    memTotalMb: mb(totalmem()),
    memFreeMb: mb(freemem()),
    ...(platform() === "win32" ? {} : { load: Math.round(((loadavg()[0] ?? 0) / cores) * 100) / 100 }),
    at: new Date().toISOString(),
  }
}
