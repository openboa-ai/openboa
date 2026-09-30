"""Offline dispatch transport, provenance, race and truthful-result controls."""
import copy
import importlib.util
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("dispatch", ROOT / "scripts/dispatch-postmerge-verification.py")
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)
B, S = "a" * 40, "b" * 40
CONTEXT = {"GITHUB_REPOSITORY": d.REPOSITORY, "GITHUB_EVENT_NAME": "schedule",
           "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": B, "GITHUB_WORKFLOW_SHA": B}


class FakeAPI:
    def __init__(self):
        self.sent = False
        self.dispatches, self.requests, self.waits = [], [], []
        self.run = {"id": 101, "workflow_id": 11, "repository": {"id": d.REPOSITORY_ID, "full_name": d.REPOSITORY},
                    "head_repository": {"id": d.REPOSITORY_ID}, "head_sha": S, "head_branch": "main",
                    "run_attempt": 1, "event": "workflow_dispatch", "path": d.WORKFLOW,
                    "status": "completed", "conclusion": "success", "created_at": "2026-09-30T22:00:00Z"}
        self.jobs = {"total_count": len(d.EXPECTED_JOBS), "jobs": [
            {"id": i+1, "name": name, "run_id": 101, "run_attempt": 1, "head_sha": S,
             "status": "completed", "conclusion": "success"} for i, name in enumerate(sorted(d.EXPECTED_JOBS))]}
        self.responses = {"/git/commits/" + S: {"sha": S, "parents": [{"sha": B}]},
            "/git/ref/heads/main": {"object": {"sha": S}},
            "/actions/workflows/postmerge-verification.yml": {"id": 11, "path": d.WORKFLOW, "state": "active"}}
    def get(self, route):
        self.requests.append(route)
        route = route.removeprefix(d.PREFIX)
        value = self.run if route == "/actions/runs/101" else self.jobs if route == "/actions/runs/101/attempts/1/jobs?per_page=100" else self.responses[route]
        return copy.deepcopy(value)
    def dispatch(self, sha):
        self.sent = True
        self.dispatches.append(sha)
        return 101
    def sleep(self, seconds):
        self.waits.append(seconds)


