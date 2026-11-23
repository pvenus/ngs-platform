import importlib.machinery
import fcntl
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import Mock, patch

m = importlib.machinery.SourceFileLoader("mac_apply", str(Path(__file__).with_name("ngs-mac-apply"))).load_module()
SHA = "d" * 40
ATTEMPT_A = "a" * 32
ATTEMPT_B = "b" * 32


class FixedPaths(unittest.TestCase):
    def test_control_belongs_to_ops_and_app_paths_stay_with_ngs(self):
        self.assertEqual(m.CONTROL, Path.home() / "Workspaces/OPS/runtime/deploy-control")
        self.assertEqual(m.Mac.releases, Path.home() / "Workspaces/NGS/code/releases")
        self.assertEqual(m.Mac.scratch, Path.home() / "Workspaces/NGS/runtime/local-miniflare-execution")


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
        self.assertEqual(plistlib.loads(self.host.raw)["EnvironmentVariables"],
                         {**plistlib.loads(self.host.prior)["EnvironmentVariables"], "NGS_COMMIT_SHA": SHA})
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
        self.assertEqual(self.status(), {"state": "rolled-back", "failure": {
            "stage": "check_candidate", "code": "NATIVE_HEALTH_UNVERIFIED"}})
        original_status = self.status()
        with self.assertRaisesRegex(m.Refused, "ALREADY_ATTEMPTED"):
            self.run_apply()
        self.assertEqual(self.status(), original_status)

    def test_unverified_rollback_never_claims_success(self):
        self.host.health_failure = self.host.rollback_failure = True
        with self.assertRaisesRegex(m.Refused, "ROLLBACK_UNVERIFIED"):
            self.run_apply()
        self.assertEqual(self.status(), {"state": "rollback-failed",
            "failure": {"stage": "check_candidate", "code": "NATIVE_HEALTH_UNVERIFIED"},
            "rollbackFailure": {"stage": "rollback_check", "code": "NATIVE_HEALTH_UNVERIFIED"}})

    def test_bootout_failure_preserves_stage_and_hides_child_output(self):
        error = subprocess.CalledProcessError(5, ["/sensitive/path"], output="TOP_SECRET")
        with patch.object(self.host, "bootout", side_effect=error):
            with self.assertRaises(m.ApplyFailed) as raised:
                self.run_apply()
        failure = {"stage": "stop_current", "code": "MAC_BOOTOUT_FAILED"}
        self.assertEqual(self.status(), {"state": "rolled-back", "failure": failure})
        self.assertEqual(m.error_record(raised.exception), {
            "schemaVersion": "ops.ngs-mac-apply-error.v1", "failure": failure})
        self.assertEqual(self.host.read_plist(), self.host.prior)

    def test_delayed_release_waits_for_both_ports_before_switching(self):
        old_pid = self.host.current
        with patch.object(self.host, "listener", side_effect=[
            {old_pid}, {old_pid}, set(), {old_pid}, set(), set(),
        ]) as listener, patch.object(m.time, "monotonic", side_effect=[0, 0, 0.25]), \
                patch.object(m.time, "sleep") as sleep:
            sleep.side_effect = lambda _seconds: self.assertEqual(self.host.calls, ["stop"])
            self.run_apply()
        self.assertEqual([call.args[0] for call in listener.call_args_list], [5274, 5275] * 3)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [0.25, 0.25])
        self.assertEqual(self.host.calls, ["stop", "replace", "start"])

    def test_rollback_waits_for_prior_pid_to_release_after_forward_deadline(self):
        old = {self.host.current}
        with patch.object(self.host, "listener", side_effect=[
            old, old, old, old,  # forward wait reaches its deadline
            old, set(), set(), set(),  # only the old PID remains, then both ports close
        ]), patch.object(m.time, "monotonic", side_effect=[0, 9.9, 10, 10, 10.25]), \
                patch.object(m.time, "sleep") as sleep:
            sleep.side_effect = lambda _seconds: self.assertEqual(self.host.calls, ["stop"])
            with self.assertRaises(m.ApplyFailed):
                self.run_apply()
        self.assertAlmostEqual(sleep.call_args_list[0].args[0], 0.1)
        self.assertEqual(sleep.call_args_list[1].args[0], 0.25)
        self.assertEqual(self.host.calls, ["stop", "start"])
        self.assertEqual(self.host.read_plist(), self.host.prior)
        self.assertEqual(self.status(), {"state": "rolled-back", "failure": {
            "stage": "wait_ports", "code": "OLD_NATIVE_PORTS_BUSY"}})

    def test_prior_ports_still_busy_at_rollback_deadline_never_bootstraps(self):
        with patch.object(self.host, "listener", return_value={self.host.current}), \
                patch.object(m.time, "monotonic", side_effect=[0, 10, 10, 19.75, 20]), \
                patch.object(m.time, "sleep") as sleep:
            with self.assertRaises(m.ApplyFailed):
                self.run_apply()
        sleep.assert_called_once_with(0.25)
        self.assertEqual(self.host.calls, ["stop"])
        self.assertEqual(self.host.read_plist(), self.host.prior)
        self.assertEqual(self.status(), {"state": "rollback-failed",
            "failure": {"stage": "wait_ports", "code": "OLD_NATIVE_PORTS_BUSY"},
            "rollbackFailure": {"stage": "rollback_stop", "code": "OLD_NATIVE_PORTS_BUSY"}})

    def test_foreign_listener_refuses_rollback_without_wait_or_bootstrap(self):
        with patch.object(self.host, "listener", side_effect=[
            {self.host.current}, {222}, set(), {222},
        ]), patch.object(m.time, "sleep") as sleep:
            with self.assertRaises(m.ApplyFailed):
                self.run_apply()
        sleep.assert_not_called()
        self.assertEqual(self.host.calls, ["stop"])
        self.assertEqual(self.host.read_plist(), self.host.prior)
        self.assertEqual(self.status(), {"state": "rollback-failed",
            "failure": {"stage": "wait_ports", "code": "OLD_NATIVE_PORTS_BUSY"},
            "rollbackFailure": {"stage": "rollback_stop", "code": "NATIVE_PORT_OWNER_DRIFT"}})

    def test_generic_rollback_error_is_selected_from_phase(self):
        with patch.object(self.host, "bootstrap", side_effect=OSError("/sensitive/path")):
            with self.assertRaises(m.ApplyFailed):
                self.run_apply()
        self.assertEqual(self.status(), {"state": "rollback-failed",
            "failure": {"stage": "start_candidate", "code": "MAC_BOOTSTRAP_FAILED"},
            "rollbackFailure": {"stage": "rollback_start", "code": "MAC_BOOTSTRAP_FAILED"}})

    def test_selector_failure_after_change_restores_prior(self):
        replace = self.host.replace
        def after_replace(prior, new):
            replace(prior, new)
            if new != self.host.prior:
                raise OSError("/sensitive/path")
        with patch.object(self.host, "replace", side_effect=after_replace):
            with self.assertRaises(m.ApplyFailed):
                self.run_apply()
        self.assertEqual(self.status(), {"state": "rolled-back", "failure": {
            "stage": "switch_selector", "code": "MAC_SELECTOR_SWITCH_FAILED"}})
        self.assertEqual(self.host.read_plist(), self.host.prior)

    def test_storage_drift_has_distinct_phase(self):
        with patch.object(self.host, "unchanged", side_effect=[1, 2, 1]):
            with self.assertRaises(m.ApplyFailed):
                self.run_apply()
        self.assertEqual(self.status(), {"state": "rolled-back", "failure": {
            "stage": "check_storage", "code": "NATIVE_STORAGE_IDENTITY_DRIFT"}})

    def test_unwritable_result_does_not_mask_initial_failure(self):
        self.host.health_failure = True
        atom = m.atom
        def fail_result(path, *args, **kwargs):
            if path.name == "result.json":
                raise OSError("/sensitive/path")
            atom(path, *args, **kwargs)
        with patch.object(m, "atom", side_effect=fail_result):
            with self.assertRaises(m.ApplyFailed) as raised:
                self.run_apply()
        self.assertFalse((self.folder / "result.json").exists())
        self.assertEqual(raised.exception.failure,
                         {"stage": "check_candidate", "code": "NATIVE_HEALTH_UNVERIFIED"})
        self.assertEqual(self.host.read_plist(), self.host.prior)

    def seed_legacy_rollback(self):
        m.atom(self.folder / "prior.plist", self.host.prior, create=True)
        m.atom(self.folder / "result.json", b'{"state":"rolled-back"}\n', create=True)

    def run_retry(self, attempt=ATTEMPT_A, previous="initial"):
        return m.apply(SHA, self.control, self.host, attempt, previous)

    def attempt_path(self, attempt=ATTEMPT_A):
        return self.folder / "attempts" / attempt

    def test_retry_from_legacy_rollback_preserves_first_receipt_and_success_contract(self):
        self.seed_legacy_rollback()
        self.assertEqual(self.run_retry(), {"sha": SHA, "target": "mac", "state": "deployed", "health": "verified"})
        self.assertEqual((self.folder / "result.json").read_bytes(), b'{"state":"rolled-back"}\n')
        self.assertEqual((self.folder / "prior.plist").read_bytes(), self.host.prior)
        self.assertEqual((self.attempt_path() / "prior.plist").read_bytes(), self.host.prior)
        self.assertEqual(json.loads((self.attempt_path() / "result.json").read_bytes())["state"], "deployed")
        self.assertEqual(json.loads((self.attempt_path().parent / "current.json").read_bytes()),
                         {"attemptIds": [ATTEMPT_A]})

    def test_retry_previous_is_bound_and_prior_receipts_are_preserved(self):
        self.seed_legacy_rollback()
        self.host.health_failure = True
        with self.assertRaisesRegex(m.Refused, "FAILED_ROLLBACK_VERIFIED"):
            self.run_retry()
        receipt = (self.attempt_path() / "result.json").read_bytes()
        calls = self.host.calls[:]
        with self.assertRaisesRegex(m.Refused, "MAC_RETRY_PARENT_DRIFT"):
            self.run_retry(ATTEMPT_B, "initial")
        with self.assertRaisesRegex(m.Refused, "MAC_RETRY_ATTEMPT_EXISTS"):
            self.run_retry(ATTEMPT_A, ATTEMPT_A)
        self.assertEqual(self.host.calls, calls)
        self.host.health_failure = False
        self.run_retry(ATTEMPT_B, ATTEMPT_A)
        self.assertEqual((self.attempt_path() / "result.json").read_bytes(), receipt)
        self.assertEqual(json.loads((self.attempt_path().parent / "current.json").read_bytes()),
                         {"attemptIds": [ATTEMPT_A, ATTEMPT_B]})

    def test_retry_blocked_by_rollback_failed_or_incomplete_latest(self):
        self.seed_legacy_rollback()
        self.host.health_failure = self.host.rollback_failure = True
        with self.assertRaisesRegex(m.Refused, "ROLLBACK_UNVERIFIED"):
            self.run_retry()
        calls = self.host.calls[:]
        with self.assertRaisesRegex(m.Refused, "MAC_RETRY_ROLLBACK_REQUIRED"):
            self.run_retry(ATTEMPT_B, ATTEMPT_A)
        (self.attempt_path() / "result.json").unlink()
        with self.assertRaisesRegex(m.Refused, "MAC_RETRY_ROLLBACK_REQUIRED"):
            self.run_retry(ATTEMPT_B, ATTEMPT_A)
        self.assertEqual(self.host.calls, calls)

    def test_retry_blocked_by_incomplete_initial_and_unhealthy_prior(self):
        prior = self.folder / "prior.plist"
        m.atom(prior, self.host.prior, create=True)
        with self.assertRaisesRegex(m.Refused, "MAC_RETRY_ROLLBACK_REQUIRED"):
            self.run_retry()
        m.atom(self.folder / "result.json", b'{"state":"rolled-back"}\n', create=True)
        with patch.object(self.host, "healthy", side_effect=m.Refused("NATIVE_QUEUE_UNAVAILABLE")):
            with self.assertRaisesRegex(m.Refused, "NATIVE_QUEUE_UNAVAILABLE"):
                self.run_retry()
        self.assertFalse(self.host.calls)
        self.assertFalse(self.attempt_path().parent.exists())

    def test_retry_archived_prior_must_match_current_bytes(self):
        self.seed_legacy_rollback()
        m.atom(self.folder / "prior.plist", self.host.prior + b"drift")
        with self.assertRaisesRegex(m.Refused, "MAC_RETRY_PRIOR_DRIFT"):
            self.run_retry()
        self.assertFalse(self.host.calls)
        self.assertFalse(self.attempt_path().parent.exists())

    def test_retry_revalidates_archive_despite_verified_rollback(self):
        self.seed_legacy_rollback()
        archive = self.folder / "ngs-local.tar"
        archive.write_bytes(archive.read_bytes() + b"extra")
        with self.assertRaisesRegex(m.Refused, "ARCHIVE_DRIFT"):
            self.run_retry()
        self.assertFalse(self.host.calls)

    def test_retry_rejects_torn_reservation_and_unsafe_ids(self):
        self.seed_legacy_rollback()
        with self.assertRaisesRegex(m.Refused, "MAC_RETRY_ID_INVALID"):
            self.run_retry("../x", "initial")
        with self.assertRaisesRegex(m.Refused, "MAC_RETRY_ID_INVALID"):
            self.run_retry(ATTEMPT_A, "0" * 32)
        self.attempt_path().parent.mkdir(mode=0o700)
        self.attempt_path().mkdir(mode=0o700)
        with self.assertRaisesRegex(m.Refused, "MAC_RETRY_HISTORY_INVALID"):
            self.run_retry(ATTEMPT_B)
        self.assertFalse(self.host.calls)

    def test_retry_cannot_pass_if_another_attempt_holds_lock_even_before_validation(self):
        self.seed_legacy_rollback()
        fd = os.open(self.control, os.O_RDONLY)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(m.Refused, "MAC_DEPLOY_LOCK_BUSY"):
                self.run_retry()
        finally:
            os.close(fd)
        self.assertFalse(self.host.calls)
        self.assertFalse(self.attempt_path().parent.exists())

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
            with self.assertRaisesRegex(m.Refused, "MAC_DEPLOY_LOCK_BUSY"):
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

