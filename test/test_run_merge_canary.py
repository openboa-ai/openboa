"""Offline reporting tests: real Git layouts, transport budgets and owned processes."""

import argparse
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import urllib.error
import zipfile

SPEC = importlib.util.spec_from_file_location("reporter", Path(__file__).parents[1] / "scripts/run-merge-canary.py")
R = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(R)
SHA = "a" * 40
PREFIX = "/repos/openboa-ai/openboa"


def context(revision=SHA):
    return {"GITHUB_REPOSITORY": R.REPOSITORY["fullName"], "GITHUB_REPOSITORY_ID": str(R.REPOSITORY["id"]),
            "GITHUB_EVENT_NAME": "schedule", "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": revision,
            "GITHUB_WORKFLOW_SHA": revision, "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1",
            "GITHUB_RUN_NUMBER": "1"}


def event():
    return {"repository": {"id": R.REPOSITORY["id"], "full_name": R.REPOSITORY["fullName"],
                           "default_branch": "main"}}


def pull(number):
    repo = {"id": R.REPOSITORY["id"], "full_name": R.REPOSITORY["fullName"]}
    return {"id": 1000 + number, "number": number, "state": "open", "base": {"ref": "main", "repo": repo},
            "head": {"repo": dict(repo)}}


def zip_bytes(size=20):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("receipt.json", b"x" * size)
    return output.getvalue()


class GitLayoutTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="canary-git-layout-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "controller"
        self.root.mkdir()
        self.evaluator = self.root / ".merge-evaluator"
        self.evaluator.mkdir()
        self.git_init(self.evaluator)
        module = self.evaluator / "lib/evaluate-merge-evidence.mjs"
        module.parent.mkdir()
        module.write_text("export function evaluateMergeEvidence() {}\n")
        self.commit(self.evaluator)
        evaluator = {**R.EVALUATOR, "revision": self.git(self.evaluator, "rev-parse", "HEAD"),
                     "sha256": R.C.digest(module.read_bytes())}
        self.patch_evaluator = patch.object(R, "EVALUATOR", evaluator)
        self.patch_evaluator.start()
        self.addCleanup(self.patch_evaluator.stop)
        self.policy = json.loads((R.ROOT / R.POLICY_PATH).read_text())
        self.policy["evaluator"] = evaluator
        self.policy_bytes = (json.dumps(self.policy) + "\n").encode()
        (self.root / ".github").mkdir()
        (self.root / R.POLICY_PATH).write_bytes(self.policy_bytes)
        (self.root / "README.md").write_text("fixture\n")
        self.git_init(self.root)
        self.git(self.root, "add", ".github", "README.md")
        self.git(self.root, "commit", "-qm", "fixture controller")
        self.context = context(self.git(self.root, "rev-parse", "HEAD"))

    def git(self, directory, *arguments):
        return subprocess.check_output(["git", "-C", str(directory), *arguments], stderr=subprocess.DEVNULL).decode().strip()

    def git_init(self, directory):
        self.git(directory, "init", "-q")
        self.git(directory, "config", "user.name", "Fixture")
        self.git(directory, "config", "user.email", "fixture@example.invalid")

    def commit(self, directory):
        self.git(directory, "add", ".")
        self.git(directory, "commit", "-qm", "fixture evaluator")

    def validate(self, policy=None, event_value=None, context_value=None):
        return R.validate_controller(policy or self.policy, self.policy_bytes,
                                     event_value or event(), context_value or self.context,
                                     self.root, time.monotonic() + 10)

    def test_real_nested_checkout_is_the_only_permitted_untracked_root(self):
        for name in ("schedule", "workflow_dispatch"):
            selected = {**self.context, "GITHUB_EVENT_NAME": name}
            actual_event = event()
            if name == "workflow_dispatch":
                actual_event["inputs"] = {}
            self.assertEqual(self.validate(event_value=actual_event, context_value=selected), R.context_identity(selected))
        self.assertEqual(self.git(self.root, "status", "--porcelain"), "?? .merge-evaluator/")
        self.assertFalse(list(self.root.rglob("__pycache__")))

    def test_untracked_or_ignored_executable_source_is_rejected(self):
        source = self.root / "untrusted.py"
        source.write_text("raise RuntimeError('never execute')\n")
        with self.assertRaisesRegex(R.C.EvidenceError, "controller_checkout_dirty"):
            self.validate()
        source.unlink()
        (self.root / ".gitignore").write_text("untrusted.py\n")
        self.git(self.root, "add", ".gitignore")
        self.git(self.root, "commit", "-qm", "fixture ignore")
        self.context = context(self.git(self.root, "rev-parse", "HEAD"))
        source.write_text("raise RuntimeError('still never execute')\n")
        with self.assertRaisesRegex(R.C.EvidenceError, "controller_checkout_dirty"):
            self.validate()

    def test_dirty_controller_or_evaluator_cannot_be_used(self):
        for target in (self.root / "README.md", self.evaluator / "lib/evaluate-merge-evidence.mjs"):
            original = target.read_bytes()
            target.write_bytes(original + b"modified\n")
            with self.assertRaises(R.C.EvidenceError):
                self.validate()
            target.write_bytes(original)
        (self.evaluator / "untracked.mjs").write_text("throw 1\n")
        with self.assertRaisesRegex(R.C.EvidenceError, "evaluator_checkout_dirty"):
            self.validate()

    def test_wrong_revision_module_digest_and_symlink_are_rejected(self):
        with patch.dict(R.EVALUATOR, revision="f" * 40):
            with self.assertRaises(R.C.EvidenceError):
                self.validate()
        with patch.dict(R.EVALUATOR, sha256="0" * 64):
            with self.assertRaises(R.C.EvidenceError):
                self.validate()
        moved = self.root.parent / "moved-evaluator"
        self.evaluator.rename(moved)
        self.evaluator.symlink_to(moved, target_is_directory=True)
        with self.assertRaisesRegex(R.C.EvidenceError, "symlink_path_rejected"):
            self.validate()

    def test_context_denials_occur_without_any_api(self):
        mutations = [("GITHUB_REPOSITORY", "other/project"), ("GITHUB_REPOSITORY_ID", "7"),
                     ("GITHUB_EVENT_NAME", "workflow_run"), ("GITHUB_REF", "refs/heads/other"),
                     ("GITHUB_SHA", SHA), ("GITHUB_WORKFLOW_SHA", SHA), ("GITHUB_RUN_NUMBER", "0")]
        for key, value in mutations:
            with self.subTest(key=key):
                with self.assertRaises(R.C.EvidenceError):
                    self.validate(context_value={**self.context, key: value})
        for changed in [{**event(), "inputs": {"activate": "true"}},
                        {"repository": {**event()["repository"], "id": 7}}]:
            with self.assertRaises(R.C.EvidenceError):
                self.validate(event_value=changed)
        with self.assertRaises(R.C.EvidenceError):
            self.validate(policy={**self.policy, "mode": "merge"})


class Response:
    status = 200

    def __init__(self, raw, after_read=None):
        self.raw, self.after_read, self.sizes = raw, after_read, []

    def read(self, size):
        self.sizes.append(size)
        if self.after_read:
            self.after_read()
        result, self.raw = self.raw[:size], self.raw[size:]
        return result

    def close(self):
        pass


class Opener:
    def __init__(self, responses):
        self.responses, self.calls = list(responses), []

    def open(self, request, timeout):
        self.calls.append({"url": request.full_url, "method": request.method,
                           "authorization": request.get_header("Authorization"), "timeout": timeout})
        value = self.responses.pop(0)
        if callable(value):
            value = value()
        if isinstance(value, Exception):
            raise value
        return value


def redirect():
    return urllib.error.HTTPError("https://api.github.com/fixture", 302, "redirect",
                                  {"Location": "https://fixture.blob.core.windows.net/object?sig=fixture"}, io.BytesIO())


