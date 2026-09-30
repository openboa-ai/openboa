#!/usr/bin/env python3
"""Default-OFF, one-PR writer. Fresh evidence is necessary, never portable authority."""

import argparse
import copy
import importlib.util
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("merge_collector", ROOT / "scripts/collect-merge-evidence.py")
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)
PREFIX = "/repos/openboa-ai/openboa"
WORKFLOW = ".github/workflows/readme-writer-pilot.yml"
PILOT_PATH = ".github/readme-writer-policy.json"
EXPECTED = {"schemaVersion": 1, "repository": "openboa-ai/openboa", "pullRequest": 68,
            "path": "README.md", "oldBlob": "1f91d44dbd4482ec7f4c63816871c749dd3620ac",
            "newBlob": "69e48877815a57cb5acbf5497663381010a3b3db"}


def require(value, reason):
    if not value:
        raise collector.EvidenceError(reason)


def validate_pilot(pilot):
    require(isinstance(pilot, dict) and set(pilot) == set(EXPECTED) | {"enabled"}
            and type(pilot["enabled"]) is bool
            and all(type(pilot[k]) is type(v) and pilot[k] == v for k, v in EXPECTED.items()), "pilot_scope_changed")


class WriterAPI(collector.GitHubGet):
    """One captured credential; fixed endpoint, one PUT, no redirects or retry."""
    def __init__(self, token, allow_write=False, opener=None, clock=time.monotonic):
        super().__init__(EXPECTED["repository"], token, {
            "requests": 300, "seconds": 600, "jsonBytes": 75 * 1024 * 1024}, opener)
        self.clock, self.started = clock, clock()
        self.allow_write, self.sent, self.downloaded_bytes = allow_write, False, 0
        self.begin_phase()

    def begin_phase(self):
        self.phase_started, self.phase_requests = self.clock(), len(self.requests)

    def budget(self, requests=1):
        require(self.clock() - self.started < 600 and len(self.requests) + requests <= 300,
                "writer_total_budget_exceeded")
        require(self.clock() - self.phase_started < 120
                and len(self.requests) - self.phase_requests + requests <= 100,
                "writer_collection_budget_exceeded")

    def get(self, route):
        self.budget()
        self.limits["jsonBytes"] = 75 * 1024 * 1024 - self.downloaded_bytes
        return super().get(route)

    def download_artifact(self, artifact_id):
        self.budget(2)
        self.limits["archiveBytes"] = min(20 * 1024 * 1024, 75 * 1024 * 1024 - self.bytes - self.downloaded_bytes)
        require(self.limits["archiveBytes"] > 0, "writer_byte_budget_exceeded")
        raw = super().download_artifact(artifact_id)
        self.downloaded_bytes += len(raw)
        return raw

    def merge(self, head):
        require(self.allow_write and not self.sent and collector.SHA.fullmatch(head),
                "write_not_enabled_or_already_attempted")
        self.budget()
        # Reserve the PUT and two bounded reconciliation GETs before any effect.
        require(self.clock() - self.started <= 540 and self.clock() - self.phase_started <= 60
                and len(self.requests) + 3 <= 300
                and len(self.requests) - self.phase_requests + 3 <= 100,
                "insufficient_merge_reconciliation_budget")
        require(self.bytes + self.downloaded_bytes + 1024 * 1024 + 1 <= 75 * 1024 * 1024,
                "insufficient_merge_response_byte_budget")
        self.sent = True  # An ambiguous transport failure must never permit a resend.
        route = PREFIX + "/pulls/68/merge"
        request = urllib.request.Request("https://api.github.com" + route, method="PUT",
            data=json.dumps({"sha": head, "merge_method": "squash"}).encode(),
            headers={"Authorization": "Bearer " + self.token,
                     "Accept": "application/vnd.github+json", "Content-Type": "application/json",
                     "X-GitHub-Api-Version": "2022-11-28"})
        record = {"method": "PUT", "route": route}
        self.requests.append(record)
        try:
            with self.opener.open(request, timeout=20) as response:
                record["status"] = response.status
                raw = response.read(1024 * 1024 + 1)
                self.bytes += len(raw)
                require(len(raw) <= 1024 * 1024, "merge_response_over_budget")
                record["bodyDigest"] = collector.digest(raw)
                result = collector.decode_json(raw)
                require(isinstance(result, dict) and result.get("merged") is True
                        and isinstance(result.get("sha"), str) and collector.SHA.fullmatch(result["sha"]),
                        "invalid_merge_response")
                return result
        except urllib.error.HTTPError as error:
            record["status"] = error.code
            if error.code in (401, 403, 404, 405, 409, 422):
                raise collector.EvidenceError("merge_rejected", error.code) from error
            raise collector.EvidenceError("merge_outcome_unknown", error.code) from error
        except Exception as error:
            # Any ordinary failure after send is ambiguous, including HTTP parser,
            # bounded-read and JSON/schema errors. Cancellation is not swallowed.
            record["responseError"] = "unusable_response"
            raise collector.EvidenceError("merge_outcome_unknown") from error


