"""One-shot project setup: fetch assets and build the simulator bundle.

Running this after cloning leaves the project ready to serve: the CC0 3D
models are downloaded into ``app/public/models`` and the TypeScript app is
compiled into ``app/dist``, which the FastAPI server mounts in production.

    python setup.py

Node and npm are required for the front-end build. If they are missing the
asset step still runs and the build step is reported as skipped, so the CLI
pipelines (dataset, fine-tune, evaluate) remain usable.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
APP_DIR = PROJECT_ROOT / "app"


def fetch_assets() -> None:
    """Download the CC0 3D assets used by the simulator."""

    from scripts import setup_assets

    setup_assets.main()


def build_frontend() -> bool:
    """Install front-end dependencies and build the production bundle.

    Returns:
        True if the bundle was built, False if npm was unavailable.
    """

    if shutil.which("npm") is None:
        print("npm not found, skipping the front-end build.")
        return False
    print("Installing front-end dependencies...")
    subprocess.run(["npm", "install"], cwd=APP_DIR, check=True)
    print("Building the simulator bundle...")
    subprocess.run(["npm", "run", "build"], cwd=APP_DIR, check=True)
    return True


def main() -> None:
    """Fetch assets, then build the front end."""

    fetch_assets()
    built = build_frontend()
    print("\nSetup complete.")
    if built:
        print("Start the app with:  python main.py serve")
    else:
        print("Install Node, then run 'npm install && npm run build' in app/.")


if __name__ == "__main__":
    main()
