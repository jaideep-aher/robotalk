"""Download the CC0 3D assets the simulator needs.

Fetches the Kenney kits (City Kit Roads, City Kit Commercial, Car Kit) and one
Quaternius CC0 animated character, extracts them into ``data/raw/assets`` (which
is gitignored), and copies just the glTF binaries the app references into
``app/public/models`` (also gitignored) so the Vite dev server can serve them
from the same origin.

Kenney publishes each kit behind a hashed download URL that changes when a kit
is revised, so this script scrapes the current ``.zip`` link from the kit's
public page rather than pinning a URL that will rot.

Run it once after cloning:  ``python scripts/setup_assets.py``.

All assets are CC0 (public domain). Sources are attributed in the app README.
"""

from __future__ import annotations

import io
import re
import shutil
import urllib.request
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import List

PROJECT_ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = PROJECT_ROOT / "data" / "raw" / "assets"
PUBLIC_MODELS = PROJECT_ROOT / "app" / "public" / "models"

USER_AGENT = "Mozilla/5.0 (robotalk asset setup)"


@dataclass
class KenneyKit:
    """One Kenney kit to download and the models to copy out of it.

    Attributes:
        slug: The kit slug on kenney.nl/assets/<slug>.
        name: Local folder name under data/raw/assets.
        dest_subdir: Subfolder under app/public/models to copy models into.
        models: Exact GLB filenames to copy (without directory).
    """

    slug: str
    name: str
    dest_subdir: str
    models: List[str] = field(default_factory=list)


KENNEY_KITS: List[KenneyKit] = [
    KenneyKit(
        slug="city-kit-roads",
        name="roads",
        dest_subdir="roads",
        models=[
            "road-straight.glb",
            "road-bend.glb",
            "road-crossroad.glb",
            "road-intersection.glb",
            "road-end.glb",
            "light-square.glb",
            "light-curved.glb",
            "light-square-double.glb",
        ],
    ),
    KenneyKit(
        slug="city-kit-commercial",
        name="commercial",
        dest_subdir="buildings",
        models=[
            "building-a.glb",
            "building-b.glb",
            "building-c.glb",
            "building-d.glb",
            "building-e.glb",
            "building-f.glb",
            "building-g.glb",
            "building-h.glb",
            "building-i.glb",
            "building-j.glb",
            "building-k.glb",
            "building-l.glb",
            "building-m.glb",
            "building-n.glb",
            "building-skyscraper-a.glb",
            "building-skyscraper-b.glb",
            "building-skyscraper-c.glb",
            "building-skyscraper-d.glb",
            "building-skyscraper-e.glb",
        ],
    ),
    KenneyKit(
        slug="car-kit",
        name="car",
        dest_subdir="cars",
        models=[
            "taxi.glb",
            "sedan.glb",
            "suv.glb",
            "hatchback-sports.glb",
            "police.glb",
            "delivery.glb",
        ],
    ),
]

# Quaternius CC0 animated character, mirrored in the three.js examples repo.
QUATERNIUS_CHARACTER_URL = (
    "https://raw.githubusercontent.com/mrdoob/three.js/master/"
    "examples/models/gltf/RobotExpressive/RobotExpressive.glb"
)


def _fetch(url: str, timeout: int = 120) -> bytes:
    """Download a URL and return its bytes.

    Args:
        url: The URL to fetch.
        timeout: Socket timeout in seconds.

    Returns:
        The response body as bytes.
    """

    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def scrape_zip_url(slug: str) -> str:
    """Find the current download zip URL for a Kenney kit page.

    Args:
        slug: The kit slug (kenney.nl/assets/<slug>).

    Returns:
        The absolute URL of the kit's zip.

    Raises:
        RuntimeError: If no zip link can be found on the page.
    """

    html = _fetch(f"https://kenney.nl/assets/{slug}", timeout=60).decode(
        "utf-8", "ignore"
    )
    match = re.search(r'https://[^"\'> ]*\.zip', html)
    if not match:
        raise RuntimeError(f"Could not find a zip link for kit '{slug}'.")
    return match.group(0)


def download_and_extract(kit: KenneyKit) -> Path:
    """Download and extract one Kenney kit into data/raw/assets.

    Skips re-extraction if the kit folder already exists.

    Args:
        kit: The kit to download.

    Returns:
        The path of the extracted kit folder.
    """

    target = RAW_DIR / kit.name
    if target.exists() and any(target.rglob("*.glb")):
        print(f"[{kit.name}] already extracted, skipping download.")
        return target
    url = scrape_zip_url(kit.slug)
    print(f"[{kit.name}] downloading {url}")
    payload = _fetch(url)
    print(f"[{kit.name}] extracting {len(payload) // 1024} KiB")
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        archive.extractall(target)
    return target


def copy_models(kit: KenneyKit, kit_dir: Path) -> int:
    """Copy the selected GLB models from a kit into app/public/models.

    Args:
        kit: The kit describing which models to copy and where.
        kit_dir: The extracted kit folder.

    Returns:
        The number of models copied.
    """

    dest = PUBLIC_MODELS / kit.dest_subdir
    dest.mkdir(parents=True, exist_ok=True)
    # GLB files live under ".../Models/GLB format/" in every Kenney kit, and
    # each GLB references an external "Textures/colormap.png" beside it.
    index = {path.name: path for path in kit_dir.rglob("*.glb")}
    copied = 0
    for name in kit.models:
        source = index.get(name)
        if source is None:
            print(f"[{kit.name}] WARNING: {name} not found in kit.")
            continue
        shutil.copy2(source, dest / name)
        copied += 1

    # Copy the shared colormap texture so materials resolve.
    textures = list(kit_dir.rglob("Textures/colormap.png"))
    if textures:
        (dest / "Textures").mkdir(exist_ok=True)
        shutil.copy2(textures[0], dest / "Textures" / "colormap.png")

    print(f"[{kit.name}] copied {copied}/{len(kit.models)} models to {dest}")
    return copied


def fetch_quaternius_character() -> None:
    """Download the Quaternius CC0 animated character into app/public/models.

    The download is best-effort; a failure is reported but does not abort the
    Kenney setup, since the character is only used by Tier 2.
    """

    dest = PUBLIC_MODELS / "characters"
    dest.mkdir(parents=True, exist_ok=True)
    out = dest / "RobotExpressive.glb"
    if out.exists():
        print("[character] already present, skipping.")
        return
    try:
        print(f"[character] downloading {QUATERNIUS_CHARACTER_URL}")
        out.write_bytes(_fetch(QUATERNIUS_CHARACTER_URL))
        print(f"[character] saved {out}")
    except Exception as exc:  # noqa: BLE001 - Tier 2 asset, non-fatal
        print(f"[character] WARNING: could not download ({exc}).")


def main() -> None:
    """Run the full asset setup: kits, models, and the character."""

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_MODELS.mkdir(parents=True, exist_ok=True)
    for kit in KENNEY_KITS:
        kit_dir = download_and_extract(kit)
        copy_models(kit, kit_dir)
    fetch_quaternius_character()
    print("\nAsset setup complete. Models are in app/public/models (gitignored).")


if __name__ == "__main__":
    main()
