import requests
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

GITHUB_REPO = "eagleone34/LocalBookKeeping"
CURRENT_VERSION = "1.0.0"   # stamped by release.yml at build time
DOWNLOAD_URL = (
    "https://github.com/eagleone34/LocalBookKeeping"
    "/releases/latest/download/LocalBooks_Setup.exe"
)


def _parse_version(v: str) -> tuple:
    try:
        return tuple(int(x) for x in v.split("."))
    except Exception:
        return (0,)


def check_for_updates() -> Optional[str]:
    """
    Checks the GitHub repository for the latest release version.
    Returns the new version string if an update is available, else None.
    """
    url = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
    try:
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            latest_version = data.get("tag_name", "").strip("v")
            if latest_version and _parse_version(latest_version) > _parse_version(CURRENT_VERSION):
                return latest_version
    except Exception as e:
        print(f"Failed to check for updates: {e}")
    return None


def download_and_install_update() -> bool:
    """
    Downloads LocalBooks_Setup.exe from GitHub Releases to %TEMP% and
    launches it as a detached process. The installer handles: killing
    the running exe, selective extraction (skipping company_data/),
    shortcut creation, and launching the new version.

    Returns True if the installer was successfully launched.
    Raises RuntimeError on download or launch failure.
    """
    dest = Path(tempfile.gettempdir()) / "LocalBooks_Setup_update.exe"

    try:
        with requests.get(DOWNLOAD_URL, stream=True, timeout=60) as resp:
            resp.raise_for_status()
            with open(dest, "wb") as f:
                for chunk in resp.iter_content(chunk_size=65536):
                    if chunk:
                        f.write(chunk)
    except Exception as e:
        raise RuntimeError(f"Failed to download update: {e}") from e

    # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP so installer outlives this process
    DETACHED_FLAGS = 0x00000008 | 0x00000200
    try:
        subprocess.Popen([str(dest)], creationflags=DETACHED_FLAGS, close_fds=True)
    except Exception as e:
        raise RuntimeError(f"Failed to launch installer: {e}") from e

    return True
