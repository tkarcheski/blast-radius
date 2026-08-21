"""Full integration tests: boot a real `opencode serve` and assert blast-radius
is visible and enforced — the skill in the skill list, the /blast-radius
command registered, the status tool loaded, the permission preset live on the
build agent, and the TUI toast endpoint reachable.

    python3 -m unittest tests.test_opencode_integration -v

Skipped automatically when the `opencode` binary is not installed.
"""

import json
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class OpenCodeServer:
    """Boots `opencode serve` in a project dir and exposes its HTTP API."""

    def __init__(self, project_dir: Path):
        self.port = free_port()
        self.base = f"http://127.0.0.1:{self.port}"
        self.log_path = project_dir / "opencode-serve.log"
        self.log = open(self.log_path, "w")
        self.proc = subprocess.Popen(
            ["opencode", "serve", "--port", str(self.port), "--print-logs"],
            cwd=project_dir,
            stdout=self.log,
            stderr=subprocess.STDOUT,
        )

    def wait_ready(self, timeout: float = 60.0) -> None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError(f"opencode exited early:\n{self.read_log()}")
            try:
                self.get("/config")
                return
            except Exception:
                time.sleep(0.5)
        raise TimeoutError(f"opencode did not become ready:\n{self.read_log()}")

    def get(self, path: str):
        with urllib.request.urlopen(self.base + path, timeout=10) as resp:
            return json.load(resp)

    def post(self, path: str, body: dict):
        req = urllib.request.Request(
            self.base + path,
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, resp.read().decode()

    def read_log(self) -> str:
        self.log.flush()
        return self.log_path.read_text()

    def stop(self) -> None:
        self.proc.terminate()
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        self.log.close()


def make_fixture(tmp: Path, strip_permission_block: bool) -> Path:
    """Copy the repo's OpenCode surface into a scratch project."""
    project = tmp / ("no-permission-block" if strip_permission_block else "full")
    project.mkdir()
    shutil.copytree(ROOT / ".opencode", project / ".opencode")
    config = json.loads((ROOT / "opencode.json").read_text())
    if strip_permission_block:
        config.pop("permission", None)
    (project / "opencode.json").write_text(json.dumps(config))
    return project


@unittest.skipUnless(shutil.which("opencode"), "opencode CLI required")
class FullIntegrationTest(unittest.TestCase):
    """The repo as shipped: plugin + skill + command + permission block."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.server = OpenCodeServer(make_fixture(Path(cls.tmp.name), False))
        cls.server.wait_ready()

    @classmethod
    def tearDownClass(cls):
        cls.server.stop()
        cls.tmp.cleanup()

    def test_plugin_loads_cleanly(self):
        self.assertNotIn("failed to load plugin", self.server.read_log())

    def test_skill_visible_in_skill_list(self):
        names = [s["name"] for s in self.server.get("/skill")]
        self.assertIn("blast-radius", names)

    def test_slash_command_registered(self):
        names = [c["name"] for c in self.server.get("/command")]
        self.assertIn("blast-radius", names)

    def test_status_tool_registered(self):
        ids = self.server.get("/experimental/tool/ids")
        self.assertTrue(
            any("blast-radius-status" in i for i in ids),
            f"status tool missing from {ids}",
        )

    def test_permission_preset_live_on_build_agent(self):
        build = [a for a in self.server.get("/agent") if a["name"] == "build"][0]
        denies = {
            (p["permission"], p["pattern"])
            for p in build["permission"]
            if p["action"] == "deny"
        }
        for expected in [
            ("bash", "sudo*"),
            ("bash", "curl * | sh*"),
            ("read", "*.env"),
            ("external_directory", "*"),
        ]:
            self.assertIn(expected, denies)

    def test_tui_toast_endpoint_reachable(self):
        status, body = self.server.post(
            "/tui/show-toast",
            {"title": "blast-radius", "message": "armed", "variant": "info"},
        )
        self.assertEqual(200, status, body)


@unittest.skipUnless(shutil.which("opencode"), "opencode CLI required")
class PluginInjectsPermissionsTest(unittest.TestCase):
    """Strip the permission block from opencode.json entirely: the plugin's
    config hook must still inject the preset — proof the protection is real
    logic in OpenCode, not a copy-pasted config."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.server = OpenCodeServer(make_fixture(Path(cls.tmp.name), True))
        cls.server.wait_ready()

    @classmethod
    def tearDownClass(cls):
        cls.server.stop()
        cls.tmp.cleanup()

    def test_preset_injected_by_plugin_alone(self):
        build = [a for a in self.server.get("/agent") if a["name"] == "build"][0]
        denies = {
            (p["permission"], p["pattern"])
            for p in build["permission"]
            if p["action"] == "deny"
        }
        self.assertIn(("bash", "sudo*"), denies)
        self.assertIn(("read", "~/.ssh/*".replace("~", str(Path.home()))), denies)


if __name__ == "__main__":
    unittest.main()
