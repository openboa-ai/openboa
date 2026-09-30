"""Offline collector tests: platform observations, not candidate declarations."""

import copy
import base64
import hashlib
import importlib.util
import io
import json
import pathlib
import unittest
import urllib.error
import zipfile

SPEC = importlib.util.spec_from_file_location(
    "collector", pathlib.Path(__file__).parents[1] / "scripts/collect-merge-evidence.py")
C = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(C)

M, H, T = "a" * 40, "b" * 40, "c" * 40
MT, HT = "d" * 40, "e" * 40
WORKFLOW_BYTES = b"name: codeql\n"
W = hashlib.sha1(f"blob {len(WORKFLOW_BYTES)}\0".encode() + WORKFLOW_BYTES).hexdigest()
OLD, NEW = "2" * 40, "3" * 40
P = "/repos/example/project"


class FakeAPI:
    def __init__(self):
        self.requests, self.overrides, self.counts, self.archives = [], {}, {}, {}
        self.policy = {"schemaVersion": 1, "repository": {"id": 7, "fullName": "example/project", "defaultBranch": "main"},
                       "workflows": [{"id": 11, "path": ".github/workflows/codeql.yml", "event": "pull_request", "role": "codeql"}],
                       "requiredLanguages": [{"language": "python", "category": "codeql-python"}],
                       "allowedDocumentationPaths": ["README.md"], "controlPaths": [".github/workflows/codeql.yml"]}
        self.event = {"action": "completed", "repository": {"id": 7}, "workflow_run": {"id": 101}}
        self.context = {"GITHUB_EVENT_NAME": "workflow_run", "GITHUB_REPOSITORY": "example/project",
                        "GITHUB_SHA": M, "GITHUB_WORKFLOW_SHA": M}
        self.association = {"id": 9, "number": 2, "head": {"sha": H, "repo": {"id": 7}},
                            "base": {"sha": M, "repo": {"id": 7}}}
        self.pull = {"id": 9, "number": 2, "state": "open", "draft": False, "changed_files": 1,
                     "head": {"sha": H, "repo": {"id": 7}},
                     "base": {"sha": M, "ref": "main", "repo": {"id": 7}}, "user": {"id": 8}}
        self.run = {"id": 101, "workflow_id": 11, "run_attempt": 1, "path": ".github/workflows/codeql.yml",
                    "repository": {"id": 7, "private": False}, "head_sha": H, "event": "pull_request", "status": "completed",
                    "conclusion": "success", "pull_requests": [self.association], "referenced_workflows": []}
        self.entries = [{"path": ".github/workflows/codeql.yml", "mode": "100644", "type": "blob", "sha": W},
                        {"path": "README.md", "mode": "100644", "type": "blob", "sha": OLD}]

    def get(self, route):
        self.requests.append({"route": route, "status": 200})
        self.counts[route] = self.counts.get(route, 0) + 1
        if route in self.overrides:
            value = self.overrides[route]
            if isinstance(value, Exception):
                raise value
            return copy.deepcopy(value(self.counts[route]) if callable(value) else value)
        routes = {
            P + "/git/ref/heads/main": {"object": {"sha": M}},
            P + "/actions/runs/101": self.run,
            P + "/actions/runs/101/attempts/1": self.run,
            P + "/pulls/2": self.pull,
            P + "/pulls/2/files?per_page=100&page=1": [{"filename": "README.md", "status": "modified"}],
            P + "/git/commits/" + M: {"sha": M, "tree": {"sha": MT}, "parents": []},
            P + "/git/commits/" + H: {"sha": H, "tree": {"sha": HT}, "parents": [{"sha": M}]},
            P + "/git/commits/" + T: {"sha": T, "tree": {"sha": HT}, "parents": [{"sha": M}, {"sha": H}]},
            P + "/git/blobs/" + W: {"sha": W, "encoding": "base64", "size": len(WORKFLOW_BYTES),
                                        "content": base64.b64encode(WORKFLOW_BYTES).decode()},
            P + "/git/trees/" + MT + "?recursive=1": {"sha": MT, "truncated": False, "tree": self.entries},
            P + "/git/trees/" + HT + "?recursive=1": {"sha": HT, "truncated": False,
                "tree": [self.entries[0], {**self.entries[1], "sha": NEW}]},
            P + f"/compare/{M}...{H}?per_page=1": {"merge_base_commit": {"sha": M}},
            P + f"/actions/workflows/11/runs?head_sha={H}&per_page=100&page=1": {"total_count": 1, "workflow_runs": [self.run]},
            P + "/actions/runs/101/attempts/1/jobs?per_page=100&page=1": {"total_count": 1, "jobs": [
                {"id": 301, "run_id": 101, "head_sha": H, "name": "analyze (python)", "status": "completed", "conclusion": "success",
                 "steps": [{"number": 1, "name": "Perform CodeQL Analysis", "status": "completed", "conclusion": "success"}]}]},
            P + "/rules/branches/main": [{"type": "required_status_checks", "ruleset_id": 4}],
            P + "/rulesets/4": {"id": 4, "enforcement": "active", "bypass_actors": []},
            P + f"/commits/{H}/check-runs?filter=all&per_page=100&page=1": {"total_count": 0, "check_runs": []},
            P + f"/commits/{H}/statuses?per_page=100&page=1": [],
            P + "/actions/runs/101/artifacts?per_page=100&page=1": {"total_count": 0, "artifacts": []},
        }
        if route not in routes:
            raise AssertionError("unexpected route: " + route)
        return copy.deepcopy(routes[route])

    def collect(self):
        return C.collect(self.policy, self.event, self.context, self)

    def download_artifact(self, artifact_id):
        return self.archives[artifact_id]

    def add_receipt_artifact(self, receipt_overrides=None, extra_members=None):
        receipt = {"schemaVersion": 1, "repositoryId": 7, "repository": "example/project", "runId": 101, "runAttempt": 1,
                   "workflowPath": ".github/workflows/codeql.yml", "workflowRef": "example/project/.github/workflows/codeql.yml@refs/pull/2/merge",
                   "workflowSha": T, "workflowSha256": C.digest(WORKFLOW_BYTES), "event": "pull_request", "eventSha": T,
                   "headSha": H, "baseSha": M, "checkoutSha": T, "parents": [M, H], "sourceTree": HT, "sourceFiles": [],
                   "jobName": "analyze (python)", "language": "python", "category": "codeql-python", **(receipt_overrides or {})}
        sarif = {"version": "2.1.0", "runs": [{"tool": {"driver": {"name": "CodeQL"}}, "results": [],
                                                "invocations": [{"executionSuccessful": True}]}]}
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("receipt.json", json.dumps(receipt))
            archive.writestr("python.sarif", json.dumps(sarif))
            for name, value in extra_members or []:
                archive.writestr(name, value)
        self.archives[10] = buffer.getvalue()
        artifact = {"id": 10, "name": "merge-evidence-101-1-python", "expired": False,
                    "digest": "sha256:" + C.digest(self.archives[10]), "created_at": "2026-09-30T00:01:00Z",
                    "workflow_run": {"id": 101, "repository_id": 7, "head_sha": H}}
        self.overrides[P + "/actions/runs/101/artifacts?per_page=100&page=1"] = {"total_count": 1, "artifacts": [artifact]}
        jobs_route = P + "/actions/runs/101/attempts/1/jobs?per_page=100&page=1"
        jobs = self.get(jobs_route)
        jobs["jobs"][0].update({"started_at": "2026-09-30T00:00:00Z", "completed_at": "2026-09-30T00:02:00Z"})
        jobs["jobs"][0]["steps"].append({"number": 2, "name": "Upload merge evidence", "status": "completed", "conclusion": "success"})
        self.overrides[jobs_route] = jobs
        return artifact


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.api = FakeAPI()

    def assertBlocked(self, reason):
        result = self.api.collect()
        self.assertEqual(result["collection"]["status"], "blocked", result)
        self.assertIn(reason, result["collection"]["blockers"])
        return result

    def test_real_metadata_is_retained_but_missing_raw_and_source_deny(self):
        result = self.assertBlocked("raw_sarif_unavailable_or_unverified:python")
        self.assertIn("workflow_execution_source_unavailable:11", result["collection"]["blockers"])
        self.assertEqual(result["workflows"][0]["jobs"][0]["steps"][0]["conclusion"], "success")
        self.assertEqual(result["rawSarif"][0]["status"], "unavailable")
        self.assertNotIn("eligible", result)

    def test_supplied_eligibility_and_artifact_assertions_are_ignored(self):
        self.api.event.update({"eligible": True, "rawSarif": {"results": []}, "complete": True})
        self.assertBlocked("raw_sarif_unavailable_or_unverified:python")

    def test_native_zero_results_never_become_raw_sarif(self):
        self.api.run["results_count"] = 0
        result = self.assertBlocked("raw_sarif_unavailable_or_unverified:python")
        self.assertNotIn("results", result["rawSarif"][0])

    def test_real_artifact_name_does_not_prove_producer(self):
        self.api.overrides[P + "/actions/runs/101/artifacts?per_page=100&page=1"] = {
            "total_count": 1, "artifacts": [{"id": 10, "name": "merge-evidence-101-1-python", "expired": False}]}
        result = self.assertBlocked("raw_sarif_unavailable_or_unverified:python")
        self.assertEqual(result["rawSarif"][0]["status"], "unverified")

    def test_real_receipt_and_sarif_bytes_can_complete_collection(self):
        self.api.add_receipt_artifact()
        result = self.api.collect()
        self.assertEqual(result["collection"]["status"], "completed", result["collection"])
        envelope = result["rawSarif"][0]
        self.assertEqual(envelope["sarif"]["runs"][0]["results"], [])
        self.assertEqual(envelope["sourceSha"], T)
        self.assertFalse(envelope["producerProof"]["nativeAttemptJobBinding"])
        self.assertFalse(envelope["producerProof"]["cryptographicAttestation"])

    def test_receipt_stale_head_and_wrong_inventory_deny(self):
        for change, code in (({"headSha": M}, "receipt_identity_mismatch"),
                             ({"sourceTree": MT}, "receipt_commit_parents_mismatch"),
                             ({"sourceFiles": [{"path": "missing.py"}]}, "receipt_source_inventory_mismatch")):
            self.api = FakeAPI()
            self.api.add_receipt_artifact(change)
            result = self.assertBlocked("raw_sarif_unavailable_or_unverified:python")
            self.assertEqual(result["rawSarif"][0]["reason"], code)

    def test_zip_extra_traversal_member_and_digest_mismatch_deny(self):
        self.api.add_receipt_artifact(extra_members=[("../evil.py", "print('bad')")])
        result = self.assertBlocked("raw_sarif_unavailable_or_unverified:python")
        self.assertEqual(result["rawSarif"][0]["reason"], "artifact_members_mismatch")
        self.api = FakeAPI()
        artifact = self.api.add_receipt_artifact()
        artifact["digest"] = "sha256:" + "0" * 64
        result = self.assertBlocked("raw_sarif_unavailable_or_unverified:python")
        self.assertEqual(result["rawSarif"][0]["reason"], "artifact_digest_mismatch")

    def test_receipt_unrelated_job_artifact_time_and_run_rejected(self):
        artifact = self.api.add_receipt_artifact()
        artifact["created_at"] = "2026-09-29T00:00:00Z"
        result = self.assertBlocked("raw_sarif_unavailable_or_unverified:python")
        self.assertEqual(result["rawSarif"][0]["reason"], "artifact_outside_producer_job_time")
        artifact["workflow_run"]["id"] = 102
        result = self.assertBlocked("raw_sarif_unavailable_or_unverified:python")
        self.assertEqual(result["rawSarif"][0]["reason"], "artifact_run_identity_mismatch")

    def test_wrong_repository_event_is_rejected_before_any_read(self):
        self.api.event["repository"]["id"] = 999
        self.assertBlocked("controller_event_identity_mismatch")
        self.assertEqual(self.api.requests, [])

    def test_wrong_workflow_same_name_is_rejected(self):
        self.api.run["workflow_id"] = 12
        self.assertBlocked("trigger_run_identity_mismatch")

    def test_file_count_mismatch(self):
        self.api.pull["changed_files"] = 2
        self.assertBlocked("changed_file_count_mismatch")

    def test_truncated_tree(self):
        self.api.overrides[P + "/git/trees/" + MT + "?recursive=1"] = {"sha": MT, "truncated": True, "tree": []}
        self.assertBlocked("tree_identity_or_completeness_unverified")

    def test_hidden_control_change_in_tree_cannot_be_omitted_from_files(self):
        self.api.overrides[P + "/git/trees/" + HT + "?recursive=1"] = {"sha": HT, "truncated": False,
            "tree": [{**self.api.entries[0], "sha": NEW}, {**self.api.entries[1], "sha": NEW}]}
        result = self.assertBlocked("pr_files_and_complete_tree_diff_disagree")
        self.assertIn("control_closure_changed_or_nonregular", result["collection"]["blockers"])

    def test_symlink_document_is_not_low_risk(self):
        self.api.overrides[P + "/git/trees/" + HT + "?recursive=1"] = {"sha": HT, "truncated": False,
            "tree": [self.api.entries[0], {**self.api.entries[1], "sha": NEW, "mode": "120000"}]}
        self.assertBlocked("changed_file_is_not_regular_nonexecutable")

    def test_rename_old_path_is_classified(self):
        self.api.overrides[P + "/pulls/2/files?per_page=100&page=1"] = [{"filename": "README.md", "previous_filename": "SECURITY.md", "status": "renamed"}]
        self.assertBlocked("pr_files_and_complete_tree_diff_disagree")

    def test_not_current_controller_revision_blocks(self):
        self.api.context["GITHUB_WORKFLOW_SHA"] = H
        self.assertBlocked("controller_revision_is_not_current_main")

    def test_failed_required_run_not_replaced_with_success(self):
        self.api.run["conclusion"] = "failure"
        self.assertBlocked("workflow_not_successful:11")

    def test_raw_job_skip_is_preserved_for_evaluator(self):
        route = P + "/actions/runs/101/attempts/1/jobs?per_page=100&page=1"
        jobs = self.api.get(route)
        jobs["jobs"][0]["steps"][0]["conclusion"] = "skipped"
        self.api.overrides[route] = jobs
        result = self.api.collect()
        self.assertEqual(result["workflows"][0]["jobs"][0]["steps"][0]["conclusion"], "skipped")

    def test_api_ref_is_not_assumed_to_be_execution_source(self):
        result = self.api.collect()
        self.assertIsNone(result["source"]["testedRevision"])
        self.assertNotIn(P + "/git/ref/pull/2/merge", [r["route"] for r in self.api.requests])

    def test_actual_reusable_source_reference_requires_exact_parents(self):
        self.api.run["referenced_workflows"] = [{"path": "example/project/.github/workflows/audit.yml@" + T,
                                                  "sha": T, "ref": "refs/pull/2/merge"}]
        result = self.api.collect()
        self.assertEqual(result["source"]["proofStatus"], "verified")
        self.api.overrides[P + "/git/commits/" + T] = {"sha": T, "parents": [{"sha": H}, {"sha": M}]}
        result = self.assertBlocked("workflow_execution_source_unavailable:11")
        self.assertEqual(result["source"]["proofStatus"], "unavailable")

    def test_bypass_read_denial_is_unknown(self):
        self.api.overrides[P + "/rulesets/4"] = C.EvidenceError("github_http_error", 403)
        result = self.assertBlocked("rule_bypass_details_unavailable")
        self.assertEqual(result["protection"]["ruleDetailStatus"], "unavailable")

    def test_bypass_actor_drift_blocks_with_unchanged_effective_rules(self):
        self.api.add_receipt_artifact()
        self.api.overrides[P + "/rulesets/4"] = lambda n: {
            "id": 4, "enforcement": "active", "bypass_actors": [] if n == 1 else
            [{"actor_id": 15368, "actor_type": "Integration", "bypass_mode": "always"}]}
        result = self.assertBlocked("ruleset_details_changed_during_collection")
        self.assertEqual(result["protection"]["ruleDetailStatus"], "changed")
        self.assertEqual(result["protection"]["ruleDetailRereadStatus"], "changed")
        self.assertEqual(result["protection"]["ruleDetails"][0]["bypass_actors"], [])
        self.assertEqual(len(result["protection"]["ruleDetailsAfter"][0]["bypass_actors"]), 1)
        self.assertIn("ruleset_changed:4", result["observations"]["drift"])

    def test_http_failure_is_distinct_from_blocked(self):
        self.api.overrides[P + "/git/ref/heads/main"] = C.EvidenceError("github_http_error", 500)
        result = self.api.collect()
        self.assertEqual(result["collection"]["status"], "failure")
        self.assertEqual(result["collection"]["errors"][0]["httpStatus"], 500)

    def test_head_movement_during_collection(self):
        self.api.overrides[P + "/pulls/2"] = lambda n: self.api.pull if n == 1 else {
            **self.api.pull, "head": {"sha": T, "repo": {"id": 7}}}
        self.assertBlocked("pr_or_main_changed_during_collection")

    def test_run_attempt_movement_during_collection(self):
        self.api.overrides[P + "/actions/runs/101"] = lambda n: self.api.run if n == 1 else {**self.api.run, "run_attempt": 2}
        self.assertBlocked("run_changed_during_collection")

    def test_new_run_for_same_head_invalidates_earlier_success(self):
        route = P + f"/actions/workflows/11/runs?head_sha={H}&per_page=100&page=1"
        self.api.overrides[route] = lambda n: {"total_count": 1 if n == 1 else 2,
            "workflow_runs": [self.api.run] if n == 1 else [self.api.run, {**self.api.run, "id": 102, "status": "queued"}]}
        self.assertBlocked("newer_run_during_collection")

    def test_missing_control_cannot_claim_complete_closure(self):
        self.api.policy["controlPaths"].append("missing-policy.json")
        result = self.assertBlocked("control_closure_changed_or_nonregular")
        self.assertFalse(result["controlClosure"]["complete"])

    def test_latest_mergeability_and_visibility_are_actual_observations(self):
        self.api.overrides[P + "/pulls/2"] = lambda n: {**self.api.pull, "mergeable": n > 1, "mergeable_state": "clean" if n > 1 else "unknown"}
        result = self.api.collect()
        self.assertEqual(result["repository"]["visibility"], "public")
        self.assertTrue(result["pullRequest"]["mergeable"])
        self.assertEqual(result["pullRequest"]["mergeableState"], "clean")
        self.assertFalse(result["pullRequest"]["observedBefore"]["mergeable"])

    def test_exact_sarif_text_digest_is_not_reserialized(self):
        self.api.add_receipt_artifact()
        result = self.api.collect()
        envelope = result["rawSarif"][0]
        self.assertEqual(C.digest(envelope["rawSarif"].encode()), envelope["sarifDigest"])

    def test_failed_upload_cannot_produce_verified_receipt(self):
        self.api.add_receipt_artifact()
        route = P + "/actions/runs/101/attempts/1/jobs?per_page=100&page=1"
        self.api.overrides[route]["jobs"][0]["steps"][-1]["conclusion"] = "skipped"
        result = self.assertBlocked("raw_sarif_unavailable_or_unverified:python")
        self.assertEqual(result["rawSarif"][0]["reason"], "receipt_upload_step_not_successful")

    def test_pagination_incomplete_cannot_be_complete(self):
        route = P + f"/actions/workflows/11/runs?head_sha={H}&per_page=100&page=1"
        self.api.overrides[route] = {"total_count": 2, "workflow_runs": [self.api.run]}
        self.assertBlocked("pagination_incomplete")

    def test_duplicate_json_and_nan_rejected(self):
        for data in ('{"x":1,"x":2}', '{"x":NaN}'):
            with self.assertRaises(C.EvidenceError):
                C.decode_json(data)

    def test_no_wildcard_positive_path_or_foreign_api_origin(self):
        client = C.GitHubGet("example/project", "test-token")
        for route in ("https://evil.invalid/", "/repos/other/project/pulls/1", P + "/../x"):
            with self.assertRaises(C.EvidenceError):
                client.get(route)
        self.assertEqual(client.requests, [])

    def test_client_uses_get_and_never_follows_redirects(self):
        class Opener:
            def open(self, request, timeout):
                self.request = request
                raise urllib.error.HTTPError(request.full_url, 302, "redirect", {}, io.BytesIO())
        opener = Opener()
        client = C.GitHubGet("example/project", "test-token", opener=opener)
        with self.assertRaises(C.EvidenceError) as error:
            client.get(P + "/pulls/2")
        self.assertEqual(error.exception.status, 302)
        self.assertEqual(opener.request.get_method(), "GET")
        self.assertIsNone(opener.request.data)
        self.assertNotIn("test-token", json.dumps(client.requests))

    def test_artifact_redirect_drops_authorization_and_signed_url(self):
        class Response(io.BytesIO):
            status = 200

        class Opener:
            def __init__(self):
                self.seen = []

            def open(self, request, timeout):
                self.seen.append(request)
                if len(self.seen) == 1:
                    raise urllib.error.HTTPError(request.full_url, 302, "redirect", {
                        "Location": "https://production.blob.core.windows.net/file?sig=fake-signed"}, io.BytesIO())
                return Response(b"archive")

        opener = Opener()
        client = C.GitHubGet("example/project", "test-token", opener=opener)
        self.assertEqual(client.download_artifact(10), b"archive")
        self.assertIsNone(opener.seen[1].get_header("Authorization"))
        self.assertNotIn("fake-signed", json.dumps(client.requests))
        self.assertNotIn("test-token", json.dumps(client.requests))

    def test_matching_zip_symlink_member_is_rejected(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            entry = zipfile.ZipInfo("receipt.json")
            entry.external_attr = 0o120777 << 16
            archive.writestr(entry, "target")
        self.api.archives[10] = buffer.getvalue()
        metadata = {"id": 10, "expired": False, "digest": "sha256:" + C.digest(buffer.getvalue())}
        with self.assertRaises(C.EvidenceError) as error:
            C.artifact_members(self.api, metadata, ["receipt.json"], C.DEFAULT_LIMITS)
        self.assertEqual(error.exception.code, "artifact_nonregular_member")


if __name__ == "__main__":
    unittest.main()