class Diagnostic(unittest.TestCase):
    def test_cli_invalid_input_outputs_one_safe_json_line(self):
        run = subprocess.run([sys.executable, m.__file__, "/sensitive/path"],
                             capture_output=True, text=True)
        self.assertEqual(run.returncode, 1)
        self.assertEqual(run.stdout, "")
        self.assertEqual(len(run.stderr.splitlines()), 1)
        self.assertEqual(json.loads(run.stderr), {"schemaVersion": "ops.ngs-mac-apply-error.v1",
                         "failure": {"stage": "validate_candidate", "code": "INVALID_RELEASE_SHA"}})

    def test_health_retains_last_known_code_even_after_generic_transport_error(self):
        host = m.Mac()
        host.pid = Mock(return_value=22)
        host.listener = Mock(return_value={22})
        host.run = Mock(return_value="node /tmp/release/" + str(m.ENTRY))
        host.http = Mock(side_effect=[(503, None, {}), OSError("/sensitive/path")])
        with patch.object(m.time, "monotonic", side_effect=[0, 1, 2]), patch.object(m.time, "sleep"):
            with self.assertRaisesRegex(m.Refused, "^NATIVE_AUTH_UNAVAILABLE$"):
                host.healthy(Path("/tmp/release"), wait=2)

    def test_unknown_refused_string_is_not_a_public_code(self):
        self.assertEqual(m.diagnostic("check_candidate", m.Refused("UNRECOGNIZED_INPUT")),
                         {"stage": "check_candidate", "code": "NATIVE_HEALTH_UNVERIFIED"})


if __name__ == "__main__":
    unittest.main()
