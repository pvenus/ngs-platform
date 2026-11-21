import importlib.machinery
import fcntl
import json
import os
from pathlib import Path
import plistlib
import tarfile
import tempfile
import unittest

m = importlib.machinery.SourceFileLoader("mac_apply", str(Path(__file__).with_name("ngs-mac-apply"))).load_module()
SHA = "d" * 40


class Host:
    def __init__(self, root):
        self.releases = root / "releases"
        self.scratch = root / "scratch"
        self.queue = root / "queue"
        self.old = self.releases / "project-page-github-f36ed84"
        self.new = self.releases / ("project-page-github-" + SHA)
        self.raw = plistlib.dumps({"Label": m.LABEL, "ProgramArguments": ["/fake/bin/node", str(self.old / m.ENTRY)],
            "WorkingDirectory": str(self.scratch / "f36ed84"), "EnvironmentVariables": {
                "NGS_PROJECT_LISTEN_PORT": "5274", "NGS_REQUEST_QUEUE_MCP_PORT": "5275",
                "NGS_REQUEST_QUEUE_DB": str(self.queue), "NGS_FILE_SYNC_MODE": "push",
                "NGS_FILE_SYNC_PROJECTS": "binari", "NGS_LOCAL_MINIFLARE_ROOT": "/fake/native",
                "UNRELATED_AUTH_SETTING": "keep"}})
        self.prior = self.raw
        self.loaded = True
        self.current = 100
        self.health_failure = False
        self.rollback_failure = False
        self.calls = []
        self.queue.write_bytes(b"real queue stand-in")
        for root in (self.old, self.new):
            root.mkdir(mode=0o700, parents=True)
            for path in m.SCHEMA_INPUTS:
                p = root / path
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(str(path))
        (self.scratch / SHA).mkdir(mode=0o700, parents=True)
        deps = self.new / "local-miniflare/node_modules"
        deps.mkdir()
        (deps / "module.js").write_text("shared dependency")
        locked = {}
        for name in ("miniflare", "workerd"):
            (deps / name).mkdir()
            (deps / name / "package.json").write_text('{"version":"1.0.0"}')
            locked["node_modules/" + name] = {"version": "1.0.0"}
        for root in (self.old, self.new):
            (root / "local-miniflare/package-lock.json").write_text(json.dumps({"packages": locked}))

    def read_plist(self):
        return self.raw

    def replace(self, prior, new):
        assert self.raw == prior
        self.calls.append("replace")
        self.raw = new

    def bootout(self):
        assert self.loaded
        self.calls.append("stop")
        self.loaded = False

    def stop_if_loaded(self):
        if self.loaded:
            self.bootout()

    def bootstrap(self):
        assert not self.loaded
        self.calls.append("start")
        self.current += 1
        self.loaded = True

    def pid(self):
        return self.current if self.loaded else None

    def listener(self, _port):
        return {self.current} if self.loaded else set()

    def unchanged(self, _env):
        return self.queue.stat().st_ino

    def healthy(self, expected, old_pid=None, wait=35):
        assert self.loaded
        assert self.current != old_pid
        assert plistlib.loads(self.raw)["ProgramArguments"][-1] == str(expected / m.ENTRY)
        if (expected == self.new and self.health_failure) or (wait and expected == self.old and self.rollback_failure):
            raise m.Refused("NATIVE_HEALTH_UNVERIFIED")
        return self.current


