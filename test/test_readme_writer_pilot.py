"""Offline mocks only: these tests never send a merge request to GitHub."""
import base64
import copy
import importlib.util
import io
import http.client
import json
import os
import subprocess
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("writer", ROOT / "scripts/readme-writer-pilot.py")
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)
B, H, S, BT, HT, PB = (c * 40 for c in "abcdef")
EVENT = {"workflow_run": {"event": "pull_request"}}


def fixture():
    pilot = {**w.EXPECTED, "enabled": True}
    data = json.dumps(pilot).encode()
    policy_blob = __import__("hashlib").sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
    context = {"GITHUB_REPOSITORY": "openboa-ai/openboa", "GITHUB_EVENT_NAME": "workflow_run",
               "GITHUB_WORKFLOW_SHA": B, "GITHUB_SHA": B, "WRITER_ENABLED": "true"}
    detail = {"id": 1, "current_user_can_bypass": "never"}
    rules = [{"type": "required_status_checks", "ruleset_id": 1}]
    pull = {"number": 68, "state": "open", "merged": False, "draft": False,
            "mergeable": True, "mergeable_state": "clean", "merge_commit_sha": S,
            "head": {"sha": H, "repo": {"id": 1214829403}},
            "base": {"sha": B, "ref": "main", "repo": {"id": 1214829403}}}
    def tree(sha, readme):
        return {"sha": sha, "truncated": False, "tree": [
            {"path": "README.md", "mode": "100644", "type": "blob", "sha": readme},
            {"path": w.PILOT_PATH, "mode": "100644", "type": "blob", "sha": policy_blob}]}
    responses = {
        "/git/ref/heads/main": {"object": {"sha": B}},
        "/actions/workflows/readme-writer-pilot.yml": {"path": w.WORKFLOW, "state": "active"},
        "/pulls/68": pull,
        "/git/commits/" + B: {"sha": B, "tree": {"sha": BT}},
        "/git/commits/" + H: {"sha": H, "tree": {"sha": HT}},
        "/git/commits/" + S: {"sha": S, "tree": {"sha": HT}, "parents": [{"sha": B}]},
        "/git/trees/" + BT + "?recursive=1": tree(BT, pilot["oldBlob"]),
        "/git/trees/" + HT + "?recursive=1": tree(HT, pilot["newBlob"]),
        "/git/blobs/" + policy_blob: {"sha": policy_blob, "encoding": "base64", "size": len(data),
                                     "content": base64.b64encode(data).decode()},
        "/rules/branches/main": rules, "/rulesets/1": detail,
    }
    observation = {"collector": {}, "pullRequest": {"number": 68, "baseSha": B, "headSha": H},
                   "collection": {"status": "completed", "blockers": [], "errors": []},
                   "protection": {"rules": rules, "ruleDetailsAfter": [detail]}}
    return pilot, data, context, responses, observation