def current_scope(api, pilot, context, pilot_bytes):
    """Read the live tuple, complete trees, exact reviewed blobs and kill switches."""
    main = api.get(PREFIX + "/git/ref/heads/main")["object"]["sha"]
    require(main == context.get("GITHUB_WORKFLOW_SHA") == context.get("GITHUB_SHA")
            and collector.SHA.fullmatch(main), "controller_or_base_changed")
    workflow = api.get(PREFIX + "/actions/workflows/readme-writer-pilot.yml")
    require(workflow.get("path") == WORKFLOW and workflow.get("state") == "active",
            "writer_workflow_disabled")
    pull = api.get(PREFIX + "/pulls/68")
    require(pull.get("number") == 68 and pull.get("state") == "open"
            and pull.get("merged") is False and pull.get("draft") is False,
            "pilot_pr_closed_merged_or_draft")
    head = pull.get("head", {}).get("sha", "")
    require(collector.SHA.fullmatch(head) and pull.get("base", {}).get("sha") == main
            and pull["base"].get("ref") == "main"
            and pull["base"].get("repo", {}).get("id") == 1214829403
            and pull["head"].get("repo", {}).get("id") == 1214829403,
            "pilot_pr_identity_changed")
    require(pull.get("mergeable") is True and pull.get("mergeable_state") == "clean",
            "pilot_not_mergeable_clean")
    _, base_tree = collector.read_tree(api, PREFIX, main, collector.DEFAULT_LIMITS)
    head_commit, head_tree = collector.read_tree(api, PREFIX, head, collector.DEFAULT_LIMITS)
    changed = {p for p in base_tree.keys() | head_tree.keys() if base_tree.get(p) != head_tree.get(p)
               and any(e and e.get("type") != "tree" for e in (base_tree.get(p), head_tree.get(p)))}
    require(changed == {"README.md"}, "pilot_tree_change_not_exact")
    for tree, blob in ((base_tree, pilot["oldBlob"]), (head_tree, pilot["newBlob"])):
        require(tree.get("README.md") == {"mode": "100644", "type": "blob", "sha": blob},
                "pilot_readme_blob_or_mode_changed")
    entry = base_tree.get(PILOT_PATH, {})
    require(entry.get("mode") == "100644" and entry.get("type") == "blob",
            "pilot_policy_not_regular")
    require(collector.blob_sha256(api, PREFIX, entry["sha"], collector.DEFAULT_LIMITS)
            == collector.digest(pilot_bytes), "pilot_policy_changed_or_disabled")
    return {"base": main, "head": head, "headTree": head_commit["tree"]["sha"]}


def retryable_metadata(observation, evidence_policy):
    try:
        return clean_metadata_gap(observation, evidence_policy)
    except (collector.EvidenceError, KeyError, TypeError, ValueError, AttributeError):
        return False