class Apply(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.host = Host(self.root)
        self.control = self.root / "control"
        self.control.mkdir(mode=0o700)
        (self.control / "mac-releases").mkdir(mode=0o700)
        self.folder = self.control / "mac-releases" / SHA
        self.folder.mkdir(mode=0o700)
        archive = self.folder / "ngs-local.tar"
        with tarfile.open(archive, "w") as tar:
            for f in m.SCHEMA_INPUTS:
                tar.add(self.host.new / f, arcname=f.as_posix())
        archive.chmod(0o600)
        ah = m.digest(archive.read_bytes())
        self.prov = {"runId": "100", "runAttempt": "1", "artifactId": "200", "archiveSha256": ah}
        self.ops = {"schemaVersion": "ops.ngs-prepared-deploy.v1", "sha": SHA,
                    "verifiedAt": "2026-11-22T00:00:00Z", "mac": {"ready": True},
                    "provenance": self.prov}
        self.spec = {"schemaVersion": "ops.ngs-mac-release.v1", "sha": SHA,
                     "repo": m.REPO, "ref": m.BRANCH,
                     "workflow": {"headSha": SHA, "headBranch": "main", "conclusion": "success",
                                  "runId": "100", "runAttempt": "1", "artifactId": "200"},
                     "archiveSha256": ah, "treeSha256": m.tree_sha(self.host.new),
                     "expectedPriorPlistSha256": m.digest(self.host.raw)}
        self.publish()

    def publish(self):
        for path, doc in ((self.control / "prepared.json", self.ops), (self.folder / "manifest.json", self.spec)):
            path.write_text(json.dumps(doc))
            path.chmod(0o600)

    def run_apply(self, sha=SHA):
        return m.apply(sha, self.control, self.host)

    def status(self):
        return json.loads((self.folder / "result.json").read_bytes())

    def test_exact_success_and_no_rerun(self):
        self.assertEqual(self.run_apply(), {"sha": SHA, "target": "mac", "state": "deployed", "health": "verified"})
        self.assertEqual(self.host.calls, ["stop", "replace", "start"])
        self.assertEqual((self.folder / "prior.plist").read_bytes(), self.host.prior)
        self.assertEqual(self.host.queue.read_bytes(), b"real queue stand-in")
        self.assertEqual(self.status()["health"], "verified")
        self.assertRegex(self.status()["deployedAt"], r"^\d{4}-\d{2}-\d{2}T[\d:]{8}Z$")
        with self.assertRaisesRegex(m.Refused, "ALREADY_ATTEMPTED"):
            self.run_apply()
        self.assertEqual(self.host.calls, ["stop", "replace", "start"])

    def test_failed_health_restores_exact_prior(self):
        self.host.health_failure = True
        with self.assertRaisesRegex(m.Refused, "FAILED_ROLLBACK_VERIFIED"):
            self.run_apply()
        self.assertEqual(self.host.read_plist(), self.host.prior)
        self.assertEqual(self.status(), {"state": "rolled-back"})

    def test_unverified_rollback_never_claims_success(self):
        self.host.health_failure = self.host.rollback_failure = True
        with self.assertRaisesRegex(m.Refused, "ROLLBACK_UNVERIFIED"):
            self.run_apply()
        self.assertEqual(self.status(), {"state": "rollback-failed"})

    def test_git_ci_branch_and_two_proof_files_must_match(self):
        self.prov["artifactId"] = "404"
        self.publish()
        with self.assertRaisesRegex(m.Refused, "WORKFLOW_NOT_VERIFIED"):
            self.run_apply()
        self.assertFalse(self.host.calls)

    def test_archive_hash_blocks_change_before_bootout(self):
        archive = self.folder / "ngs-local.tar"
        archive.write_bytes(archive.read_bytes() + b"extra")
        with self.assertRaisesRegex(m.Refused, "ARCHIVE_DRIFT"):
            self.run_apply()
        self.assertFalse(self.host.calls)

    def test_dependency_tree_blocks_change_before_bootout(self):
        (self.host.new / "local-miniflare/node_modules/module.js").write_text("unaudited")
        with self.assertRaisesRegex(m.Refused, "TREE_DRIFT"):
            self.run_apply()
        self.assertFalse(self.host.calls)

    def test_durable_prior_from_interruption_blocks_repeat(self):
        (self.folder / "prior.plist").write_bytes(self.host.prior)
        with self.assertRaisesRegex(m.Refused, "ALREADY_ATTEMPTED"):
            self.run_apply()
        self.assertFalse(self.host.calls)

    def test_user_selector_is_not_a_path_or_command(self):
        with self.assertRaisesRegex(m.Refused, "INVALID_RELEASE_SHA"):
            self.run_apply("../apply-space")
        self.assertFalse(self.host.calls)

    def test_global_lock_cannot_be_bypassed(self):
        fd = os.open(self.control, os.O_RDONLY)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):
                self.run_apply()
        finally:
            os.close(fd)
        self.assertFalse(self.host.calls)

    def test_missing_locked_dependencies_never_bootout(self):
        (self.host.new / "local-miniflare/node_modules/miniflare/package.json").unlink()
        self.spec["treeSha256"] = m.tree_sha(self.host.new)
        self.publish()
        with self.assertRaisesRegex(m.Refused, "DEPENDENCIES_NOT_READY"):
            self.run_apply()
        self.assertFalse(self.host.calls)

    def test_existing_schema_migration_is_outside_scope(self):
        (self.host.old / "dev/0015_replica_sync_progress.sql").write_text("old compatible schema only")
        with self.assertRaisesRegex(m.Refused, "STORAGE_STARTUP_INPUTS_CHANGED"):
            self.run_apply()
        self.assertFalse(self.host.calls)

if __name__ == "__main__":
    unittest.main()
