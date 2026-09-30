#!/usr/bin/env python3
"""Dispatch one fixed main verifier, then observe the exact server-returned run.

No merge capability, candidate checkout, arbitrary workflow/ref, or POST retry.
The Actions write token stays in this trusted job, outside verification runners.
"""
import argparse
import importlib.util
import json
import os
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("dispatch_collector", ROOT / "scripts/collect-merge-evidence.py")
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)
REPOSITORY = "openboa-ai/openboa"
REPOSITORY_ID = 1214829403
PREFIX = "/repos/" + REPOSITORY
WORKFLOW = ".github/workflows/postmerge-verification.yml"
WORKFLOW_ROUTE = PREFIX + "/actions/workflows/postmerge-verification.yml"
EXPECTED_JOBS = {"source-boundary", "verification-result", "full-ci / dependency-audit / audit"}
EXPECTED_JOBS.update("full-ci / " + name for name in (
    "scope", "check", "docs", "secrets", "gitleaks", "policy", "desktop-artifact", "required-ci"))
EXPECTED_JOBS.update("full-codeql / analyze (" + language + ")" for language in (
    "javascript-typescript", "python", "actions"))


def require(value, reason):
    if not value:
        raise collector.EvidenceError(reason)


class DispatchAPI(collector.GitHubGet):
    def __init__(self, token, opener=None):
        super().__init__(REPOSITORY, token, {"requests": 150, "seconds": 3100,
                                           "jsonBytes": 10 * 1024 * 1024}, opener)
        self.sent = False

    def dispatch(self, sha):
        require(not self.sent and collector.SHA.fullmatch(sha), "dispatch_not_repeatable")
        require(len(self.requests) < 140 and self.bytes < 9 * 1024 * 1024, "dispatch_budget_exceeded")
        self.sent = True
        route = WORKFLOW_ROUTE + "/dispatches"
        request = urllib.request.Request("https://api.github.com" + route, method="POST",
            data=json.dumps({"ref": "main", "inputs": {"expected_sha": sha}}).encode(),
            headers={"Authorization": "Bearer " + self.token, "Accept": "application/vnd.github+json",
                     "Content-Type": "application/json", "X-GitHub-Api-Version": "2026-03-10"})
        record = {"method": "POST", "route": route}
        self.requests.append(record)
        # Any error, missing identity or lost response leaves the outcome unknown.
        # Never retry the POST: the server may already have created a run.
        with self.opener.open(request, timeout=20) as response:
            record["status"] = response.status
            raw = response.read(64 * 1024 + 1)
            self.bytes += len(raw)
            require(response.status == 200 and len(raw) <= 64 * 1024, "dispatch_response_unusable")
            record["bodyDigest"] = collector.digest(raw)
            result = collector.decode_json(raw)
        run_id = result.get("workflow_run_id")
        require(collector.positive_int(run_id)
                and result.get("run_url") == "https://api.github.com" + PREFIX + f"/actions/runs/{run_id}"
                and result.get("html_url") == "https://github.com/" + REPOSITORY + f"/actions/runs/{run_id}",
                "dispatch_identity_unavailable")
        return run_id


def verify_run(run, run_id, workflow_id, sha):
    require(run.get("id") == run_id and type(run.get("id")) is int
            and run.get("workflow_id") == workflow_id
            and run.get("repository", {}).get("id") == REPOSITORY_ID
            and run.get("repository", {}).get("full_name") == REPOSITORY
            and run.get("head_repository", {}).get("id") == REPOSITORY_ID
            and run.get("event") == "workflow_dispatch" and run.get("path") == WORKFLOW
            and run.get("head_branch") == "main" and run.get("head_sha") == sha
            and type(run.get("run_attempt")) is int and run["run_attempt"] == 1,
            "verification_run_identity_changed")


def run_identity(run):
    # Descriptive repository/user fields can legitimately change during a run;
    # bind execution identity, not unrelated profile or repository timestamps.
    identity = {key: run.get(key) for key in ("id", "workflow_id", "event", "path", "head_branch",
                                             "head_sha", "run_attempt", "created_at")}
    for key in ("repository", "head_repository", "actor", "triggering_actor"):
        identity[key] = {field: run.get(key, {}).get(field) for field in ("id", "login", "full_name")}
    return identity


def completed_jobs(document, run_id, sha):
    jobs = document.get("jobs")
    require(isinstance(jobs, list) and type(document.get("total_count")) is int
            and document["total_count"] == len(jobs) and len(jobs) <= len(EXPECTED_JOBS),
            "verification_jobs_incomplete_or_over_budget")
    names, ids = set(), set()
    pending = False
    for job in jobs:
        require(job.get("name") in EXPECTED_JOBS and job["name"] not in names
                and collector.positive_int(job.get("id")) and job["id"] not in ids
                and job.get("run_id") == run_id and job.get("run_attempt") == 1
                and job.get("head_sha") == sha, "verification_job_identity_changed")
        names.add(job["name"])
        ids.add(job["id"])
        if job.get("status") != "completed" and job.get("conclusion") is None:
            pending = True
        else:
            require(job.get("status") == "completed" and job.get("conclusion") == "success",
                    "verification_job_not_successful")
    return names == EXPECTED_JOBS and not pending