def clean_metadata_gap(observation, evidence_policy):
    """Only the observed successful-job metadata gap; no finding or negative retry."""
    state = observation.get("collection", {})
    blockers = state.get("blockers", [])
    if state.get("status") != "blocked" or state.get("errors") or not blockers:
        return False
    allowed = ("required_job_steps_unavailable:", "workflow_execution_source_unavailable:",
               "source_receipt_unavailable_or_unverified:")
    if any(not b.startswith(allowed) for b in blockers):
        return False
    protection = observation["protection"]
    rules = protection["rules"]
    require(sorted(r["type"] for r in rules) == sorted(evidence_policy["expectedRuleTypes"]), "retry_rule_set")
    by_type = {r["type"]: r for r in rules}
    status_rule = by_type["required_status_checks"]["parameters"]
    expected_checks = evidence_policy["evaluation"]["requiredChecks"]
    require(status_rule.get("strict_required_status_checks_policy") is True
            and sorted((c["context"], c["integration_id"]) for c in status_rule["required_status_checks"])
            == sorted((c["context"], c["appId"]) for c in expected_checks), "retry_unsafe_status_rule")
    require(by_type["code_quality"]["parameters"].get("severity") == "errors"
            and by_type["code_scanning"]["parameters"].get("code_scanning_tools") == [{
                "tool": "CodeQL", "security_alerts_threshold": "high_or_higher", "alerts_threshold": "errors"}],
            "retry_unsafe_scanner_rule")
    details = protection["ruleDetails"]
    require(protection.get("ruleDetailStatus") == "verified"
            and protection.get("ruleDetailRereadStatus") == "unchanged"
            and details == protection["ruleDetailsAfter"] and details
            and {d["id"] for d in details} == {r["ruleset_id"] for r in rules}
            and all(d.get("enforcement") == "active" and d.get("current_user_can_bypass") == "never" for d in details),
            "retry_unsafe_principal_rule")
    for expected in expected_checks:
        checks = [c for c in protection["checkRuns"] if c.get("name") == expected["context"]]
        require(len(checks) == 1 and checks[0].get("status") == "completed"
                and checks[0].get("conclusion") == "success"
                and checks[0].get("head_sha") == observation["pullRequest"]["headSha"]
                and checks[0].get("app", {}).get("id") == expected["appId"], "retry_negative_required_check")
    require(all(s.get("state") == "success" for s in protection["statuses"]), "retry_negative_status")
    sarif = observation.get("rawSarif", [])
    if len(sarif) != 3 or any(r.get("status") != "verified" for r in sarif):
        return False
    if {r.get("language") for r in sarif} != {"javascript-typescript", "python", "actions"}:
        return False
    for envelope in sarif:
        raw = envelope.get("rawSarif")
        if not isinstance(raw, str) or collector.digest(raw.encode()) != envelope.get("sarifDigest"):
            return False
        try:
            parsed = collector.decode_json(raw)
        except collector.EvidenceError:
            return False
        if (parsed != envelope.get("sarif") or parsed.get("version") != "2.1.0"
                or parsed.get("inlineExternalProperties", []) != []
                or not isinstance(parsed.get("runs"), list) or len(parsed["runs"]) != 1):
            return False
        run = parsed["runs"][0]
        if (run.get("results") != [] or run.get("tool", {}).get("driver", {}).get("name") != "CodeQL"
                or run.get("tool", {}).get("driver", {}).get("semanticVersion") != evidence_policy["evaluation"]["codeqlVersion"]
                or run.get("automationDetails", {}).get("id") != evidence_policy["evaluation"]["sarifCategories"][envelope["language"]]
                or "conversion" in run or run.get("externalPropertyFileReferences", {}) != {}
                or not isinstance(run.get("invocations"), list) or not run["invocations"]
                or any(i.get("executionSuccessful") is not True
                       or any(n.get("level") not in ("none", "note") for n in
                              i.get("toolExecutionNotifications", []) + i.get("toolConfigurationNotifications", []))
                       for i in run["invocations"])):
            return False
    specs = {s["id"]: s for s in evidence_policy["workflows"]}
    observed_workflows = observation.get("workflows", []) + [observation.get("platformGate", {})]
    require(sorted(w["workflowId"] for w in observed_workflows) == sorted(specs), "retry_workflow_set")
    saw_gap = False
    for workflow in observation.get("workflows", []) + [observation.get("platformGate", {})]:
        if workflow.get("status") != "completed" or workflow.get("conclusion") != "success":
            return False
        expected = next((r for r in evidence_policy["evaluation"]["runs"] if r["workflowId"] == workflow["workflowId"]), None)
        names = ([j["name"] for j in expected["jobs"]] if expected else evidence_policy["evaluation"]["platformGate"]["jobs"])
        require(sorted(j["name"] for j in workflow["jobs"]) == sorted(names), "retry_job_set")
        for job in workflow.get("jobs", []):
            optional = specs[workflow["workflowId"]]["role"] == "ci" and job["name"] in ("check", "desktop-artifact")
            require(job.get("status") == "completed" and (job.get("conclusion") == "success"
                    or optional and job.get("conclusion") == "skipped" and job.get("steps") == []), "retry_negative_job")
            required = collector.required_steps(evidence_policy, specs[workflow["workflowId"]], job["name"])
            if any(s.get("name") in required and s.get("conclusion") not in (None, "success")
                   for s in job.get("steps", [])):
                return False
            refresh = job.get("stepRefresh", {})
            if refresh.get("status") == "unavailable":
                if refresh.get("reason") != "required_job_steps_incomplete":
                    return False
                saw_gap = True
        proof = workflow.get("sourceProof", {})
        if proof and proof.get("status") not in ("verified", "platform-managed"):
            require(proof == {"status": "unavailable", "revision": None, "kind": None}, "retry_unknown_source_gap")
        receipt = workflow.get("sourceReceipt", {})
        if receipt and receipt.get("status") != "verified" and receipt.get("reason") != "receipt_upload_step_not_successful":
            return False
    return saw_gap