def metadata_fixture():
    policy = json.loads((ROOT / ".github/merge-canary-policy.json").read_text())
    checks = policy["evaluation"]["requiredChecks"]
    rules = [{"type": "required_status_checks", "ruleset_id": 1, "parameters": {
        "strict_required_status_checks_policy": True,
        "required_status_checks": [{"context": c["context"], "integration_id": c["appId"]} for c in checks]}},
        {"type": "code_quality", "ruleset_id": 1, "parameters": {"severity": "errors"}},
        {"type": "code_scanning", "ruleset_id": 1, "parameters": {"code_scanning_tools": [{
            "tool": "CodeQL", "security_alerts_threshold": "high_or_higher", "alerts_threshold": "errors"}]}}]
    rules.extend({"type": kind, "ruleset_id": 1} for kind in policy["expectedRuleTypes"] if kind not in {r["type"] for r in rules})
    details = [{"id": 1, "enforcement": "active", "current_user_can_bypass": "never"}]
    workflows = []
    for spec in policy["workflows"]:
        run_policy = next((r for r in policy["evaluation"]["runs"] if r["workflowId"] == spec["id"]), None)
        jobs = run_policy["jobs"] if run_policy else [{"name": n, "steps": ["Initialize CodeQL", "Perform CodeQL Analysis"]}
                                                      for n in policy["evaluation"]["platformGate"]["jobs"]]
        workflows.append({"workflowId": spec["id"], "status": "completed", "conclusion": "success", "runId": spec["id"] + 1,
                          "jobs": [{"id": i+1, "name": j["name"], "status": "completed", "conclusion": "success", "steps": [
                              {"number": n+1, "name": name, "status": "completed", "conclusion": "success"}
                              for n, name in enumerate(j["steps"])]} for i, j in enumerate(jobs)]})
    workflows[0]["jobs"][0]["steps"][0].update(status="in_progress", conclusion=None)
    workflows[0]["jobs"][0]["stepRefresh"] = {"status": "unavailable", "reason": "required_job_steps_incomplete"}
    sarif = []
    for language, category in policy["evaluation"]["sarifCategories"].items():
        raw = {"version": "2.1.0", "runs": [{"tool": {"driver": {"name": "CodeQL", "semanticVersion": "2.27.1"}},
               "automationDetails": {"id": category}, "results": [], "invocations": [{"executionSuccessful": True}]}]}
        text = json.dumps(raw)
        sarif.append({"status": "verified", "language": language, "sarif": raw, "rawSarif": text,
                      "sarifDigest": w.collector.digest(text.encode())})
    return policy, {"collector": {}, "pullRequest": {"number": 68, "baseSha": B, "headSha": H},
        "collection": {"status": "blocked", "errors": [], "blockers": ["required_job_steps_unavailable:1"]},
        "workflows": workflows[:3], "platformGate": workflows[3], "rawSarif": sarif,
        "protection": {"rules": rules, "ruleDetails": details, "ruleDetailsAfter": copy.deepcopy(details),
            "ruleDetailStatus": "verified", "ruleDetailRereadStatus": "unchanged", "statuses": [],
            "checkRuns": [{"name": c["context"], "app": {"id": c["appId"]}, "head_sha": H,
                           "status": "completed", "conclusion": "success"} for c in checks]}}


class FakeAPI:
    def __init__(self, responses):
        self.responses = responses
        self.token, self.sent, self.started, self.now = "captured-test-token", False, 0, 0
        self.requests, self.merges, self.phases = [], [], 0
    def clock(self):
        return self.now
    def begin_phase(self):
        self.phases += 1
    def get(self, route):
        self.requests.append(route)
        return copy.deepcopy(self.responses[route.removeprefix(w.PREFIX)])
    def merge(self, head):
        self.sent = True
        self.merges.append(head)
        self.responses["/pulls/68"]["merged"] = True
        self.responses["/pulls/68"]["state"] = "closed"
        return {"merged": True, "sha": S}
    def sleep(self, seconds):
        self.now += seconds


