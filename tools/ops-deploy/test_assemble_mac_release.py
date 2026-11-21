import io
import json
from pathlib import Path
import plistlib
import tarfile
import tempfile
import unittest

import assemble_mac_release as a


class AssemblyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.repo = Path(__file__).resolve().parents[2]

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name).resolve()
        self.control, self.releases, self.scratch = (self.root / s for s in ("control", "releases", "scratch"))
        for p in (self.control, self.releases, self.scratch):
            p.mkdir(mode=0o700)
        self.old = self.releases / "project-page-github-f36ed84"
        self.old.mkdir(mode=0o700)
        self.files = {n.as_posix(): (self.repo / "ngs-local" / n).read_bytes() for n in a.STARTUP}
        self.head = "f" * 40
        self.source = self.releases / ("project-page-github-" + self.head)
        self.prior = self.root / "com.vinus.ngs.local-mcp.plist"
        self.prior.write_bytes(plistlib.dumps({"test": "previous exact selector"}))
        self.prior_hash = a.digest(self.prior.read_bytes())
        for name, data in self.files.items():
            target = self.old / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        self.calls = 0

    def pack(self, surprise=None):
        src = {**self.files, "source-manifest.json": json.dumps({
            "files": {n: a.digest(v) for n, v in self.files.items()}}).encode()}
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w") as t:
            for n, v in src.items():
                item = tarfile.TarInfo(n)
                item.size = len(v)
                t.addfile(item, io.BytesIO(v))
            if surprise:
                t.addfile(surprise)
        raw = buf.getvalue()
        return {"head": self.head, "raw": raw, "files": src,
                "evidence": {"archiveSha256": a.digest(raw)}}

    def installer(self, tree, *args):
        self.calls += 1
        pkgs = json.loads((tree / "local-miniflare/package-lock.json").read_bytes())["packages"]
        for n, v in pkgs.items():
            if not n:
                continue
            p = tree / "local-miniflare" / n / "package.json"
            p.parent.mkdir(parents=True)
            p.write_text(json.dumps({"version": v["version"]}))

    def assemble(self, verified=None, install=None):
        return a.assemble_verified(verified or self.pack(), control=self.control, releases=self.releases,
            scratch=self.scratch, prior_plist=self.prior, expected_prior_sha256=self.prior_hash,
            node=self.root / "node", npm_cache=self.root / "npm", _prior=lambda *args: self.old,
            _install=install or self.installer)

    def test_exact_unselected_assembly_and_no_duplicate(self):
        source, scratch = self.assemble()
        self.assertEqual(source, self.source)
        self.assertEqual(scratch, self.scratch / self.head)
        self.assertEqual((source / a.ENTRY).read_bytes(), self.files[a.ENTRY.as_posix()])
        self.assertEqual(self.prior_hash, a.digest(self.prior.read_bytes()))
        self.assertFalse((self.control / "prepared.json").exists())
        with self.assertRaisesRegex(a.AssemblyError, "ALREADY_EXISTS"):
            self.assemble()
        self.assertEqual(self.calls, 1)

    def test_traversal_links_and_duplicate_rejected_before_install(self):
        cases = (tarfile.TarInfo("../outside.txt"), tarfile.TarInfo("/outside.txt"),
                 tarfile.TarInfo(a.ENTRY.as_posix()))
        symlink = tarfile.TarInfo("sites/npcgen/build/other.mjs")
        symlink.type = tarfile.SYMTYPE
        symlink.linkname = "/etc/passwd"
        for case in (*cases, symlink):
            with self.subTest(name=case.name):
                with self.assertRaises(a.AssemblyError):
                    self.assemble(self.pack(case))
                self.assertFalse(self.source.exists())
        self.assertEqual(self.calls, 0)

    def test_github_archive_digest_is_required(self):
        doc = self.pack()
        doc["evidence"]["archiveSha256"] = "0" * 64
        with self.assertRaisesRegex(a.AssemblyError, "VERIFIED_ARCHIVE_CHANGED"):
            self.assemble(doc)
        self.assertFalse(self.source.exists())

    def test_package_lock_cannot_select_external_registry(self):
        lock = a.STARTUP[-2].as_posix()
        raw = self.files[lock].replace(b"https://registry.npmjs.org/", b"https://unapproved.invalid/", 1)
        self.files[lock] = raw
        (self.old / lock).write_bytes(raw)
        with self.assertRaisesRegex(a.AssemblyError, "NPM_ORIGIN_DENIED"):
            self.assemble()
        self.assertEqual(self.calls, 0)

    def test_candidate_cannot_change_native_schema(self):
        self.files["dev/0015_replica_sync_progress.sql"] += b"\n-- changed startup\n"
        with self.assertRaisesRegex(a.AssemblyError, "RUNTIME_CHANGE_OUTSIDE_SCOPE"):
            self.assemble()
        self.assertEqual(self.calls, 0)

    def test_selector_during_install_does_not_make_ready(self):
        def changed(*args):
            self.installer(*args)
            self.prior.write_bytes(b"changed")
        with self.assertRaisesRegex(a.AssemblyError, "PRIOR_SELECTOR_CHANGED"):
            self.assemble(install=changed)
        self.assertFalse(self.source.exists())
        self.assertFalse((self.scratch / self.head).exists())
        self.assertEqual(list(self.releases.iterdir()), [self.old])

    def test_install_does_not_endorse_rewritten_archived_source(self):
        def changed(tree, *args):
            self.installer(tree, *args)
            (tree / a.ENTRY).write_bytes(b"changed")
        with self.assertRaisesRegex(a.AssemblyError, "INSTALLED_SOURCE_CHANGED"):
            self.assemble(install=changed)
        self.assertFalse(self.source.exists())

if __name__ == "__main__":
    unittest.main()