def retry_binding(observation):
    """Freeze every observation fact except explicitly permitted metadata completion.

    This is a comparison only, never an input to the evaluator. Unknown fields
    stay bound. A fresh naturally eligible snapshot must still satisfy the full
    unchanged evaluator; no earlier negative can disappear between collections.
    """
    value = copy.deepcopy(observation)
    value.pop("collection", None)
    for field in ("startedAt", "finishedAt"):
        value.get("collector", {}).pop(field, None)
    value.get("observations", {}).pop("requests", None)
    value.get("protection", {}).pop("pages", None)
    value.get("files", {}).pop("pages", None)
    for inventory in value.get("artifactInventories", []):
        inventory.pop("pages", None)
    for workflow in value.get("workflows", []) + [value.get("platformGate", {})]:
        for field in ("pages", "sourceProof", "sourceReceipt"):
            workflow.pop(field, None)
        for job in workflow.get("jobs", []):
            job.pop("steps", None)
            job.pop("stepRefresh", None)
    return value


def require_monotonic_metadata(previous, current):
    require(retry_binding(previous) == retry_binding(current), "retry_immutable_evidence_changed")
    current_runs = {r["workflowId"]: r for r in current.get("workflows", []) + ([current["platformGate"]] if "platformGate" in current else [])}
    for old in previous.get("workflows", []) + ([previous["platformGate"]] if "platformGate" in previous else []):
        new = current_runs[old["workflowId"]]
        for field in ("sourceProof", "sourceReceipt"):
            proof = old.get(field, {})
            if proof.get("status") in ("verified", "platform-managed"):
                require(proof == new.get(field), "retry_verified_proof_changed")
        for job in old.get("jobs", []):
            fresh = next(j for j in new["jobs"] if j["id"] == job["id"])
            for step in job.get("steps", []):
                matches = [s for s in fresh["steps"] if s.get("number") == step.get("number")]
                require(len(matches) == 1 and matches[0].get("name") == step.get("name"), "retry_step_identity_changed")
                if step.get("status") == "completed" or step.get("conclusion") is not None:
                    require(matches[0] == step, "retry_terminal_step_changed")


