/**
 * The Rove activity plugin Rove WRITES into Hermes Agent's plugin directory,
 * as source text.
 *
 * Hermes loads plugins as PYTHON packages: a directory under
 * `<config dir>/plugins/<name>/` holding a `plugin.yaml` descriptor and an
 * `__init__.py` whose `register(ctx)` subscribes to named hooks. Both files
 * are generated here so a reinstall is a byte comparison.
 *
 * ONE verb, deliberately. The three hooks Hermes exposes to a plugin at this
 * level — `on_session_start`, `on_session_reset`, `pre_llm_call` — all answer
 * "which Hermes session is live here", not "what is it doing"; there is no
 * turn-complete or permission hook among them. So `../contrib-engines.ts`'s
 * screen manifest keeps owning working/blocked/idle and the plugin adds
 * session identity on top, the same split cursor and grok landed on.
 *
 * The platform gate matters: Hermes fires these hooks for non-interactive
 * entry points too (batch, API), and a session with no terminal behind it is
 * not the pane's session. Only the interactive platforms report.
 */

import type { VendorId } from "../../types/vendor.ts"
import { ROVE_HOOK_VERSION } from "../json-hooks.ts"

export interface HermesPluginSourceOptions {
  readonly vendor: VendorId
  /** argv prefix that reaches `kobe hook <verb>` (see `cli/invocation.ts`). */
  readonly invocation: readonly string[]
}

/** The descriptor Hermes reads to discover the plugin. Static — it names the
 *  plugin and nothing environment-specific, so it is a constant rather than a
 *  render. */
export const HERMES_PLUGIN_MANIFEST = `name: rove-agent-state
version: "1.0"
description: Report Hermes Agent session identity to Rove
`

/**
 * Render the plugin package's `__init__.py`. Pure: the same options always
 * produce the same bytes, which is what lets the installer skip the write.
 */
export function renderHermesPluginSource(opts: HermesPluginSourceOptions): string {
  const { vendor, invocation } = opts
  return `"""Rove activity hook — GENERATED, installed and rewritten by Rove on every
launch (${vendor}). Local edits are overwritten; to stop reporting, delete this
directory or turn Rove's global hooks off.

ROVE_HOOK_VERSION=${ROVE_HOOK_VERSION}

It subscribes to ${vendor}'s session hooks and shells out to
\`${invocation.join(" ")} hook session-start --engine ${vendor}\`. Best-effort by
construction: the report is fire-and-forget and every failure is swallowed — a
badge must never break a turn.
"""

from __future__ import annotations

import json
import os
import subprocess

_ENGINE = ${JSON.stringify(vendor)}
_INVOCATION = ${JSON.stringify(invocation)}
_HOOK_VERSION = ${JSON.stringify(String(ROVE_HOOK_VERSION))}

# Hermes fires these hooks for batch and API entry points too; only a session
# with a terminal behind it is the one Rove's pane is about.
_INTERACTIVE_PLATFORMS = {"cli", "tui", "desktop", "acp"}


def _emit(session_id: str) -> None:
    payload = {"session_id": session_id, "cwd": os.getcwd()}
    argv = list(_INVOCATION) + [
        "hook",
        "session-start",
        "--engine",
        _ENGINE,
        "--hook-version",
        _HOOK_VERSION,
        "--payload",
        json.dumps(payload),
    ]
    try:
        subprocess.Popen(
            argv,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


def _report(**kwargs) -> None:
    if kwargs.get("platform") not in _INTERACTIVE_PLATFORMS:
        return
    session_id = kwargs.get("session_id")
    if not isinstance(session_id, str) or not session_id:
        return
    _emit(session_id)


def register(ctx):
    # Only the two session edges. Hermes also exposes \`pre_llm_call\`, which
    # would re-report the same identity once per model request — a process
    # spawn per call to say what session start already said.
    ctx.register_hook("on_session_start", _report)
    ctx.register_hook("on_session_reset", _report)
`
}