class BudgetTests(unittest.TestCase):
    def api(self, responses, limits=None, clock=time.monotonic, deadline=None):
        opener = Opener(responses)
        api = R.ReporterAPI(R.REPOSITORY["fullName"], "fixture-token", limits or {},
                            deadline if deadline is not None else clock() + 20, opener, clock)
        return api, opener

    def test_discovery_json_and_both_zip_hops_share_budget_and_auth_boundary(self):
        raw = zip_bytes()
        body = b'{"fixture":true}'
        api, opener = self.api([Response(body), redirect(), Response(raw)])
        self.assertEqual(api.get(PREFIX + "/pulls"), {"fixture": True})
        self.assertEqual(api.download_artifact(1), raw)
        self.assertEqual(api.budget.requests, 3)
        self.assertEqual(api.budget.bytes, len(body) + len(raw))
        self.assertEqual(api.budget.expanded, 20)
        self.assertEqual([c["authorization"] for c in opener.calls], ["Bearer fixture-token", "Bearer fixture-token", None])
        self.assertEqual({c["method"] for c in opener.calls}, {"GET"})
        self.assertNotIn("fixture-token", json.dumps(api.requests))
        self.assertNotIn("sig=fixture", json.dumps(api.requests))

    def test_combined_response_limit_charges_the_single_overflow_sentinel(self):
        raw = zip_bytes()
        body = b'{}'
        limit = len(body) + len(raw) - 1
        response = Response(raw)
        api, _ = self.api([Response(body), redirect(), response], {"jsonBytes": limit})
        api.get(PREFIX + "/pulls")
        with self.assertRaisesRegex(R.C.EvidenceError, "round_response_budget_exceeded"):
            api.download_artifact(1)
        self.assertEqual(api.budget.bytes, limit + 1)
        self.assertEqual(response.sizes, [len(raw)])
        self.assertEqual(api.budget.expanded, 0)

    def test_request_limit_covers_both_artifact_hops_and_later_json(self):
        api, opener = self.api([redirect(), Response(zip_bytes()), Response(b'{}')], {"requests": 2})
        api.download_artifact(1)
        with self.assertRaises(R.C.EvidenceError):
            api.get(PREFIX + "/pulls")
        self.assertEqual(len(opener.calls), 2)

    def test_partial_read_failure_poison_blocks_every_later_io(self):
        class PartialRead(Response):
            def read(self, size):
                self.sizes.append(size)
                self.raw = self.raw[2:]
                raise OSError("fixture partial read failure")
        response = PartialRead(b'{"fixture":true}')
        api, opener = self.api([response, Response(b'{}')], {"jsonBytes": 30})
        with self.assertRaises(R.C.EvidenceError):
            api.get(PREFIX + "/pulls")
        self.assertTrue(api.budget.poisoned)
        self.assertEqual(api.budget.failed_read_allowance, 31)
        self.assertFalse(api.budget.observation()["responseBytesComplete"])
        with self.assertRaisesRegex(R.C.EvidenceError, "round_response_accounting_unknown"):
            api.get(PREFIX + "/pulls")
        self.assertEqual(len(opener.calls), 1)

    def test_deadline_checked_after_redirect_and_after_read_and_timeout_clamped(self):
        clock = [0.0]
        def late_redirect():
            clock[0] = 5.0
            return redirect()
        api, opener = self.api([late_redirect, Response(zip_bytes())], clock=lambda: clock[0], deadline=1.0)
        with self.assertRaisesRegex(R.C.EvidenceError, "round_deadline_exceeded"):
            api.download_artifact(1)
        self.assertEqual(len(opener.calls), 1)
        self.assertLessEqual(opener.calls[0]["timeout"], 1.0)
        clock[0] = 0.0
        response = Response(b'{}', after_read=lambda: clock.__setitem__(0, 2.0))
        api, _ = self.api([response], clock=lambda: clock[0], deadline=1.0)
        with self.assertRaisesRegex(R.C.EvidenceError, "round_deadline_exceeded"):
            api.get(PREFIX + "/pulls")
        self.assertEqual(api.budget.bytes, 2)

    def test_expanded_limit_aggregates_before_any_member_decompression(self):
        raw = zip_bytes(100)
        api, _ = self.api([redirect(), Response(raw), redirect(), Response(raw)], {"expandedBytes": 150})
        api.download_artifact(1)
        with patch.object(zipfile.ZipFile, "read", side_effect=AssertionError("must not decompress")):
            with self.assertRaisesRegex(R.C.EvidenceError, "round_expanded_budget_exceeded"):
                api.download_artifact(2)
        self.assertEqual(api.budget.expanded, 100)

    def test_foreign_artifact_redirect_is_rejected_before_second_request(self):
        bad = redirect()
        bad.headers["Location"] = "https://untrusted.example.invalid/"
        api, opener = self.api([bad])
        with self.assertRaises(R.C.EvidenceError):
            api.download_artifact(1)
        self.assertEqual(len(opener.calls), 1)


