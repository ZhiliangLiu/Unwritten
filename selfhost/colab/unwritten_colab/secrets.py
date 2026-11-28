import json
from pathlib import Path
from typing import Any


class SecretProblem(Exception):
    def __init__(self, name: str, kind: str) -> None:
        self.name = name
        self.kind = kind
        super().__init__(name, kind)

    def __str__(self) -> str:
        return f"{self.name}: {self.kind}"


def read_notebook_secret(name: str, userdata: Any) -> str:
    try:
        return userdata.get(name)
    except Exception as error:
        error_name = type(error).__name__
        if error_name == "SecretNotFoundError":
            raise SecretProblem(name, "missing") from None
        if error_name == "NotebookAccessError":
            raise SecretProblem(name, "no_access") from None
        raise


def read_launch_file(path: Path) -> dict[str, Any]:
    try:
        text = path.read_text()
    except FileNotFoundError:
        raise SecretProblem("launch.json", "missing") from None
    path.unlink()
    try:
        data = json.loads(text)
        token = data["token"]
        authkey = data.get("tailscaleAuthKey")
        idle_minutes = data["idleMinutes"]
    except (KeyError, TypeError, ValueError):
        raise SecretProblem("launch.json", "missing") from None
    if not isinstance(token, str) or not token:
        raise SecretProblem("launch.json", "missing")
    if authkey is not None and not isinstance(authkey, str):
        raise SecretProblem("launch.json", "missing")
    if not isinstance(idle_minutes, int) or isinstance(idle_minutes, bool):
        raise SecretProblem("launch.json", "missing")
    return {"token": token, "tailscaleAuthKey": authkey, "idleMinutes": idle_minutes}
