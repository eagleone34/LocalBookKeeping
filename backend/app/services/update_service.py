import requests
from typing import Optional

GITHUB_REPO = "eagleone34/LocalBookKeeping"
CURRENT_VERSION = "1.0.0"

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
            if latest_version and latest_version != CURRENT_VERSION:
                # Basic string comparison (e.g. "1.0.1" > "1.0.0")
                if latest_version > CURRENT_VERSION:
                    return latest_version
    except Exception as e:
        print(f"Failed to check for updates: {e}")
    return None