def reconcile_merge(api, scope, response=None):
    """Read-only reconciliation; preserve the returned merge SHA, never substitute latest main."""
    pull = api.get(PREFIX + "/pulls/68")
    require(pull.get("merged") is True and pull.get("head", {}).get("sha") == scope["head"],
            "merge_outcome_unknown")
    sha = pull.get("merge_commit_sha", "")
    require(collector.SHA.fullmatch(sha) and (response is None or response.get("sha") == sha
            and response.get("merged") is True), "merge_outcome_unknown")
    commit = api.get(PREFIX + "/git/commits/" + sha)
    require(commit.get("sha") == sha and [p.get("sha") for p in commit.get("parents", [])] == [scope["base"]]
            and commit.get("tree", {}).get("sha") == scope["headTree"], "merged_commit_unverified")
    return sha


def run_pilot(pilot, pilot_bytes, evidence_policy, evidence_bytes, event, context,
              api, evaluate, execute=False, sleep=time.sleep, persist_intent=lambda _: None):
    validate_pilot(pilot)
    if not pilot["enabled"] or context.get("WRITER_ENABLED") != "true":
        return {"outcome": "disabled", "mergeAttempted": False}
    require(context.get("GITHUB_REPOSITORY") == EXPECTED["repository"]
            and context.get("GITHUB_EVENT_NAME") in ("schedule", "workflow_dispatch")
            and context.get("GITHUB_REF") == "refs/heads/main", "writer_context_invalid")
    credential = api.token
    previous = None
    for attempt in range(3):
        api.begin_phase()
        scope = current_scope(api, pilot, context, pilot_bytes)
        observation = collector.collect(evidence_policy, event, context, api, pilot_number=68)
        observation["collector"]["policyFileDigest"] = collector.digest(evidence_bytes)
        require(api.token == credential, "writer_credential_changed")
        require(observation.get("pullRequest", {}).get("number") == 68
                and observation["pullRequest"].get("baseSha") == scope["base"]
                and observation["pullRequest"].get("headSha") == scope["head"], "pilot_collection_tuple_changed")
        if previous is not None:
            require_monotonic_metadata(previous, observation)
        report = evaluate(observation)
        require(report.get("mode") == "report-only" and report.get("mergeAuthorized") is False,
                "evidence_is_not_report_only")
        if report.get("result", {}).get("eligible") is True:
            break
        if attempt == 2 or not retryable_metadata(observation, evidence_policy):
            return {"outcome": "ineligible", "mergeAttempted": False, "collections": attempt + 1}
        # No old observation is reused. The same client retains global time/byte/request limits.
        previous = copy.deepcopy(observation)
        # Leave up to 120s for the next collection and 60s for PUT/reconciliation.
        # The second wait shortens as the shared deadline approaches.
        delay = min(240, 600 - (api.clock() - api.started) - 180)
        require(delay >= 30, "writer_retry_deadline_exceeded")
        sleep(delay)
    require(current_scope(api, pilot, context, pilot_bytes) == scope, "pilot_changed_before_merge")
    protection = observation["protection"]
    require(api.get(PREFIX + "/rules/branches/main") == protection["rules"], "rules_changed_before_merge")
    for detail in protection["ruleDetailsAfter"]:
        fresh = api.get(PREFIX + f"/rulesets/{detail['id']}")
        require(fresh == detail and fresh.get("current_user_can_bypass") == "never",
                "principal_or_rules_changed_before_merge")
    require(api.token == credential, "writer_credential_changed")
    require(api.get(PREFIX + "/git/ref/heads/main")["object"]["sha"] == scope["base"],
            "base_changed_before_merge")
    require(api.get(PREFIX + "/actions/workflows/readme-writer-pilot.yml").get("state") == "active",
            "writer_workflow_disabled")
    if not execute:
        return {"outcome": "dry-run-eligible", "mergeAttempted": False, "head": scope["head"]}
    persist_intent({"outcome": "merge-prepared", "base": scope["base"], "head": scope["head"],
                    "headTree": scope["headTree"], "method": "squash"})
    response = None
    try:
        response = api.merge(scope["head"])
    except collector.EvidenceError as error:
        if error.code != "merge_outcome_unknown":
            raise
    sha = reconcile_merge(api, scope, response)
    return {"outcome": "merged", "mergeAttempted": True, "mergeSha": sha, "base": scope["base"], "head": scope["head"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    pilot_bytes = (ROOT / PILOT_PATH).read_bytes()
    pilot = collector.decode_json(pilot_bytes)
    validate_pilot(pilot)
    if args.prepare:
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf8") as output:
            output.write("enabled=" + str(pilot["enabled"]).lower() + "\n")
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf8") as summary:
            summary.write("README writer policy is " + ("enabled" if pilot["enabled"] else "OFF; no writer job is authorized") + ".\n")
        return
    output_dir = Path(os.environ["RUNNER_TEMP"]) / "readme-writer"
    output_dir.mkdir(parents=True, exist_ok=True)
    token = os.environ.pop("GITHUB_TOKEN", "")  # Node evaluator never receives this credential.
    api = WriterAPI(token, allow_write=args.execute)
    evidence_bytes = (ROOT / ".github/merge-canary-policy.json").read_bytes()
    policy = collector.decode_json(evidence_bytes)
    event_bytes = Path(os.environ["GITHUB_EVENT_PATH"]).read_bytes()
    require(len(event_bytes) <= 5 * 1024 * 1024, "event_over_budget")

    collection_number = 0

    def evaluate(observation):
        nonlocal collection_number
        collection_number += 1
        observations_path = output_dir / f"observations-{collection_number}.json"
        evidence_path = output_dir / f"evidence-{collection_number}.json"
        observations_path.write_text(json.dumps(observation), encoding="utf8")
        subprocess.run(["node", "scripts/evaluate-merge-canary.mjs", "--policy", ".github/merge-canary-policy.json",
                        "--observations", str(observations_path), "--evaluator",
                        ".merge-evaluator/lib/evaluate-merge-evidence.mjs", "--output", str(evidence_path)],
                       cwd=ROOT, check=True, timeout=30, stdout=subprocess.DEVNULL)
        return collector.decode_json(evidence_path.read_bytes())

    try:
        result = run_pilot(pilot, pilot_bytes, policy, evidence_bytes, collector.decode_json(event_bytes),
                           os.environ, api, evaluate, execute=args.execute,
                           persist_intent=lambda intent: (output_dir / "intent.json").write_text(
                               json.dumps(intent, indent=2) + "\n", encoding="utf8"))
    except Exception as error:
        result = {"outcome": ("merge-denied" if isinstance(error, collector.EvidenceError) and error.code == "merge_rejected"
                              else "merge-unknown" if api.sent else "blocked"), "mergeAttempted": api.sent,
                  "reason": error.code if isinstance(error, collector.EvidenceError) else "writer_execution_failed"}
    (output_dir / "requests.json").write_text(json.dumps(api.requests, indent=2) + "\n", encoding="utf8")
    (output_dir / "result.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf8")
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf8") as output:
        output.write("outcome=" + result["outcome"] + "\n")
        if "mergeSha" in result:
            output.write("merge_sha=" + result["mergeSha"] + "\n")
    print(json.dumps(result))
    if result["outcome"] in ("blocked", "merge-denied", "merge-unknown"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
