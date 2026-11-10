"""Download the local recognizer once, so the sidecar's first start does not wait on the network.

Run by the bridge's install job (`rove-bridge/src/ops/voice-setup.ts`) after `uv sync --extra local`.
Prints one progress line per file; writes `~/.rove/voice/installed.json` when the model is complete.
A rerun resumes: the Hugging Face cache keeps what already arrived.
"""

from __future__ import annotations

import json
import sys
import time

import engine


def main() -> None:
    from huggingface_hub import snapshot_download

    config = engine.load_config()
    model = str(config.get("model") or engine.LOCAL_MODEL) if config.get("backend") != "cloud" else engine.LOCAL_MODEL
    print(f"downloading {model}", flush=True)
    path = snapshot_download(model)
    engine.HOME.mkdir(parents=True, exist_ok=True)
    (engine.HOME / "installed.json").write_text(json.dumps({"model": model, "path": path, "at": int(time.time())}))
    print(f"installed {model}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