class DiscoveryAPI:
    def __init__(self, pages, main=SHA):
        self.pages, self.main, self.requests = list(pages), main, []

    def get(self, route):
        self.requests.append({"route": route, "bodyDigest": "fixture"})
        if route.endswith("/git/ref/heads/main"):
            return {"object": {"sha": self.main}}
        if not self.pages:
            raise R.C.EvidenceError("fixture_incomplete_pagination")
        return self.pages.pop(0)


class DiscoveryTests(unittest.TestCase):
    def test_rotation_is_sorted_and_selects_one_without_claiming_other_results(self):
        for number in range(1, 5):
            api = DiscoveryAPI([[pull(n) for n in [4, 1, 3, 2]]])
            result = R.discover({}, {**context(), "GITHUB_RUN_NUMBER": str(number)}, api)
            self.assertEqual(result["eligible"], [1, 2, 3, 4])
            self.assertEqual(result["selected"], [number])
            self.assertEqual(len(result["deferred"]), 3)
            self.assertEqual(result["coverage"], "partial")

    def test_complete_pagination_and_explicit_foreign_invalid_exclusions(self):
        fork, wrong_base, closed, invalid = pull(5), pull(6), pull(7), pull(8)
        fork["head"]["repo"]["id"] = 99
        wrong_base["base"]["ref"] = "other"
        closed["state"] = "closed"
        invalid["number"] = "../../untrusted"
        result = R.discover({}, context(), DiscoveryAPI([[pull(1), fork, wrong_base, closed, invalid]]))
        self.assertEqual(result["selected"], [1])
        self.assertEqual(len(result["excluded"]), 4)
        self.assertEqual(result["excluded"][-1], {"number": None, "reason": "invalid_identity"})
        self.assertNotIn("untrusted", json.dumps(result))
        api = DiscoveryAPI([[pull(n) for n in range(100, 0, -1)], [pull(101)]])
        result = R.discover({}, context(), api)
        self.assertEqual(result["selected"], [1])
        self.assertEqual(len(result["eligible"]), 101)
        self.assertEqual(len(result["pages"]), 2)

    def test_duplicates_incomplete_pages_and_stale_main_deny_the_round(self):
        for api in [DiscoveryAPI([[pull(1), pull(1)]]), DiscoveryAPI([[pull(n) for n in range(1, 101)]]),
                    DiscoveryAPI([[pull(1)]], main="f" * 40)]:
            with self.assertRaises(R.C.EvidenceError):
                R.discover({}, context(), api)
        self.assertEqual(R.discover({}, context(), DiscoveryAPI([[]]))["coverage"], "empty")


class RoundLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="canary-round-")
        self.addCleanup(self.temporary.cleanup)
        self.parent = Path(self.temporary.name)
        self.output = self.parent / "round"
        self.identity = {**R.context_identity(context()), "identity": "1" * 32}

    def test_existing_positive_output_is_rejected_and_never_advertised_for_upload(self):
        self.output.mkdir()
        old = self.output / "summary.json"
        old.write_text('{"eligible":true,"round":"old"}')
        output_file = self.parent / "github-output"
        output_file.write_text("")
        with patch.dict(os.environ, {**context(), "GITHUB_OUTPUT": str(output_file)}, clear=True):
            with patch.object(sys, "argv", ["runner", "--event", "unused", "--output", str(self.output)]):
                with self.assertRaises(FileExistsError):
                    R.main()
        self.assertEqual(old.read_text(), '{"eligible":true,"round":"old"}')
        self.assertEqual(output_file.read_text(), "")

    def test_symlink_output_and_nonregular_input_are_rejected(self):
        real = self.parent / "real"
        real.mkdir()
        self.output.symlink_to(real, target_is_directory=True)
        with self.assertRaises(R.C.EvidenceError):
            R.prepare_output(self.output, self.identity)
        fifo = self.parent / "fifo"
        os.mkfifo(fifo)
        with self.assertRaises(R.C.EvidenceError):
            R.regular_bytes(fifo, 100)

    def handoff(self):
        R.prepare_output(self.output, self.identity)
        directory = self.output / R.STAGING / "2"
        directory.mkdir(parents=True)
        observation = {"round": self.identity, "collection": {"status": "blocked"}}
        report = {"round": self.identity, "mode": "report-only", "mergeAuthorized": False,
                  "result": {"eligible": False}}
        files = []
        for name, value in [("observations.json", observation), ("report.json", report)]:
            R.atomic_json(directory / name, value)
            files.append({"path": "2/" + name, "sha256": R.C.digest((directory / name).read_bytes())})
        summary = {"round": self.identity, "mode": "report-only", "mergeAuthorized": False,
                   "status": "completed", "coverage": "partial", "processed": [2],
                   "discovery": {"selected": [2], "deferred": [3]},
                   "selectedEvaluation": {"number": 2, "eligible": False}}
        value = {"round": self.identity, "summary": summary, "files": files}
        R.atomic_json(self.output / "worker-result.json", value)
        return value

    def test_current_round_files_are_published_only_after_complete_bound_handoff(self):
        self.handoff()
        self.assertFalse((self.output / "2").exists())
        summary = R.publish(self.output, self.identity, time.monotonic() + 5)
        self.assertEqual(summary["processed"], [2])
        self.assertTrue((self.output / "2/report.json").is_file())
        self.assertEqual(json.loads((self.output / "summary.json").read_text())["round"], self.identity)
        self.assertFalse((self.output / "worker-result.json").exists())

    def test_failure_after_ready_positive_handoff_removes_every_positive_intermediate(self):
        def ready_then_timeout(arguments, selected_context, deadline):
            identity = json.loads((self.output / "round.json").read_text())
            staging = self.output / R.STAGING / "2"
            staging.mkdir(parents=True)
            (staging / "report.json").write_text(json.dumps({"round": identity, "result": {"eligible": True}}))
            R.atomic_json(self.output / "worker-result.json", {"round": identity,
                "summary": {"selectedEvaluation": {"number": 2, "eligible": True}}})
            raise R.C.EvidenceError("round_watchdog_timeout")
        with patch.dict(os.environ, context(), clear=True):
            with patch.object(sys, "argv", ["runner", "--event", "unused", "--output", str(self.output)]):
                with patch.object(R, "supervise", side_effect=ready_then_timeout):
                    self.assertEqual(R.main(), 1)
        summary = json.loads((self.output / "summary.json").read_text())
        self.assertEqual(summary["status"], "failure")
        self.assertIsNone(summary["selectedEvaluation"])
        self.assertEqual(sorted(p.name for p in self.output.iterdir()), ["round.json", "summary.json"])
        for file in self.output.rglob("*.json"):
            self.assertNotIn('"eligible": true', file.read_text())

    def test_wrong_round_failed_worker_and_escaping_manifest_cannot_publish(self):
        original = self.handoff()
        for mutate in [lambda v: v.update(round={**self.identity, "identity": "2" * 32}),
                       lambda v: v["files"][0].update(path="../report.json"),
                       lambda v: v["summary"].update(status="failure"),
                       lambda v: v["summary"].update(processed=[]),
                       lambda v: v["summary"].update(selectedEvaluation={"number": 2, "eligible": True})]:
            value = copy.deepcopy(original)
            mutate(value)
            (self.output / "worker-result.json").write_text(json.dumps(value))
            with self.assertRaises(R.C.EvidenceError):
                R.publish(self.output, self.identity, time.monotonic() + 5)
            self.assertFalse((self.output / "2").exists())

    def test_evaluator_uses_fixed_arguments_without_token_or_premature_summary(self):
        directory = self.parent / "2"
        directory.mkdir()
        calls = []
        def evaluate(arguments, **kwargs):
            calls.append((arguments, kwargs))
            output = Path(arguments[-1])
            output.write_text(json.dumps({"mode": "report-only", "mergeAuthorized": False,
                "collectionStatus": "blocked", "result": {"eligible": False}}))
        with patch.object(R.subprocess, "run", side_effect=evaluate):
            report = R.evaluate({}, R.ROOT, {"collection": {"status": "blocked"}}, directory,
                self.identity, time.monotonic() + 10,
                {**context(), "GITHUB_TOKEN": "fixture-token", "GITHUB_STEP_SUMMARY": "unused", "GITHUB_OUTPUT": "unused"})
        arguments, kwargs = calls[0]
        self.assertNotIn("GITHUB_TOKEN", kwargs["env"])
        self.assertNotIn("GITHUB_STEP_SUMMARY", kwargs["env"])
        self.assertNotIn("GITHUB_OUTPUT", kwargs["env"])
        self.assertEqual(arguments[0:2], ["node", str(R.ROOT / "scripts/evaluate-merge-canary.mjs")])
        self.assertEqual(arguments[2::2], ["--policy", "--observations", "--evaluator", "--output"])
        self.assertEqual(report["round"], self.identity)
        self.assertFalse(report["result"]["eligible"])

    def test_stalled_evaluator_times_out_without_completed_report(self):
        executable = self.parent / "node"
        executable.write_text("#!/usr/bin/env python3\nimport time\ntime.sleep(5)\n")
        executable.chmod(0o700)
        directory = self.parent / "2"
        directory.mkdir()
        started = time.monotonic()
        with self.assertRaises(subprocess.TimeoutExpired):
            R.evaluate({}, R.ROOT, {"collection": {"status": "blocked"}}, directory,
                       self.identity, started + 0.2, {**os.environ, "PATH": str(self.parent) + os.pathsep + os.environ["PATH"]})
        self.assertLess(time.monotonic() - started, 2)
        self.assertFalse((directory / "report.json").exists())

    def test_watchdog_kills_only_its_owned_worker_and_descendants(self):
        child_id = self.parent / "child-pid"
        source = ("import subprocess,sys,time;from pathlib import Path;"
                  "p=subprocess.Popen([sys.executable,'-B','-c','import time;time.sleep(10)']);"
                  f"Path({str(child_id)!r}).write_text(str(p.pid));time.sleep(10)")
        unrelated = subprocess.Popen([sys.executable, "-B", "-c", "import time;time.sleep(10)"])
        try:
            started = time.monotonic()
            with self.assertRaisesRegex(R.C.EvidenceError, "round_watchdog_timeout"):
                R.supervise([sys.executable, "-B", "-c", source], dict(os.environ), started + 0.5)
            self.assertLess(time.monotonic() - started, 3)
            self.assertIsNone(unrelated.poll())
            child = int(child_id.read_text())
            status = subprocess.run(["ps", "-o", "stat=", "-p", str(child)], capture_output=True, text=True)
            self.assertTrue(not status.stdout.strip() or status.stdout.strip().startswith("Z"), status.stdout)
        finally:
            unrelated.terminate()
            unrelated.wait(timeout=5)

    def test_early_worker_crash_also_kills_its_owned_grandchild(self):
        child_id = self.parent / "crashed-child-pid"
        source = ("import subprocess,sys;from pathlib import Path;"
                  "p=subprocess.Popen([sys.executable,'-B','-c','import time;time.sleep(10)']);"
                  f"Path({str(child_id)!r}).write_text(str(p.pid));sys.exit(1)")
        with self.assertRaisesRegex(R.C.EvidenceError, "round_worker_failed"):
            R.supervise([sys.executable, "-B", "-c", source], dict(os.environ), time.monotonic() + 3)
        child = int(child_id.read_text())
        status = subprocess.run(["ps", "-o", "stat=", "-p", str(child)], capture_output=True, text=True)
        self.assertTrue(not status.stdout.strip() or status.stdout.strip().startswith("Z"), status.stdout)


if __name__ == "__main__":
    unittest.main()