class DispatchTests(unittest.TestCase):
    def test_dry_run_sends_no_dispatch(self):
        api = FakeAPI()
        self.assertEqual(d.run_verification(api, S, CONTEXT)["outcome"], "dry-run-ready")
        self.assertEqual(api.dispatches, [])

    def test_actual_mock_success_requires_exact_run_and_all_fourteen_jobs(self):
        api = FakeAPI()
        persisted = []
        result = d.run_verification(api, S, CONTEXT, True, api.sleep, persisted.append)
        self.assertTrue(result["verified"])
        self.assertEqual(result["runId"], 101)
        self.assertEqual(api.dispatches, [S])
        self.assertEqual(len(d.EXPECTED_JOBS), 14)
        self.assertTrue(all(state["verified"] is False for state in persisted))

    def test_context_and_pre_dispatch_main_race_block_before_post(self):
        for context in [{**CONTEXT, "GITHUB_EVENT_NAME": "workflow_run"}, {**CONTEXT, "GITHUB_REF": "refs/heads/other"},
                        {**CONTEXT, "GITHUB_WORKFLOW_SHA": S}, {**CONTEXT, "GITHUB_REPOSITORY": "other/repo"}]:
            api = FakeAPI()
            with self.assertRaises(d.collector.EvidenceError):
                d.run_verification(api, S, context, True)
            self.assertFalse(api.dispatches)
        for route, value in [("/git/ref/heads/main", {"object": {"sha": B}}),
                             ("/git/commits/"+S, {"sha": S, "parents": [{"sha": "c"*40}]}),
                             ("/actions/workflows/postmerge-verification.yml", {"id": 11, "path": "other", "state": "active"})]:
            api = FakeAPI(); api.responses[route] = value
            with self.assertRaises(d.collector.EvidenceError):
                d.run_verification(api, S, CONTEXT, True)
            self.assertFalse(api.dispatches)

    def test_captured_sha_survives_later_main_advance_without_substitution(self):
        api = FakeAPI()
        dispatch = api.dispatch
        def send(sha):
            api.responses["/git/ref/heads/main"] = {"object": {"sha": "c"*40}}
            return dispatch(sha)
        api.dispatch = send
        result = d.run_verification(api, S, CONTEXT, True, api.sleep)
        self.assertEqual(result["commit"], S)
        self.assertTrue(result["verified"])

    def test_run_identity_changes_and_failures_never_become_verified(self):
        for key, value in [("id", 102), ("workflow_id", 12), ("head_sha", B), ("head_branch", "other"),
                           ("run_attempt", 2), ("event", "pull_request"), ("path", "other"),
                           ("repository", {"id": 1}), ("head_repository", {"id": 1}),
                           ("conclusion", "failure"), ("conclusion", "cancelled"), ("conclusion", "skipped")]:
            api = FakeAPI(); api.run[key] = value
            with self.assertRaises(d.collector.EvidenceError):
                d.run_verification(api, S, CONTEXT, True, api.sleep)
            self.assertEqual(api.dispatches, [S])

    def test_missing_failed_skipped_duplicate_foreign_jobs_deny(self):
        for mutate in [lambda doc: doc["jobs"][0].update(conclusion="failure"),
                       lambda doc: doc["jobs"][0].update(conclusion="skipped"),
                       lambda doc: doc["jobs"][0].update(run_attempt=2),
                       lambda doc: doc["jobs"][0].update(run_id=102),
                       lambda doc: doc["jobs"][0].update(head_sha=B),
                       lambda doc: doc["jobs"][0].update(name="other"),
                       lambda doc: doc["jobs"][0].update(id=doc["jobs"][1]["id"]),
                       lambda doc: doc.update(total_count=99)]:
            api = FakeAPI(); mutate(api.jobs)
            with self.assertRaises(d.collector.EvidenceError):
                d.run_verification(api, S, CONTEXT, True, api.sleep)
            self.assertEqual(api.dispatches, [S])
        api = FakeAPI(); api.jobs = {"total_count": 0, "jobs": []}
        with self.assertRaisesRegex(d.collector.EvidenceError, "metadata_unavailable"):
            d.run_verification(api, S, CONTEXT, True, api.sleep)
        self.assertEqual(api.waits, [15, 15])

    def test_pending_run_timeout_is_bounded_and_never_resends(self):
        api = FakeAPI(); api.run.update(status="in_progress", conclusion=None)
        with self.assertRaisesRegex(d.collector.EvidenceError, "timed_out"):
            d.run_verification(api, S, CONTEXT, True, api.sleep)
        self.assertEqual(api.dispatches, [S])
        self.assertEqual(api.waits, [30]*100)

    def test_completed_metadata_lag_is_read_only_and_requires_full_fresh_document(self):
        api = FakeAPI(); get = api.get
        count = 0
        def delayed(route):
            nonlocal count
            result = get(route)
            if "/jobs?" in route:
                count += 1
                if count == 1:
                    result["jobs"][0].update(status="in_progress", conclusion=None)
            return result
        api.get = delayed
        self.assertTrue(d.run_verification(api, S, CONTEXT, True, api.sleep)["verified"])
        self.assertEqual(api.waits, [15])

    def test_transport_is_fixed_versioned_and_one_shot_even_if_response_unknown(self):
        class Response(io.BytesIO):
            status = 200
        class Opener:
            def __init__(self, result): self.result, self.requests = result, []
            def open(self, request, timeout):
                self.requests.append(request)
                if isinstance(self.result, Exception): raise self.result
                return Response(json.dumps(self.result).encode())
        good = {"workflow_run_id": 101, "run_url": "https://api.github.com" + d.PREFIX + "/actions/runs/101",
                "html_url": "https://github.com/openboa-ai/openboa/actions/runs/101"}
        for result in [good, {**good, "workflow_run_id": True}, {**good, "run_url": "https://attacker.invalid"}, {}, OSError("lost reply")]:
            opener = Opener(result); api = d.DispatchAPI("test-only", opener)
            if result == good:
                self.assertEqual(api.dispatch(S), 101)
            else:
                with self.assertRaises(Exception): api.dispatch(S)
            with self.assertRaises(d.collector.EvidenceError): api.dispatch(S)
            self.assertEqual(len(opener.requests), 1)
            request = opener.requests[0]
            self.assertEqual(request.full_url, "https://api.github.com" + d.WORKFLOW_ROUTE + "/dispatches")
            self.assertEqual(json.loads(request.data), {"ref": "main", "inputs": {"expected_sha": S}})
            self.assertEqual(request.get_header("X-github-api-version"), "2026-03-10")
            self.assertNotIn("test-only", json.dumps(api.requests))

    def test_verifier_source_guard_rejects_raced_event_before_checkout(self):
        workflow = (ROOT / d.WORKFLOW).read_text()
        self.assertNotIn("actions: write", workflow)
        self.assertNotIn("contents: write", workflow)
        self.assertNotIn("inputs.revision", workflow)
        self.assertEqual(workflow.count("needs: [source-boundary]"), 2)
        shell = workflow.split("        run: |\n", 1)[1].split("\n  full-ci:", 1)[0]
        shell = "\n".join(line[10:] for line in shell.splitlines())
        env = {**os.environ, "GITHUB_REPOSITORY": d.REPOSITORY, "GITHUB_EVENT_NAME": "workflow_dispatch",
               "GITHUB_REF": "refs/heads/main", "GITHUB_WORKFLOW_REF": d.REPOSITORY + "/" + d.WORKFLOW + "@refs/heads/main",
               "EXPECTED_SHA": S, "WORKFLOW_SHA": S, "GITHUB_SHA": S}
        self.assertEqual(subprocess.run(["bash", "-e", "-c", shell], env=env, capture_output=True).returncode, 0)
        for key, value in [("GITHUB_SHA", B), ("WORKFLOW_SHA", B), ("EXPECTED_SHA", "$(exit 0)"),
                           ("GITHUB_REF", "refs/heads/other"), ("GITHUB_EVENT_NAME", "pull_request"),
                           ("GITHUB_WORKFLOW_REF", "untrusted")]:
            self.assertNotEqual(subprocess.run(["bash", "-e", "-c", shell], env={**env, key:value}, capture_output=True).returncode, 0)
        aggregate = workflow.split("      - name: Require every verification lane", 1)[1].split("        run: |\n", 1)[1]
        aggregate = "\n".join(line[10:] for line in aggregate.splitlines())
        with tempfile.NamedTemporaryFile() as summary:
            env.update(GITHUB_STEP_SUMMARY=summary.name, SOURCE_RESULT="success", CI_RESULT="success", CODEQL_RESULT="success")
            self.assertEqual(subprocess.run(["bash", "-e", "-c", aggregate], env=env, capture_output=True).returncode, 0)
            for key in ("SOURCE_RESULT", "CI_RESULT", "CODEQL_RESULT"):
                for result in ("failure", "skipped", "cancelled", ""):
                    self.assertNotEqual(subprocess.run(["bash", "-e", "-c", aggregate], env={**env,key:result}, capture_output=True).returncode, 0)


if __name__ == "__main__":
    unittest.main()