class WriterTests(unittest.TestCase):
    def test_retry_classifier_requires_real_clean_raw_and_only_pending_required_steps(self):
        policy, template = metadata_fixture()
        def observation():
            return copy.deepcopy(template)
        self.assertTrue(w.retryable_metadata(observation(), policy))
        for mutate in [lambda r: r["runs"][0]["results"].append({"ruleId": "real/finding"}),
                       lambda r: r["runs"][0]["invocations"][0].update(executionSuccessful=False),
                       lambda r: r["runs"][0]["invocations"][0].update(toolExecutionNotifications=[{"level": "error"}]),
                       lambda r: r["runs"][0].update(conversion={}),
                       lambda r: r.update(inlineExternalProperties=[{"results": [{"ruleId": "hidden"}]}]),
                       lambda r: r["runs"][0].update(externalPropertyFileReferences={"results": [{}]}),
                       lambda r: r["runs"][0]["invocations"][0].update(toolExecutionNotifications=[{"level": "unknown"}]),
                       lambda r: r.update(runs=[])]:
            o = observation(); mutate(o["rawSarif"][0]["sarif"])
            envelope = o["rawSarif"][0]
            envelope["rawSarif"] = json.dumps(envelope["sarif"])
            envelope["sarifDigest"] = w.collector.digest(envelope["rawSarif"].encode())
            self.assertFalse(w.retryable_metadata(o, policy))
        for mutate in [lambda o: o["rawSarif"][0].pop("sarif"),
                       lambda o: o["rawSarif"][0].pop("rawSarif"),
                       lambda o: o["collection"]["blockers"].append("current_principal_bypass_unverified"),
                       lambda o: o["collection"]["blockers"].append("pr_or_main_changed_during_collection"),
                       lambda o: o["workflows"][0]["jobs"][0]["steps"][0].update(conclusion="failure"),
                       lambda o: o["workflows"][0]["jobs"][0]["steps"][0].update(conclusion="skipped"),
                       lambda o: o["protection"]["rules"][0]["parameters"].update(strict_required_status_checks_policy=False),
                       lambda o: o["protection"]["checkRuns"][0].update(conclusion="failure"),
                       lambda o: o["platformGate"]["jobs"][0].update(conclusion="failure"),
                       lambda o: o["workflows"][0]["jobs"][0].update(conclusion="skipped"),
                       lambda o: o["protection"]["ruleDetails"][0].update(current_user_can_bypass="always")]:
            o = observation(); mutate(o)
            self.assertFalse(w.retryable_metadata(o, policy))

    def test_workflow_default_off_and_confirmed_merge_continuation_contract(self):
        workflow = (ROOT / w.WORKFLOW).read_text()
        self.assertIn("if: needs.prepare.outputs.enabled == 'true' && vars.OPENBOA_README_WRITER_ENABLED == 'true'", workflow)
        self.assertIn("cancel-in-progress: false", workflow)
        self.assertIn("CodeQL - Code Quality", workflow)
        self.assertIn("github.event.workflow_run.event == 'dynamic'", workflow)
        self.assertNotIn("zizmor: ignore", workflow)
        self.assertEqual(workflow.count("contents: write"), 1)
        self.assertNotIn("actions: write", workflow)
        self.assertIn("full_scope: true", workflow)
        self.assertIn("strict_postmerge: true", workflow)
        self.assertEqual(workflow.count("if: always() && needs.writer.outputs.outcome == 'merged' && needs.writer.outputs.merge_sha != ''"), 2)
        # The explicit always() applies even if a persistence step failed AFTER
        # the writer emitted a verified merged SHA. No skip can make final green.
        self.assertIn('"$WRITER_RESULT" != success || "$CI_RESULT" != success || "$CODEQL_RESULT" != success', workflow)
        shell = workflow.split("      - name: Require actual continuation success", 1)[1].split("        run: |\n", 1)[1]
        shell = "\n".join(line[10:] for line in shell.splitlines())
        with tempfile.NamedTemporaryFile() as summary:
            for failure in [None, "WRITER_RESULT", "CI_RESULT", "CODEQL_RESULT"]:
                for result in (["success"] if failure is None else ["failure", "cancelled", "skipped", ""]):
                    env = {**os.environ, "GITHUB_STEP_SUMMARY": summary.name, "MERGE_SHA": S,
                           "WRITER_RESULT": "success", "CI_RESULT": "success", "CODEQL_RESULT": "success"}
                    if failure:
                        env[failure] = result
                    status = subprocess.run(["bash", "-e", "-c", shell], env=env, capture_output=True)
                    self.assertEqual(status.returncode == 0, failure is None)

    def invoke(self, mutate=None, execute=False, evaluate=None):
        pilot, data, context, responses, observation = fixture()
        api = FakeAPI(responses)
        if mutate:
            mutate(pilot, context, api, observation)
        with patch.object(w.collector, "collect", return_value=observation) as collect:
            result = w.run_pilot(pilot, data, {}, b"{}", EVENT, context, api,
                evaluate or (lambda _: {"mode": "report-only", "mergeAuthorized": False,
                                       "result": {"eligible": True}}), execute, api.sleep)
        return result, api, collect

    def test_actual_policy_is_disabled_and_no_api_or_write_runs(self):
        actual = json.loads((ROOT / w.PILOT_PATH).read_text())
        self.assertIs(actual["enabled"], False)
        result, api, collect = self.invoke(lambda p, c, a, o: p.update(enabled=False), True)
        self.assertEqual(result["outcome"], "disabled")
        self.assertEqual(api.requests + api.merges, [])
        collect.assert_not_called()
        result, api, _ = self.invoke(lambda p, c, a, o: c.update(WRITER_ENABLED="false"), True)
        self.assertEqual(result["outcome"], "disabled")
        self.assertEqual(api.requests, [])

    def test_dry_run_collects_fresh_but_never_puts(self):
        result, api, collect = self.invoke()
        self.assertEqual(result["outcome"], "dry-run-eligible")
        self.assertFalse(result["mergeAttempted"])
        self.assertEqual(api.merges, [])
        self.assertIs(collect.call_args.args[-1], api)

    def test_positive_mock_put_is_once_head_bound_and_reconciles_actual_sha(self):
        result, api, _ = self.invoke(execute=True)
        self.assertEqual(result, {"outcome": "merged", "mergeAttempted": True,
                                 "mergeSha": S, "base": B, "head": H})
        self.assertEqual(api.merges, [H])

    def test_exact_scope_and_switch_negatives_never_write(self):
        changes = [
            lambda p, c, a, o: p.update(pullRequest=69),
            lambda p, c, a, o: p.update(newBlob="0" * 40),
            lambda p, c, a, o: c.update(GITHUB_SHA=H),
            lambda p, c, a, o: c.update(GITHUB_EVENT_NAME="pull_request"),
            lambda p, c, a, o: a.responses["/pulls/68"].update(merged=True),
            lambda p, c, a, o: a.responses["/pulls/68"].update(state="closed"),
            lambda p, c, a, o: a.responses["/pulls/68"].update(draft=True),
            lambda p, c, a, o: a.responses["/pulls/68"].update(mergeable_state="blocked"),
            lambda p, c, a, o: a.responses["/actions/workflows/readme-writer-pilot.yml"].update(state="disabled_manually"),
            lambda p, c, a, o: a.responses["/git/trees/" + HT + "?recursive=1"]["tree"][0].update(mode="120000"),
            lambda p, c, a, o: a.responses["/git/trees/" + HT + "?recursive=1"]["tree"][0].update(sha=B),
            lambda p, c, a, o: a.responses["/git/trees/" + HT + "?recursive=1"]["tree"].append(
                {"path": "extra.md", "sha": H, "type": "blob", "mode": "100644"}),
            lambda p, c, a, o: o["pullRequest"].update(headSha=S),
        ]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(w.collector.EvidenceError):
                self.invoke(change, True)

    def test_fresh_evidence_cannot_be_promoted_or_token_swapped(self):
        for report in ({"mode": "writer", "mergeAuthorized": True, "result": {"eligible": True}},
                       {"mode": "report-only", "mergeAuthorized": False, "result": {"eligible": False}}):
            if report["mergeAuthorized"]:
                with self.assertRaises(w.collector.EvidenceError):
                    self.invoke(evaluate=lambda _: report)
            else:
                result, api, _ = self.invoke(evaluate=lambda _: report)
                self.assertEqual(result["outcome"], "ineligible")
                self.assertEqual(api.merges, [])
        pilot, data, context, responses, observation = fixture()
        api = FakeAPI(responses)
        def collect(*args):
            api.token = "different-credential"
            return observation
        with patch.object(w.collector, "collect", side_effect=collect), self.assertRaisesRegex(w.collector.EvidenceError, "credential_changed"):
            w.run_pilot(pilot, data, {}, b"{}", EVENT, context, api, lambda _: {}, True)

    def test_preput_rule_or_base_change_denies(self):
        for route, field, value in [("/rulesets/1", "current_user_can_bypass", "always"),
                                    ("/git/ref/heads/main", "object", {"sha": S})]:
            def evaluate(observation):
                api.responses[route][field] = value
                return {"mode": "report-only", "mergeAuthorized": False, "result": {"eligible": True}}
            pilot, data, context, responses, observation = fixture()
            api = FakeAPI(responses)
            with patch.object(w.collector, "collect", return_value=copy.deepcopy(observation)), self.assertRaises(w.collector.EvidenceError):
                w.run_pilot(pilot, data, {}, b"{}", EVENT, context, api, evaluate, True)
            self.assertEqual(api.merges, [])

    def test_ambiguous_put_only_reconciles_no_resend(self):
        pilot, data, context, responses, observation = fixture()
        api = FakeAPI(responses)
        normal = api.merge
        def ambiguous(head):
            normal(head)
            raise w.collector.EvidenceError("merge_outcome_unknown")
        api.merge = ambiguous
        with patch.object(w.collector, "collect", return_value=observation):
            result = w.run_pilot(pilot, data, {}, b"{}", EVENT, context, api,
                lambda _: {"mode": "report-only", "mergeAuthorized": False, "result": {"eligible": True}}, True)
        self.assertEqual(result["mergeSha"], S)
        self.assertEqual(api.merges, [H])

    def test_postsend_malformed_oversized_or_unusable_response_reconciles_once(self):
        class Response(io.BytesIO):
            status = 200
        for payload in [b'chunked-truncation', b'[' * 2000 + b']' * 2000, b'{"merged":', b'x' * (1024 * 1024 + 1), b'null', b'[]', b'1', b'{}',
                        b'{"merged":true,"sha":"invalid"}', b'{"merged":false}']:
            pilot, data, context, responses, observation = fixture()
            class Opener:
                puts = 0
                def open(self, request, timeout):
                    if request.method == "PUT":
                        self.puts += 1
                        responses["/pulls/68"].update(merged=True, state="closed")
                        if payload == b'chunked-truncation':
                            class Socket:
                                def makefile(self, *args):
                                    return io.BytesIO(b'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nabc')
                            response = http.client.HTTPResponse(Socket())
                            response.begin()
                            return response
                        return Response(payload)
                    route = request.full_url.removeprefix("https://api.github.com" + w.PREFIX)
                    return Response(json.dumps(responses[route]).encode())
            opener = Opener()
            api = w.WriterAPI("test-only", allow_write=True, opener=opener)
            with self.subTest(payload=payload[:30]), patch.object(w.collector, "collect", return_value=observation):
                result = w.run_pilot(pilot, data, {}, b"{}", EVENT, context, api,
                    lambda _: {"mode": "report-only", "mergeAuthorized": False, "result": {"eligible": True}}, True)
                self.assertEqual(result["mergeSha"], S)
                self.assertEqual(opener.puts, 1)
                self.assertEqual([r["route"] for r in api.requests[-2:]], [w.PREFIX + "/pulls/68", w.PREFIX + "/git/commits/" + S])
                with self.assertRaises(w.collector.EvidenceError):
                    api.merge(H)

    def test_retry_never_erases_prior_negative_or_immutable_facts(self):
        policy, original = metadata_fixture()
        changes = [lambda o: o["protection"]["rules"][0]["parameters"].update(strict_required_status_checks_policy=False),
                   lambda o: o["protection"]["checkRuns"][0].update(conclusion="failure"),
                   lambda o: o["rawSarif"][0].update(sarifDigest="f" * 64),
                   lambda o: o["workflows"][0].update(runId=999),
                   lambda o: o["workflows"][0]["jobs"][0].update(id=999),
                   lambda o: o.update(unknownFutureSecurityFact="negative")]
        for change in changes:
            earlier, later = copy.deepcopy(original), copy.deepcopy(original)
            change(earlier)
            with self.subTest(change=change), self.assertRaises(w.collector.EvidenceError):
                w.require_monotonic_metadata(earlier, later)
            pilot, data, context, responses, _ = fixture()
            api = FakeAPI(responses)
            # Even a future classifier omission cannot erase an earlier fact.
            with patch.object(w.collector, "collect", side_effect=[earlier, later]), patch.object(w, "retryable_metadata", return_value=True):
                reports = iter([False, True])
                with self.assertRaises(w.collector.EvidenceError):
                    w.run_pilot(pilot, data, policy, b"{}", EVENT, context, api,
                        lambda _: {"mode": "report-only", "mergeAuthorized": False, "result": {"eligible": next(reports)}}, True, api.sleep)
            self.assertEqual(api.merges, [])
        later = copy.deepcopy(original)
        later["workflows"][0]["jobs"][0]["steps"][0].update(status="completed", conclusion="success")
        later["workflows"][0]["jobs"][0].pop("stepRefresh")
        later["collection"] = {"status": "completed", "errors": [], "blockers": []}
        w.require_monotonic_metadata(original, later)
        original["workflows"][0]["jobs"][0]["steps"][0].update(status="completed", conclusion="failure")
        with self.assertRaisesRegex(w.collector.EvidenceError, "terminal_step_changed"):
            w.require_monotonic_metadata(original, later)

    def test_actual_evaluator_child_has_no_token_and_recursion_is_denied(self):
        real_run = subprocess.run
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "event.json").write_text(json.dumps(EVENT))
            def evaluate_child(command, **kwargs):
                probe = real_run([sys.executable, "-c", "import os; assert 'GITHUB_TOKEN' not in os.environ"], check=True)
                Path(command[-1]).write_text('{"mode":"report-only"}')
                return probe
            def fake_pilot(*args, **kwargs):
                self.assertEqual(args[6].token, "test-private-token")
                self.assertEqual(args[7]({})["mode"], "report-only")
                return {"outcome": "disabled", "mergeAttempted": False}
            with patch.dict(os.environ, {"GITHUB_TOKEN": "test-private-token", "RUNNER_TEMP": str(root),
                                         "GITHUB_EVENT_PATH": str(root / "event.json"), "GITHUB_OUTPUT": str(root / "output")}), \
                    patch.object(sys, "argv", ["writer", "--execute"]), patch.object(w, "run_pilot", side_effect=fake_pilot), \
                    patch.object(w.subprocess, "run", side_effect=evaluate_child):
                w.main()
        pilot, data, context, responses, _ = fixture()
        api = FakeAPI(responses)
        with self.assertRaisesRegex(w.collector.EvidenceError, "writer_context_invalid"):
            w.run_pilot(pilot, data, {}, b"{}", {"workflow_run": {"event": "workflow_run"}}, context, api, lambda _: {}, True)
        self.assertEqual(api.requests + api.merges, [])

    def test_unavailable_reconciliation_persists_unknown_without_success_output(self):
        # An unexpected ordinary reconciliation parser/read failure after the PUT
        # must be persisted without a merge SHA or continuation authorization.
        for failure in [http.client.IncompleteRead(b"partial"), RecursionError()]:
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                (root / "event.json").write_text(json.dumps(EVENT))
                api = w.WriterAPI("test-only")
                def interrupted(*args, **kwargs):
                    api.sent = True
                    api.requests.append({"method": "PUT", "route": w.PREFIX + "/pulls/68/merge"})
                    raise failure
                with patch.dict(os.environ, {"RUNNER_TEMP": str(root), "GITHUB_EVENT_PATH": str(root / "event.json"),
                                             "GITHUB_OUTPUT": str(root / "output")}), patch.object(sys, "argv", ["writer", "--execute"]), \
                        patch.object(w, "WriterAPI", return_value=api), patch.object(w, "run_pilot", side_effect=interrupted), \
                        self.assertRaises(SystemExit):
                    w.main()
                result = json.loads((root / "readme-writer/result.json").read_text())
                self.assertEqual(result["outcome"], "merge-unknown")
                self.assertNotIn("merge_sha=", (root / "output").read_text())
                self.assertEqual(len(api.requests), 1)

    def test_wrong_merged_parent_tree_or_head_never_becomes_verified(self):
        for mutation in [lambda r: r["/git/commits/" + S].update(parents=[{"sha": H}]),
                         lambda r: r["/git/commits/" + S].update(tree={"sha": BT}),
                         lambda r: r["/pulls/68"]["head"].update(sha=S)]:
            _, _, _, responses, _ = fixture()
            responses["/pulls/68"]["merged"] = True
            mutation(responses)
            with self.assertRaises(w.collector.EvidenceError):
                w.reconcile_merge(FakeAPI(responses), {"base": B, "head": H, "headTree": HT})

    def test_retry_has_three_fresh_snapshots_and_shared_deadline(self):
        pilot, data, context, responses, observation = fixture()
        api = FakeAPI(responses)
        snapshots = [copy.deepcopy(observation) for _ in range(3)]
        seen = []
        def evaluate(o):
            seen.append(o)
            return {"mode": "report-only", "mergeAuthorized": False, "result": {"eligible": False}}
        with patch.object(w.collector, "collect", side_effect=snapshots) as collect, patch.object(w, "retryable_metadata", return_value=True):
            result = w.run_pilot(pilot, data, {}, b"{}", EVENT, context, api, evaluate, True, api.sleep)
        self.assertEqual(result["outcome"], "ineligible")
        self.assertEqual(len({id(o) for o in seen}), 3)
        self.assertEqual(collect.call_count, 3)
        self.assertEqual(api.now, 420)
        self.assertEqual(api.merges, [])
        self.assertTrue(all(call.args[-1] is api for call in collect.call_args_list))

    def test_backoff_accounts_for_collection_time_and_reserves_reconciliation(self):
        pilot, data, context, responses, observation = fixture()
        api = FakeAPI(responses)
        calls = []
        def collect(*args):
            api.now += 30
            return copy.deepcopy(observation)
        def evaluate(o):
            calls.append(o)
            return {"mode": "report-only", "mergeAuthorized": False, "result": {"eligible": len(calls) == 3}}
        with patch.object(w.collector, "collect", side_effect=collect), patch.object(w, "retryable_metadata", return_value=True):
            result = w.run_pilot(pilot, data, {}, b"{}", EVENT, context, api, evaluate, True, api.sleep)
        self.assertEqual(result["outcome"], "merged")
        self.assertEqual(api.now, 450)
        self.assertEqual(api.merges, [H])

    def test_global_and_phase_budgets_never_reset_together(self):
        api = w.WriterAPI("test-only")
        api.requests = [{}] * 100
        with self.assertRaisesRegex(w.collector.EvidenceError, "collection_budget"):
            api.budget()
        api.begin_phase()
        api.budget()
        self.assertEqual(len(api.requests), 100)
        api.requests = [{}] * 300
        api.begin_phase()
        with self.assertRaisesRegex(w.collector.EvidenceError, "total_budget"):
            api.budget()
        api.requests = []
        api.started -= 601
        api.begin_phase()
        with self.assertRaisesRegex(w.collector.EvidenceError, "total_budget"):
            api.budget()

    def test_actual_transport_uses_captured_token_exact_endpoint_and_no_retry(self):
        class Response(io.BytesIO):
            status = 200
        class Opener:
            requests = []
            def open(self, request, timeout):
                self.requests.append(request)
                return Response(json.dumps({"merged": True, "sha": S}).encode())
        opener = Opener()
        api = w.WriterAPI("captured-test-token", allow_write=True, opener=opener)
        with patch.dict(os.environ, {"GITHUB_TOKEN": "replacement-must-not-be-used"}):
            api.merge(H)
        request = opener.requests[0]
        self.assertEqual(request.method, "PUT")
        self.assertEqual(request.full_url, "https://api.github.com/repos/openboa-ai/openboa/pulls/68/merge")
        self.assertEqual(request.get_header("Authorization"), "Bearer captured-test-token")
        self.assertEqual(json.loads(request.data), {"sha": H, "merge_method": "squash"})
        with self.assertRaises(w.collector.EvidenceError):
            api.merge(H)
        self.assertEqual(len(opener.requests), 1)
        self.assertNotIn("token", json.dumps(api.requests))
        api = w.WriterAPI("captured-test-token", allow_write=True, opener=opener)
        api.bytes = 75 * 1024 * 1024
        with self.assertRaisesRegex(w.collector.EvidenceError, "response_byte_budget"):
            api.merge(H)
        self.assertFalse(api.sent)
        api = w.WriterAPI("captured-test-token", allow_write=True, opener=opener)
        api.phase_started -= 61
        with self.assertRaisesRegex(w.collector.EvidenceError, "reconciliation_budget"):
            api.merge(H)
        self.assertFalse(api.sent)
        self.assertEqual(len(opener.requests), 1)


if __name__ == "__main__":
    unittest.main()