def run_verification(api, sha, context, execute=False, sleep=time.sleep, persist=lambda _: None):
    require(isinstance(sha, str) and collector.SHA.fullmatch(sha), "invalid_confirmed_merge_sha")
    base = context.get("GITHUB_SHA", "")
    require(context.get("GITHUB_REPOSITORY") == REPOSITORY
            and context.get("GITHUB_EVENT_NAME") in ("schedule", "workflow_dispatch")
            and context.get("GITHUB_REF") == "refs/heads/main"
            and base == context.get("GITHUB_WORKFLOW_SHA") and collector.SHA.fullmatch(base),
            "dispatcher_context_invalid")
    commit = api.get(PREFIX + "/git/commits/" + sha)
    require(commit.get("sha") == sha and [p.get("sha") for p in commit.get("parents", [])] == [base],
            "confirmed_merge_parent_changed")
    workflow = api.get(WORKFLOW_ROUTE)
    workflow_id = workflow.get("id")
    require(collector.positive_int(workflow_id) and workflow.get("path") == WORKFLOW
            and workflow.get("state") == "active", "verification_workflow_unavailable")
    require(api.get(PREFIX + "/git/ref/heads/main").get("object", {}).get("sha") == sha,
            "main_changed_before_dispatch")
    if not execute:
        return {"outcome": "dry-run-ready", "verified": False, "commit": sha}
    persist({"outcome": "dispatch-prepared", "verified": False, "commit": sha, "workflowId": workflow_id})
    run_id = api.dispatch(sha)
    state = {"outcome": "verification-pending", "verified": False, "commit": sha,
             "workflowId": workflow_id, "runId": run_id, "attempt": 1}
    persist(state)
    identity = None
    for poll in range(101):
        try:
            run = api.get(PREFIX + f"/actions/runs/{run_id}")
        except collector.EvidenceError as error:
            if error.status == 404 and poll < 5 and identity is None:
                sleep(30)
                continue
            raise
        verify_run(run, run_id, workflow_id, sha)
        stable = run_identity(run)
        require(identity is None or identity == stable, "verification_run_metadata_drift")
        identity = stable
        if run.get("status") == "completed":
            require(run.get("conclusion") == "success", "postmerge_verification_failed")
            previous = {}
            for refresh in range(3):
                document = api.get(PREFIX + f"/actions/runs/{run_id}/attempts/1/jobs?per_page=100")
                complete = completed_jobs(document, run_id, sha)
                current = {job["id"]: job for job in document["jobs"]}
                for job_id, old in previous.items():
                    require(job_id in current and all(current[job_id].get(key) == old.get(key)
                            for key in ("id", "name", "run_id", "run_attempt", "head_sha", "started_at")),
                            "verification_job_metadata_drift")
                    if old.get("status") == "completed":
                        require(all(current[job_id].get(key) == old.get(key) for key in
                                    ("status", "conclusion", "completed_at")), "verification_terminal_job_changed")
                previous = current
                if complete:
                    final = api.get(PREFIX + f"/actions/runs/{run_id}")
                    verify_run(final, run_id, workflow_id, sha)
                    require(run_identity(final) == identity
                            and final.get("status") == "completed" and final.get("conclusion") == "success",
                            "verification_run_changed_after_jobs")
                    return {**state, "outcome": "verified", "verified": True}
                if refresh < 2:
                    sleep(15)
            raise collector.EvidenceError("verification_job_metadata_unavailable")
        require(run.get("status") in ("queued", "in_progress", "waiting", "requested", "pending")
                and run.get("conclusion") is None, "verification_run_not_pending_or_successful")
        if poll < 100:
            sleep(30)
    raise collector.EvidenceError("postmerge_verification_timed_out")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    directory = Path(os.environ["RUNNER_TEMP"]) / "postmerge-dispatch"
    directory.mkdir(parents=True, exist_ok=True)
    api = DispatchAPI(os.environ.pop("GITHUB_TOKEN", ""))
    state = {}
    def persist(value):
        state.update(value)
        (directory / "result.json").write_text(json.dumps(state, indent=2) + "\n", encoding="utf8")
    try:
        persist(run_verification(api, os.environ.get("CONFIRMED_MERGE_SHA"), os.environ,
                                 execute=args.execute, persist=persist))
    except Exception as error:
        persist({"outcome": "verification-unconfirmed", "verified": False, "dispatchAttempted": api.sent,
                 "reason": error.code if isinstance(error, collector.EvidenceError) else "dispatch_or_observation_failed"})
    finally:
        (directory / "requests.json").write_text(json.dumps(api.requests, indent=2) + "\n", encoding="utf8")
    print(json.dumps(state))
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf8") as summary:
        summary.write("Postmerge verification: " + state["outcome"] + ".\n")
    if state["outcome"] not in ("verified", "dry-run-ready"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
