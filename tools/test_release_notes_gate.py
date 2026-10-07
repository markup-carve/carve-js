"""The release-notes gate wrapper must run outside CI.

`tools/run-release-notes-gate.sh` hard-coded `python`, a name that exists in CI
only because actions/setup-python shims it. On a machine carrying `python3`
alone the gate died with exit 127. Cold it died earlier still, with exit 5: no
`GITHUB_REPOSITORY` meant the API was asked for `repos//releases`, so the first
symptom of a missing variable was a 404 (carve-js#2557).

These tests stub PATH rather than relying on the host, so they hold on a runner
where both interpreter names resolve. Nothing here reaches the network: the
interpreter and the repository are resolved before the release lookup, and `gh`
itself is stubbed.
"""

import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

GATE = Path(__file__).with_name("run-release-notes-gate.sh")
ROOT = GATE.parent.parent
# Absolute, because PATH below holds the stubs alone: an interpreter reachable
# through the real PATH would decide the test instead of the stub.
BASH = shutil.which("bash") or "/bin/bash"


def _stub(directory: Path, name: str, body: str) -> None:
    path = directory / name
    path.write_text("#!/bin/sh\n" + body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


def _run(path_dir: Path, tag="0.0.0-test", **env):
    environment = {
        "PATH": str(path_dir),
        "GITHUB_REPOSITORY": "markup-carve/carve-js",
        "GH_TOKEN": "stub",
        **env,
    }
    environment = {k: v for k, v in environment.items() if v is not None}
    return subprocess.run(
        [BASH, str(GATE), tag],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
    )


def _release_stubs(stubs: Path) -> None:
    _stub(stubs, "gh", 'echo "[]"\n')
    _stub(stubs, "jq", 'echo "{\\"tag_name\\": \\"0.0.0-test\\"}"\n')


class ReleaseNotesGateInterpreterTests(unittest.TestCase):
    def test_the_gate_runs_where_only_python3_exists(self):
        with tempfile.TemporaryDirectory(prefix="carve-gate-test-") as directory:
            stubs = Path(directory)
            _stub(stubs, "python3", 'echo "ran under python3"\nexit 0\n')
            _release_stubs(stubs)

            result = _run(stubs)

            self.assertEqual(0, result.returncode, result.stderr)
            self.assertIn("ran under python3", result.stdout)

    def test_python_alone_is_still_enough(self):
        with tempfile.TemporaryDirectory(prefix="carve-gate-test-") as directory:
            stubs = Path(directory)
            _stub(stubs, "python", 'echo "ran under python"\nexit 0\n')
            _release_stubs(stubs)

            result = _run(stubs)

            self.assertEqual(0, result.returncode, result.stderr)
            self.assertIn("ran under python", result.stdout)

    def test_python3_wins_when_both_names_resolve(self):
        with tempfile.TemporaryDirectory(prefix="carve-gate-test-") as directory:
            stubs = Path(directory)
            _stub(stubs, "python3", 'echo "ran under python3"\nexit 0\n')
            _stub(stubs, "python", 'echo "ran under python"\nexit 0\n')
            _release_stubs(stubs)

            result = _run(stubs)

            self.assertEqual(0, result.returncode, result.stderr)
            self.assertIn("ran under python3", result.stdout)
            self.assertNotIn("ran under python\n", result.stdout)

    def test_the_PYTHON_override_names_the_interpreter(self):
        with tempfile.TemporaryDirectory(prefix="carve-gate-test-") as directory:
            stubs = Path(directory)
            _stub(stubs, "python3", 'echo "ran under python3"\nexit 0\n')
            _stub(stubs, "my-python", 'echo "ran under the override"\nexit 0\n')
            _release_stubs(stubs)

            result = _run(stubs, PYTHON="my-python")

            self.assertEqual(0, result.returncode, result.stderr)
            self.assertIn("ran under the override", result.stdout)

    def test_neither_name_present_fails_and_says_what_was_missing(self):
        with tempfile.TemporaryDirectory(prefix="carve-gate-test-") as directory:
            stubs = Path(directory)
            _release_stubs(stubs)

            result = _run(stubs)

            self.assertEqual(1, result.returncode)
            self.assertIn("No Python interpreter found", result.stdout + result.stderr)
            self.assertNotEqual(127, result.returncode)

    def test_the_wrapper_names_no_interpreter_in_the_pipeline(self):
        text = GATE.read_text(encoding="utf-8")
        self.assertNotIn("| python ", text)
        self.assertNotIn("| python3 ", text)
        self.assertIn('"$python_bin" tools/check-release-notes.py', text)


class ReleaseNotesGateRepositoryTests(unittest.TestCase):
    """Cold, the gate used to query `repos//releases` and report a 404."""

    def test_an_unset_variable_falls_back_to_the_origin_remote(self):
        with tempfile.TemporaryDirectory(prefix="carve-gate-test-") as directory:
            stubs = Path(directory)
            _stub(stubs, "python3", 'echo "repo=$5"\nexit 0\n')
            _release_stubs(stubs)
            _stub(stubs, "git", 'echo "git@github.com:markup-carve/carve-js.git"\n')

            result = _run(stubs, GITHUB_REPOSITORY=None)

            self.assertEqual(0, result.returncode, result.stderr)
            self.assertIn("repo=markup-carve/carve-js", result.stdout)

    def test_an_https_remote_resolves_the_same_way(self):
        with tempfile.TemporaryDirectory(prefix="carve-gate-test-") as directory:
            stubs = Path(directory)
            _stub(stubs, "python3", 'echo "repo=$5"\nexit 0\n')
            _release_stubs(stubs)
            _stub(stubs, "git", 'echo "https://github.com/markup-carve/carve-js"\n')

            result = _run(stubs, GITHUB_REPOSITORY=None)

            self.assertEqual(0, result.returncode, result.stderr)
            self.assertIn("repo=markup-carve/carve-js", result.stdout)

    def test_no_variable_and_no_remote_names_the_variable_to_set(self):
        with tempfile.TemporaryDirectory(prefix="carve-gate-test-") as directory:
            stubs = Path(directory)
            _stub(stubs, "python3", "exit 0\n")
            _release_stubs(stubs)
            _stub(stubs, "git", "exit 1\n")

            result = _run(stubs, GITHUB_REPOSITORY=None)

            self.assertEqual(1, result.returncode)
            self.assertIn("GITHUB_REPOSITORY", result.stdout + result.stderr)
            self.assertNotEqual(5, result.returncode)

    def test_a_missing_tag_argument_is_refused_before_anything_runs(self):
        with tempfile.TemporaryDirectory(prefix="carve-gate-test-") as directory:
            stubs = Path(directory)
            _stub(stubs, "python3", "exit 0\n")
            _release_stubs(stubs)

            result = _run(stubs, tag="")

            self.assertEqual(1, result.returncode)
            self.assertIn("Usage:", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
