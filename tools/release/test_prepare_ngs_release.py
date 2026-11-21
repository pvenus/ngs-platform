import importlib.util
import io
import json
from pathlib import Path
from subprocess import CalledProcessError
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("producer", Path(__file__).with_name("prepare-ngs-release.py"))
producer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(producer)


class CandidateTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.local = self.root / "ngs-local"
        self.local.mkdir()
        (self.local / "README.md").write_bytes(b"source fixture\n")
        (self.local / "source-manifest.json").write_text(
            json.dumps({"sourceCommit": None, "files": {"README.md": producer.sha256(b"source fixture\n")}})
        )
        overlay = self.root / producer.OVERLAY
        overlay.mkdir(parents=True)
        (overlay / "test.mjs").write_text("export {};\n")
        producer.git(self.root, "init", "-q")
        self.commit()
        self.env = {
            "GITHUB_REPOSITORY": producer.REPOSITORY,
            "GITHUB_REF": producer.REF,
            "GITHUB_EVENT_NAME": "push",
            "GITHUB_WORKFLOW_REF": producer.REPOSITORY + "/" + producer.WORKFLOW + "@" + producer.REF,
            "GITHUB_SHA": self.head,
            "GITHUB_RUN_ID": "12345",
            "GITHUB_RUN_ATTEMPT": "1",
        }

    def commit(self):
        producer.git(self.root, "add", "ngs-local", producer.OVERLAY)
        producer.git(self.root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                     "commit", "-qm", "Fixture source")
        self.head = producer.text(producer.git(self.root, "rev-parse", "HEAD"))

    def run_pack(self, out, **other):
        return producer.prepare(self.root, self.root / out, {**self.env, **other}, "v" + producer.NODE)

    def test_exact_local_archive_is_reproducible_and_space_is_a_tree_reference_only(self):
        (self.local / "untracked.txt").write_text("not in package")
        first = self.run_pack("first")
        second = self.run_pack("second")
        path = self.root / "first" / producer.ARCHIVE
        self.assertEqual(first, second)
        self.assertEqual(path.read_bytes(), (self.root / "second" / producer.ARCHIVE).read_bytes())
        self.assertEqual(first["headSha"], self.head)
        self.assertEqual(first["archive"]["sha256"], producer.sha256(path.read_bytes()))
        self.assertEqual(first["archive"]["bytes"], path.stat().st_size)
        self.assertEqual(first["spaceOverlay"]["validation"], "source-only")
        self.assertEqual(first, json.loads((self.root / "first" / "release.json").read_text()))
        with tarfile.open(fileobj=io.BytesIO(path.read_bytes())) as tar:
            self.assertEqual(sorted(m.name for m in tar if m.isfile()),
                             ["README.md", "source-manifest.json"])

    def test_main_event_exact_workflow_and_checked_out_commit(self):
        for field, value in (
            ("GITHUB_REPOSITORY", "someone/fork"), ("GITHUB_REF", "refs/heads/feature"),
            ("GITHUB_EVENT_NAME", "pull_request"), ("GITHUB_WORKFLOW_REF", ".github/workflows/other.yml"),
            ("GITHUB_SHA", "f" * 40), ("GITHUB_RUN_ATTEMPT", "0"),
        ):
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "untrusted"):
                self.run_pack("bad", **{field: value})
        self.assertFalse((self.root / "bad").exists())

    def test_refuses_changed_source_manifest_symlink_or_private_candidate_paths(self):
        (self.local / "README.md").write_bytes(b"changed\n")
        with self.assertRaises(CalledProcessError):
            self.run_pack("dirty")
        self.commit()
        self.env["GITHUB_SHA"] = self.head
        with self.assertRaisesRegex(ValueError, "manifest differs"):
            self.run_pack("mismatch")
        secret = self.local / "dev" / "runtime.private.json"
        secret.parent.mkdir()
        secret.write_text("{}")
        self.commit()
        self.env["GITHUB_SHA"] = self.head
        with self.assertRaisesRegex(ValueError, "unexpected file"):
            self.run_pack("not_allowed")
        secret.unlink()
        symlink = self.local / "dev" / "source.json"
        symlink.symlink_to("../README.md")
        self.commit()
        self.env["GITHUB_SHA"] = self.head
        with self.assertRaisesRegex(ValueError, "unexpected file"):
            self.run_pack("symlink")


if __name__ == "__main__":
    unittest.main()
