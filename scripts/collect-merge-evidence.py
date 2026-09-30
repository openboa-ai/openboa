#!/usr/bin/env python3
"""Collect bounded, read-only GitHub observations. Never authorizes or merges a PR."""

import argparse
import base64
import hashlib
import io
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

SHA = re.compile(r"[0-9a-f]{40}\Z")
REPO = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\Z")
DEFAULT_LIMITS = {"requests": 100, "jsonBytes": 25 * 1024 * 1024,
                  "seconds": 120, "changedFiles": 200, "pages": 10,
                  "treeEntries": 50000, "blobBytes": 1024 * 1024,
                  "archiveBytes": 20 * 1024 * 1024, "expandedBytes": 100 * 1024 * 1024}
REPORT_PRINCIPAL = {"kind": "current-request-credential", "scope": "report-only-collector"}


class EvidenceError(Exception):
    def __init__(self, code, status=None):
        super().__init__(code)
        self.code, self.status = code, status


def digest(value):
    return hashlib.sha256(value).hexdigest()


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def object_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise EvidenceError("duplicate_json_key")
        result[key] = value
    return result


def decode_json(raw):
    try:
        return json.loads(raw, object_pairs_hook=object_pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(
                              EvidenceError("nonfinite_json_number")))
    except (UnicodeError, ValueError, RecursionError) as error:
        raise EvidenceError("invalid_json") from error


def positive_int(value):
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def safe_path(value):
    return (isinstance(value, str) and 0 < len(value) <= 512
            and not value.startswith("/") and "\\" not in value
            and all(part not in ("", ".", "..") for part in value.split("/"))
            and not any(ord(char) < 32 or ord(char) == 127 for char in value))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GitHubGet:
    """No caller-provided origin, redirects, request body or mutation method."""

    def __init__(self, repository, token, limits=None, opener=None):
        if not REPO.fullmatch(repository) or not token:
            raise EvidenceError("invalid_api_configuration")
        self.prefix = "/repos/" + repository
        self._token = token
        self.limits = {**DEFAULT_LIMITS, **(limits or {})}
        self.started = time.monotonic()
        self.bytes = 0
        self.requests = []
        self.opener = opener or urllib.request.build_opener(NoRedirect())

    @property
    def token(self):
        # One credential for the entire collection; never serialize it or a fingerprint.
        return self._token

    def get(self, route):
        if (not isinstance(route, str) or not route.startswith(self.prefix + "/")
                or "#" in route or "\\" in route
                or any(ord(c) < 32 for c in route)
                or ".." in urllib.parse.urlsplit(route).path.split("/")):
            raise EvidenceError("api_route_rejected")
        if (len(self.requests) >= self.limits["requests"]
                or time.monotonic() - self.started > self.limits["seconds"]):
            raise EvidenceError("collection_budget_exceeded")
        record = {"method": "GET", "route": route, "principal": dict(REPORT_PRINCIPAL)}
        self.requests.append(record)
        request = urllib.request.Request(
            "https://api.github.com" + route, method="GET",
            headers={"Authorization": "Bearer " + self.token,
                     "Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28",
                     "User-Agent": "openboa-read-only-merge-canary"})
        try:
            with self.opener.open(request, timeout=20) as response:
                record["status"] = response.status
                remaining = self.limits["jsonBytes"] - self.bytes
                raw = response.read(remaining + 1)
        except urllib.error.HTTPError as error:
            record["status"] = error.code
            raise EvidenceError("github_http_error", error.code) from error
        except (OSError, urllib.error.URLError) as error:
            raise EvidenceError("github_transport_error") from error
        self.bytes += len(raw)
        if self.bytes > self.limits["jsonBytes"]:
            raise EvidenceError("json_budget_exceeded")
        record["bodyDigest"] = digest(raw)
        return decode_json(raw)

    def download_artifact(self, artifact_id):
        if not positive_int(artifact_id) or len(self.requests) + 2 > self.limits["requests"]:
            raise EvidenceError("artifact_request_budget_or_identity")
        route = self.prefix + f"/actions/artifacts/{artifact_id}/zip"
        record = {"route": route}
        self.requests.append(record)
        request = urllib.request.Request("https://api.github.com" + route, method="GET",
            headers={"Authorization": "Bearer " + self.token,
                     "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})
        try:
            response = self.opener.open(request, timeout=20)
            response.close()
            raise EvidenceError("artifact_redirect_missing")
        except urllib.error.HTTPError as error:
            record["status"] = error.code
            if error.code != 302:
                raise EvidenceError("artifact_http_error", error.code) from error
            location = error.headers.get("Location", "")
        except (OSError, urllib.error.URLError) as error:
            raise EvidenceError("artifact_transport_error") from error
        parsed = urllib.parse.urlsplit(location)
        if (parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443)
                or not parsed.hostname or not parsed.hostname.endswith(".blob.core.windows.net")):
            raise EvidenceError("artifact_download_origin_rejected")
        if time.monotonic() - self.started > self.limits["seconds"]:
            raise EvidenceError("collection_budget_exceeded")
        # A fresh GET deliberately omits Authorization. Never retain signed URLs.
        download_record = {"route": f"artifact:{artifact_id}:signed-download"}
        self.requests.append(download_record)
        try:
            with self.opener.open(urllib.request.Request(location, method="GET"), timeout=20) as response:
                download_record["status"] = response.status
                raw = response.read(self.limits["archiveBytes"] + 1)
        except (OSError, urllib.error.URLError) as error:
            raise EvidenceError("artifact_download_error") from error
        if len(raw) > self.limits["archiveBytes"]:
            raise EvidenceError("artifact_compressed_budget_exceeded")
        download_record["bodyDigest"] = digest(raw)
        return raw


def artifact_members(api, artifact, expected_names, limits):
    """Inspect exact flat ZIP members in memory; never extract candidate paths."""
    if not positive_int(artifact.get("id")) or artifact.get("expired") is not False:
        raise EvidenceError("artifact_missing_expired_or_invalid")
    expected_digest = artifact.get("digest", "")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", expected_digest):
        raise EvidenceError("artifact_digest_unavailable")
    raw = api.download_artifact(artifact["id"])
    if "sha256:" + digest(raw) != expected_digest:
        raise EvidenceError("artifact_digest_mismatch")
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = archive.infolist()
            names = [entry.filename for entry in entries]
            if len(names) != len(set(names)) or set(names) != set(expected_names):
                raise EvidenceError("artifact_members_mismatch")
            if sum(entry.file_size for entry in entries) > limits["expandedBytes"]:
                raise EvidenceError("artifact_expanded_budget_exceeded")
            result = {}
            for entry in entries:
                mode = (entry.external_attr >> 16) & 0o170000
                if (not safe_path(entry.filename) or "/" in entry.filename or mode not in (0, 0o100000)
                        or (entry.external_attr >> 16) & 0o111 or entry.flag_bits & 1 or entry.is_dir()):
                    raise EvidenceError("artifact_nonregular_member")
                content = archive.read(entry)
                try:
                    raw_text = content.decode("utf-8", "strict")
                except UnicodeError as error:
                    raise EvidenceError("artifact_json_not_utf8") from error
                result[entry.filename] = {"digest": digest(content), "data": decode_json(raw_text), "text": raw_text}
            return result
    except (zipfile.BadZipFile, RuntimeError, OSError) as error:
        raise EvidenceError("artifact_invalid_zip") from error


def receipt_proof(api, prefix, artifact, receipt, workflow, expected, jobs, main, head, number, repo_id, workflow_hash):
    """Correlate a trusted inline receipt; this is not cryptographic attestation."""
    expected_job, expected_step = expected["jobName"], expected["stepName"]
    matches = [j for j in jobs if j.get("name") == expected_job]
    if len(matches) != 1:
        raise EvidenceError("receipt_producer_job_ambiguous")
    job = matches[0]
    upload = [s for s in job["steps"] if s.get("name") == expected_step]
    if len(upload) != 1 or upload[0].get("status") != "completed" or upload[0].get("conclusion") != "success":
        raise EvidenceError("receipt_upload_step_not_successful")
    arun = artifact.get("workflow_run", {})
    if arun.get("id") != workflow["runId"] or arun.get("repository_id") != repo_id or arun.get("head_sha") != head:
        raise EvidenceError("artifact_run_identity_mismatch")
    values = {"schemaVersion": 1, "repositoryId": repo_id, "runId": workflow["runId"],
              "runAttempt": workflow["attempt"], "workflowPath": workflow["path"], "event": "pull_request",
              "headSha": head, "baseSha": main, "jobName": expected_job,
              "workflowSha256": workflow_hash}
    if (not isinstance(receipt, dict) or any(receipt.get(k) != v for k, v in values.items())
            or any(not positive_int(receipt.get(k)) for k in ("schemaVersion", "repositoryId", "runId", "runAttempt"))):
        raise EvidenceError("receipt_identity_mismatch")
    checkout = receipt.get("checkoutSha", "")
    full_name = prefix.removeprefix("/repos/")
    if (not isinstance(checkout, str) or not SHA.fullmatch(checkout)
            or receipt.get("eventSha") != checkout or receipt.get("workflowSha") != checkout
            or receipt.get("repository") != full_name
            or receipt.get("workflowRef") != full_name + "/" + workflow["path"] + f"@refs/pull/{number}/merge"
            or receipt.get("parents") != [main, head]):
        raise EvidenceError("receipt_source_identity_mismatch")
    commit = api.get(prefix + "/git/commits/" + checkout)
    if (commit.get("sha") != checkout or [p.get("sha") for p in commit.get("parents", [])] != [main, head]
            or commit.get("tree", {}).get("sha") != receipt.get("sourceTree")):
        raise EvidenceError("receipt_commit_parents_mismatch")
    try:
        created = datetime.fromisoformat(artifact["created_at"].replace("Z", "+00:00"))
        start = datetime.fromisoformat(job["started_at"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(job["completed_at"].replace("Z", "+00:00"))
        if not start <= created <= end:
            raise EvidenceError("artifact_outside_producer_job_time")
    except (KeyError, AttributeError, ValueError, TypeError) as error:
        raise EvidenceError("artifact_producer_time_unavailable") from error
    return {"status": "verified", "revision": checkout,
            "kind": "trusted-inline-receipt-platform-correlation", "jobId": job["id"],
            "artifactId": artifact["id"], "nativeAttemptJobBinding": False,
            "cryptographicAttestation": False, "receipt": receipt}


def paginated(api, route, key=None, limit=1000, pages=10):
    values, records, advertised = [], [], None
    for page in range(1, pages + 1):
        page_route = route + ("&" if "?" in route else "?") + f"per_page=100&page={page}"
        data = api.get(page_route)
        batch = data.get(key) if key and isinstance(data, dict) else data
        if not isinstance(batch, list):
            raise EvidenceError("invalid_paginated_response")
        if key:
            total = data.get("total_count")
            if not isinstance(total, int) or isinstance(total, bool) or total < 0:
                raise EvidenceError("missing_pagination_count")
            if advertised is not None and total != advertised:
                raise EvidenceError("pagination_count_drift")
            advertised = total
        request_records = getattr(api, "requests", [])
        response_hash = request_records[-1].get("bodyDigest") if request_records and request_records[-1].get("route") == page_route else None
        records.append({"route": page_route, "page": page, "count": len(batch), "bodyDigest": response_hash})
        values.extend(batch)
        if len(values) > limit or (advertised is not None and advertised > limit):
            raise EvidenceError("pagination_budget_exceeded")
        if len(batch) < 100:
            if advertised is not None and len(values) != advertised:
                raise EvidenceError("pagination_incomplete")
            return values, records
    raise EvidenceError("pagination_page_budget_exceeded")


def read_tree(api, prefix, commit_sha, limits):
    if not isinstance(commit_sha, str) or not SHA.fullmatch(commit_sha):
        raise EvidenceError("invalid_commit_sha")
    commit = api.get(prefix + "/git/commits/" + commit_sha)
    if commit.get("sha") != commit_sha:
        raise EvidenceError("commit_identity_mismatch")
    tree_sha = commit.get("tree", {}).get("sha", "")
    if not SHA.fullmatch(tree_sha):
        raise EvidenceError("invalid_tree_sha")
    tree = api.get(prefix + "/git/trees/" + tree_sha + "?recursive=1")
    if tree.get("sha") != tree_sha or tree.get("truncated") is not False:
        raise EvidenceError("tree_identity_or_completeness_unverified")
    entries = tree.get("tree")
    if not isinstance(entries, list) or len(entries) > limits["treeEntries"]:
        raise EvidenceError("tree_budget_exceeded")
    result = {}
    for entry in entries:
        path = entry.get("path")
        if not safe_path(path) or path in result or not SHA.fullmatch(entry.get("sha", "")):
            raise EvidenceError("invalid_or_duplicate_tree_entry")
        result[path] = {key: entry.get(key) for key in ("mode", "type", "sha")}
    return commit, result


def blob_sha256(api, prefix, blob_id, limits):
    blob = api.get(prefix + "/git/blobs/" + blob_id)
    if blob.get("sha") != blob_id or blob.get("encoding") != "base64":
        raise EvidenceError("workflow_blob_identity_unverified")
    try:
        content = base64.b64decode(blob["content"].replace("\n", ""), validate=True)
    except (KeyError, ValueError, TypeError) as error:
        raise EvidenceError("workflow_blob_encoding_invalid") from error
    if len(content) > limits["blobBytes"] or blob.get("size") != len(content):
        raise EvidenceError("workflow_blob_size_invalid")
    if hashlib.sha1(f"blob {len(content)}\0".encode() + content).hexdigest() != blob_id:
        raise EvidenceError("workflow_blob_hash_mismatch")
    return digest(content)


def language_files(tree, language):
    suffixes = {"javascript-typescript": {".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"},
                "python": {".py"}, "actions": {".yml", ".yaml"}}
    if language not in suffixes:
        raise EvidenceError("unsupported_sarif_language")
    return [{"path": p, "mode": e["mode"], "type": e["type"], "blob": e["sha"]}
            for p, e in sorted(tree.items()) if e["type"] != "tree" and Path(p).suffix.lower() in suffixes[language]
            and (language != "actions" or p.startswith(".github/workflows/"))]


def required_steps(policy, spec, job_name):
    if spec.get("role") == "platform-code-quality":
        native = policy.get("evaluation", {}).get("platformGate", {})
        return (["Initialize CodeQL", "Perform CodeQL Analysis"]
                if job_name in native.get("jobs", []) else [])
    expected = [r for r in policy.get("evaluation", {}).get("runs", [])
                if r.get("workflowId") == spec["id"]]
    jobs = [j for r in expected for j in r.get("jobs", []) if j.get("name") == job_name]
    return jobs[0].get("steps", []) if len(jobs) == 1 else []


def refresh_job_steps(api, prefix, job, run_id, attempt, head, required, cache):
    """Refresh one stale list observation once; never infer or combine step success."""
    def validate_steps(steps):
        if not isinstance(steps, list) or len(steps) > 200:
            raise EvidenceError("job_steps_unavailable")
        numbers = [s.get("number") for s in steps]
        if (any(not positive_int(n) for n in numbers) or len(set(numbers)) != len(numbers)
                or any(not isinstance(s.get("name"), str) or not s["name"] for s in steps)
                or any(sum(s["name"] == name for s in steps) > 1 for name in required)):
            raise EvidenceError("ambiguous_job_steps")

    validate_steps(job.get("steps"))
    if job.get("run_attempt", attempt) != attempt:
        raise EvidenceError("job_attempt_mismatch")
    if not required or attempt != 1 or job.get("status") != "completed" or job.get("conclusion") != "success":
        return job, None
    selected = [s for s in job["steps"] if s["name"] in required]
    # Explicit negative terminal evidence is never replaced by a successful reread.
    if any(s.get("conclusion") not in (None, "success") for s in selected):
        return job, None
    if len(selected) == len(required) and all(s.get("status") == "completed" and s.get("conclusion") == "success" for s in selected):
        return job, None
    route = prefix + f"/actions/jobs/{job['id']}"
    if job["id"] not in cache:
        try:
            direct = api.get(route)
            request = dict(api.requests[-1])
            cache[job["id"]] = (direct, request, None)
        except EvidenceError as error:
            if error.status not in (403, 404):
                raise
            cache[job["id"]] = (None, dict(api.requests[-1]), error.code)
    direct, request, unavailable = cache[job["id"]]
    proof = {"request": request, "listedSteps": job["steps"], "status": "unavailable"}
    if unavailable:
        proof["reason"] = unavailable
        return job, proof
    expected = {"id": job["id"], "run_id": run_id, "run_attempt": attempt,
                "head_sha": head, "name": job["name"], "status": "completed", "conclusion": "success",
                "started_at": job.get("started_at"), "completed_at": job.get("completed_at")}
    if any(direct.get(k) != v for k, v in expected.items()):
        raise EvidenceError("direct_job_identity_or_outcome_mismatch")
    try:
        start, end = (datetime.fromisoformat(expected[k].replace("Z", "+00:00"))
                      for k in ("started_at", "completed_at"))
        if start.tzinfo is None or end.tzinfo is None or start > end:
            raise ValueError("invalid time")
    except (AttributeError, TypeError, ValueError) as error:
        raise EvidenceError("direct_job_time_unavailable") from error
    validate_steps(direct.get("steps"))
    direct_by_number = {s["number"]: s for s in direct["steps"]}
    for old in job["steps"]:
        new = direct_by_number.get(old["number"])
        if new is None or new["name"] != old["name"]:
            raise EvidenceError("direct_job_step_identity_conflict")
        if old.get("status") == "completed" and old.get("conclusion") is not None:
            if new.get("status") != "completed" or new.get("conclusion") != old["conclusion"]:
                raise EvidenceError("direct_job_terminal_step_conflict")
    selected = [s for s in direct["steps"] if s["name"] in required]
    complete = len(selected) == len(required) and all(s.get("status") == "completed" and s.get("conclusion") == "success" for s in selected)
    proof.update({"status": "verified" if complete else "unavailable",
                  "reason": None if complete else "required_job_steps_incomplete"})
    return direct, proof


def validate_policy(policy):
    repository = policy.get("repository", {})
    if (policy.get("schemaVersion") != 1 or not positive_int(repository.get("id"))
            or not REPO.fullmatch(repository.get("fullName", ""))
            or repository.get("defaultBranch") != "main"):
        raise EvidenceError("invalid_policy_repository")
    workflows = policy.get("workflows")
    if not isinstance(workflows, list) or not workflows:
        raise EvidenceError("missing_policy_workflows")
    ids, paths = set(), set()
    for workflow in workflows:
        if (not positive_int(workflow.get("id")) or not safe_path(workflow.get("path"))
                or workflow["id"] in ids or workflow["path"] in paths
                or workflow.get("event") not in ("pull_request", "dynamic")):
            raise EvidenceError("invalid_policy_workflow")
        ids.add(workflow["id"])
        paths.add(workflow["path"])
    for field in ("allowedDocumentationPaths", "controlPaths"):
        entries = policy.get(field, [])
        if (not isinstance(entries, list) or any(not safe_path(p) for p in entries)
                or len(entries) != len(set(entries))):
            raise EvidenceError("invalid_policy_paths")
    for key, value in policy.get("limits", {}).items():
        if key not in DEFAULT_LIMITS or not positive_int(value) or value > DEFAULT_LIMITS[key]:
            raise EvidenceError("invalid_policy_budget")


def collect(policy, event, context, api):
    """Return observations even when incomplete; no eligibility is invented here."""
    result = {"schemaVersion": 1, "collector": {"mode": "report-only", "startedAt": timestamp(),
                                                "principal": dict(REPORT_PRINCIPAL)},
              "collection": {"status": "blocked", "blockers": [], "errors": []},
              "workflows": [], "rawSarif": [], "observations": {"requests": [], "drift": []}}
    blockers = result["collection"]["blockers"]
    credential = api.token
    direct_jobs = {}

    def block(reason):
        if reason not in blockers:
            blockers.append(reason)

    try:
        validate_policy(policy)
        limits = {**DEFAULT_LIMITS, **policy.get("limits", {})}
        repo = policy["repository"]
        prefix = "/repos/" + repo["fullName"]
        result["repository"] = dict(repo)
        if (context.get("GITHUB_EVENT_NAME") != "workflow_run"
                or context.get("GITHUB_REPOSITORY") != repo["fullName"]
                or event.get("action") != "completed"
                or event.get("repository", {}).get("id") != repo["id"]):
            raise EvidenceError("controller_event_identity_mismatch")
        # The repository root route is deliberately avoided: the ref/PR/run responses
        # independently bind repository IDs and the policy fixes the API namespace.
        main = api.get(prefix + "/git/ref/heads/main").get("object", {}).get("sha")
        if not isinstance(main, str) or not SHA.fullmatch(main):
            raise EvidenceError("invalid_main_sha")
        result["collector"]["revision"] = context.get("GITHUB_WORKFLOW_SHA")
        result["collector"]["policyDigest"] = digest(json.dumps(policy, sort_keys=True).encode())
        if context.get("GITHUB_SHA") != main or context.get("GITHUB_WORKFLOW_SHA") != main:
            block("controller_revision_is_not_current_main")
        trigger_id = event.get("workflow_run", {}).get("id")
        if not positive_int(trigger_id):
            raise EvidenceError("invalid_trigger_run_id")
        trigger = api.get(prefix + f"/actions/runs/{trigger_id}")
        specs = {entry["id"]: entry for entry in policy["workflows"]}
        trigger_spec = specs.get(trigger.get("workflow_id"))
        if (trigger.get("id") != trigger_id or trigger.get("repository", {}).get("id") != repo["id"]
                or trigger_spec is None or trigger.get("path") != trigger_spec["path"]
                or trigger.get("event") != trigger_spec["event"]):
            raise EvidenceError("trigger_run_identity_mismatch")
        observed_repository = trigger.get("repository", {})
        private = observed_repository.get("private")
        result["repository"]["visibility"] = ("private" if private else "public") if isinstance(private, bool) else None
        result["repository"]["private"] = private
        if not isinstance(private, bool):
            block("repository_visibility_unavailable")
        associations = trigger.get("pull_requests")
        if trigger_spec.get("role") == "platform-code-quality" and not associations:
            trigger_head = trigger.get("head_sha", "")
            if not SHA.fullmatch(trigger_head):
                raise EvidenceError("invalid_platform_trigger_head")
            associated, _ = paginated(api, prefix + f"/commits/{trigger_head}/pulls", limit=100, pages=limits["pages"])
            associations = [p for p in associated if p.get("state") == "open"
                            and p.get("head", {}).get("sha") == trigger_head
                            and p.get("head", {}).get("repo", {}).get("id") == repo["id"]
                            and p.get("base", {}).get("repo", {}).get("id") == repo["id"]
                            and p.get("base", {}).get("ref") == "main"]
        if not isinstance(associations, list) or len(associations) != 1:
            raise EvidenceError("unique_pr_association_unavailable")
        number = associations[0].get("number")
        if not positive_int(number):
            raise EvidenceError("invalid_pr_number")
        pull = api.get(prefix + f"/pulls/{number}")
        head = pull.get("head", {}).get("sha")
        base = pull.get("base", {})
        if (pull.get("number") != number or pull.get("id") != associations[0].get("id")
                or base.get("repo", {}).get("id") != repo["id"]
                or pull.get("head", {}).get("repo", {}).get("id") != repo["id"]
                or not isinstance(head, str) or not SHA.fullmatch(head)):
            raise EvidenceError("pr_identity_mismatch")
        result["pullRequest"] = {"id": pull["id"], "number": number, "headSha": head,
                                 "baseSha": base.get("sha"), "baseRef": base.get("ref"),
                                 "headRepoId": repo["id"], "baseRepoId": repo["id"],
                                 "state": pull.get("state"), "draft": pull.get("draft"),
                                 "authorId": pull.get("user", {}).get("id"),
                                 "mergeable": pull.get("mergeable"), "mergeableState": pull.get("mergeable_state")}
        if pull.get("state") != "open" or pull.get("draft") is not False or base.get("ref") != "main":
            block("pr_not_open_nondraft_main")
        if base.get("sha") != main or trigger.get("head_sha") != head:
            block("trigger_or_base_is_stale")
        count = pull.get("changed_files")
        if not isinstance(count, int) or isinstance(count, bool) or not 0 < count <= limits["changedFiles"]:
            raise EvidenceError("changed_file_count_unavailable_or_over_budget")
        files, file_pages = paginated(api, prefix + f"/pulls/{number}/files",
                                     limit=limits["changedFiles"], pages=limits["pages"])
        if len(files) != count:
            raise EvidenceError("changed_file_count_mismatch")
        base_commit, base_tree = read_tree(api, prefix, main, limits)
        head_commit, head_tree = read_tree(api, prefix, head, limits)
        comparison = api.get(prefix + f"/compare/{main}...{head}?per_page=1")
        ancestor = comparison.get("merge_base_commit", {}).get("sha") == main
        if not ancestor:
            block("head_does_not_contain_current_main")
        tree_changes = {p for p in base_tree.keys() | head_tree.keys()
                        if base_tree.get(p) != head_tree.get(p)
                        and any(e and e.get("type") != "tree"
                                for e in (base_tree.get(p), head_tree.get(p)))}
        observed_paths, normalized = set(), []
        for entry in files:
            path, previous = entry.get("filename"), entry.get("previous_filename")
            if not safe_path(path) or (previous is not None and not safe_path(previous)) or path in observed_paths:
                raise EvidenceError("invalid_changed_path")
            observed_paths.add(path)
            if previous:
                observed_paths.add(previous)
            old = base_tree.get(previous or path, {})
            new = head_tree.get(path, {})
            normalized.append({"path": path, "previousPath": previous, "status": entry.get("status"),
                               "oldMode": old.get("mode"), "newMode": new.get("mode"),
                               "oldBlob": old.get("sha"), "newBlob": new.get("sha")})
            if any(e and (e.get("mode") != "100644" or e.get("type") != "blob") for e in (old, new)):
                block("changed_file_is_not_regular_nonexecutable")
        if tree_changes != observed_paths:
            block("pr_files_and_complete_tree_diff_disagree")
        allowed = set(policy.get("allowedDocumentationPaths", []))
        if not tree_changes or not tree_changes <= allowed:
            block("change_is_not_in_positive_document_allowlist")
        result["files"] = {"expectedCount": count, "fetchedCount": len(files), "pages": file_pages,
                           "treeComplete": True, "entries": normalized,
                           "treeChangedPaths": sorted(tree_changes), "matchesTreeDiff": tree_changes == observed_paths}
        closure, controls_intact = [], True
        required_controls = set(policy.get("controlPaths", [])) | {
            w["path"] for w in policy["workflows"] if w["path"].startswith(".github/")}
        for path in sorted(required_controls):
            before, after = base_tree.get(path), head_tree.get(path)
            closure.append({"path": path, "baseBlob": before.get("sha") if before else None,
                            "testedBlob": after.get("sha") if after else None,
                            "mode": after.get("mode") if after else None})
            if not before or before != after or before.get("mode") != "100644":
                controls_intact = False
                block("control_closure_changed_or_nonregular")
        unchanged = all(base_tree.get(p) == head_tree.get(p)
                        for p in base_tree.keys() | head_tree.keys()
                        if p not in allowed and any(e and e.get("type") != "tree"
                                                   for e in (base_tree.get(p), head_tree.get(p))))
        result["controlClosure"] = {"manifestRevision": main, "entries": closure,
                                    "allNonAllowlistedEntriesEqual": unchanged,
                                    "complete": unchanged and controls_intact and bool(required_controls),
                                    "authority": "trusted-policy-and-complete-git-trees"}
        if not unchanged or not required_controls:
            block("complete_control_closure_unverified")
        source = {"controllerSha": main, "headSha": head, "mergeBaseSha": comparison.get("merge_base_commit", {}).get("sha"),
                  "testedRevision": None, "parents": [], "proofStatus": "unavailable", "proofKind": None}
        result["source"] = source
        for spec in policy["workflows"]:
            route = prefix + f"/actions/workflows/{spec['id']}/runs?head_sha={head}"
            runs, run_pages = paginated(api, route, "workflow_runs", limit=100, pages=limits["pages"])
            candidates = [r for r in runs if r.get("event") == spec["event"] and r.get("head_sha") == head]
            if not candidates:
                block(f"workflow_missing:{spec['id']}")
                continue
            # Numeric run IDs increase; no successful-old-run fallback is permitted.
            selected = max(candidates, key=lambda r: r.get("id", 0))
            run_id, attempt = selected.get("id"), selected.get("run_attempt")
            if not positive_int(run_id) or not positive_int(attempt):
                raise EvidenceError("invalid_selected_run_identity")
            run = api.get(prefix + f"/actions/runs/{run_id}/attempts/{attempt}")
            if (run.get("id") != run_id or run.get("run_attempt") != attempt
                    or run.get("workflow_id") != spec["id"] or run.get("path") != spec["path"]
                    or run.get("head_sha") != head or run.get("event") != spec["event"]
                    or run.get("repository", {}).get("id") != repo["id"]):
                raise EvidenceError("selected_run_identity_mismatch")
            if attempt != 1:
                block(f"rerun_attempt_requires_manual_review:{run_id}")
            matching_prs = [p for p in run.get("pull_requests", [])
                            if p.get("id") == pull["id"] and p.get("number") == number
                            and p.get("head", {}).get("sha") == head
                            and p.get("base", {}).get("sha") == main
                            and p.get("base", {}).get("repo", {}).get("id") == repo["id"]
                            and p.get("head", {}).get("repo", {}).get("id") == repo["id"]]
            if spec.get("role") != "platform-code-quality" and len(matching_prs) != 1:
                block(f"workflow_pr_source_association_unverified:{spec['id']}")
            if run.get("status") != "completed" or run.get("conclusion") != "success":
                block(f"workflow_not_successful:{spec['id']}")
            jobs, job_pages = paginated(api, prefix + f"/actions/runs/{run_id}/attempts/{attempt}/jobs",
                                       "jobs", limit=200, pages=limits["pages"])
            jobs_out, job_ids = [], set()
            for job in jobs:
                if (not positive_int(job.get("id")) or job["id"] in job_ids
                        or job.get("run_id") != run_id or job.get("head_sha") != head):
                    raise EvidenceError("job_identity_mismatch")
                job_ids.add(job["id"])
                job, refresh = refresh_job_steps(api, prefix, job, run_id, attempt, head,
                                                required_steps(policy, spec, job.get("name")), direct_jobs)
                if refresh and refresh["status"] != "verified":
                    block("required_job_steps_unavailable:" + str(job["id"]))
                steps = job.get("steps")
                if not isinstance(steps, list) or len(steps) > 200:
                    raise EvidenceError("job_steps_unavailable")
                jobs_out.append({**{k: job.get(k) for k in ("id", "name", "status", "conclusion", "started_at", "completed_at")},
                                 "steps": [{k: step.get(k) for k in ("number", "name", "status", "conclusion")} for step in steps],
                                 **({"stepRefresh": refresh} if refresh else {})})
            references = run.get("referenced_workflows", [])
            source_proof = {"status": "unavailable", "revision": None, "kind": None}
            for ref in references:
                expected_prefix = repo["fullName"] + "/.github/workflows/"
                if (isinstance(ref.get("path"), str) and ref["path"].startswith(expected_prefix)
                        and ref.get("ref") == f"refs/pull/{number}/merge"
                        and SHA.fullmatch(ref.get("sha", ""))):
                    revision = ref["sha"]
                    commit = api.get(prefix + "/git/commits/" + revision)
                    parents = [p.get("sha") for p in commit.get("parents", [])]
                    if commit.get("sha") == revision and parents == [main, head]:
                        source_proof = {"status": "verified", "revision": revision, "kind": "platform-local-reusable-reference"}
                        source.update({"testedRevision": revision, "parents": parents,
                                       "proofStatus": "verified", "proofKind": source_proof["kind"]})
            if spec.get("role") == "platform-code-quality":
                source_proof = {"status": "platform-managed", "revision": head, "kind": "github-generated-workflow"}
            elif source_proof["status"] != "verified":
                block(f"workflow_execution_source_unavailable:{spec['id']}")
            result["workflows"].append({"workflowId": spec["id"], "path": spec["path"], "event": spec["event"],
                                        "runId": run_id, "attempt": attempt, "headSha": head,
                                        "status": run.get("status"), "conclusion": run.get("conclusion"),
                                        "sourceProof": source_proof, "referencedWorkflows": references,
                                        "jobs": jobs_out, "pages": run_pages + job_pages})
        rules = api.get(prefix + "/rules/branches/main")
        if not isinstance(rules, list):
            raise EvidenceError("invalid_rules_response")
        details, detail_requests, detail_status = [], [], "verified"
        if not rules or any(not positive_int(r.get("ruleset_id")) for r in rules):
            raise EvidenceError("invalid_applicable_ruleset_identity")
        for rule_id in sorted({r.get("ruleset_id") for r in rules if positive_int(r.get("ruleset_id"))}):
            try:
                detail = api.get(prefix + f"/rulesets/{rule_id}")
                if detail.get("id") != rule_id:
                    raise EvidenceError("rule_detail_identity_mismatch")
                if api.token != credential:
                    raise EvidenceError("collector_credential_changed")
                details.append(detail)
                detail_requests.append({"rulesetId": rule_id, "request": dict(api.requests[-1])})
                applicable = [r for r in rules if r["ruleset_id"] == rule_id]
                if (detail.get("enforcement") != "active" or detail.get("current_user_can_bypass") != "never"
                        or any(detail.get("source_type") != r.get("ruleset_source_type")
                               or detail.get("source") != r.get("ruleset_source") for r in applicable)
                        or detail.get("source_type") not in ("Repository", "Organization")
                        or not isinstance(detail.get("source"), str) or not detail["source"]):
                    detail_status = "unavailable"
                    block("current_principal_bypass_unverified")
            except EvidenceError as error:
                if error.status in (403, 404):
                    detail_status = "unavailable"
                    block("current_principal_bypass_unverified")
                else:
                    raise
        result["protection"] = {"rules": rules, "ruleDetails": details, "ruleDetailStatus": detail_status,
                                 "ruleDetailRequests": detail_requests}
        if not details:
            block("current_principal_bypass_unverified")
            result["protection"]["ruleDetailStatus"] = "unavailable"
        checks, check_pages = paginated(api, prefix + f"/commits/{head}/check-runs?filter=all",
                                        "check_runs", limit=500, pages=limits["pages"])
        statuses, status_pages = paginated(api, prefix + f"/commits/{head}/statuses",
                                           limit=500, pages=limits["pages"])
        result["protection"].update({
            "checkRuns": [{**{k: c.get(k) for k in ("id", "name", "head_sha", "status", "conclusion", "started_at", "completed_at")},
                           "check_suite": {"id": c.get("check_suite", {}).get("id")},
                           "app": {k: c.get("app", {}).get(k) for k in ("id", "slug")}} for c in checks],
            "statuses": [{**{k: s.get(k) for k in ("id", "context", "state", "created_at", "updated_at")},
                          "creator": {"id": s.get("creator", {}).get("id")}} for s in statuses],
            "pages": check_pages + status_pages})
        result["artifactInventories"] = []
        for workflow in result["workflows"]:
            spec = specs[workflow["workflowId"]]
            if not workflow["path"].startswith(".github/"):
                continue
            artifacts, pages = paginated(api, prefix + f"/actions/runs/{workflow['runId']}/artifacts",
                                         "artifacts", limit=100, pages=limits["pages"])
            result["artifactInventories"].append({"runId": workflow["runId"], "attempt": workflow["attempt"],
                                                 "artifacts": [{k: a.get(k) for k in ("id", "name", "digest", "size_in_bytes", "expired", "created_at", "workflow_run")}
                                                               for a in artifacts], "pages": pages})
            languages = policy.get("requiredLanguages", []) if spec.get("role") == "codeql" else [None]
            proofs = []
            for language in languages:
                name = (f"merge-evidence-{workflow['runId']}-{workflow['attempt']}-{language['language']}" if language
                        else f"merge-source-{workflow['runId']}-{workflow['attempt']}")
                names = [a for a in artifacts if a.get("name") ==
                         name]
                envelope = {"status": "unavailable", "runId": workflow["runId"], "attempt": workflow["attempt"],
                            "artifactIds": [a.get("id") for a in names]}
                if language:
                    envelope.update({"language": language["language"], "category": language["category"]})
                    result["rawSarif"].append(envelope)
                else:
                    workflow["sourceReceipt"] = envelope
                try:
                    if len(names) != 1:
                        raise EvidenceError("artifact_missing_or_ambiguous")
                    if not result["controlClosure"]["complete"]:
                        raise EvidenceError("artifact_control_closure_unverified")
                    members = artifact_members(api, names[0],
                        ["receipt.json", language["language"] + ".sarif"] if language else ["receipt.json"], limits)
                    workflow_hash = blob_sha256(api, prefix, base_tree[workflow["path"]]["sha"], limits)
                    workflow["workflowSourceSha256"] = workflow_hash
                    expected_producer = {"jobName": f"analyze ({language['language']})" if language else
                                         "scope" if spec.get("role") == "ci" else "convention",
                                         "stepName": "Upload merge evidence" if language else "Upload source receipt"}
                    proof = receipt_proof(api, prefix, names[0], members["receipt.json"]["data"], workflow,
                                          expected_producer, workflow["jobs"], main, head, number, repo["id"], workflow_hash)
                    receipt = proof["receipt"]
                    if receipt.get("sourceTree") != head_commit.get("tree", {}).get("sha"):
                        raise EvidenceError("receipt_source_tree_mismatch")
                    if language and (receipt.get("language") != language["language"] or receipt.get("category") != language["category"]):
                        raise EvidenceError("receipt_language_category_mismatch")
                    if language and receipt.get("sourceFiles") != language_files(head_tree, language["language"]):
                        raise EvidenceError("receipt_source_inventory_mismatch")
                    envelope.update({"status": "verified", "artifactId": names[0]["id"], "archiveDigest": names[0]["digest"],
                                     "receiptDigest": members["receipt.json"]["digest"], "sourceSha": proof["revision"],
                                     "jobId": proof["jobId"], "producerProof": proof})
                    if language:
                        sarif_member = members[language["language"] + ".sarif"]
                        envelope.update({"sarifDigest": sarif_member["digest"], "sarif": sarif_member["data"],
                                         "rawSarif": sarif_member["text"]})
                    proofs.append(proof)
                except EvidenceError as error:
                    envelope.update({"status": "unavailable" if not names else "unverified", "reason": error.code})
                    if error.code in ("artifact_transport_error", "artifact_download_error") or (
                            error.code == "artifact_http_error" and error.status not in (404, 410)):
                        result["collection"]["errors"].append({"code": error.code, "httpStatus": error.status})
                    block(("raw_sarif_unavailable_or_unverified:" + language["language"]) if language
                          else "source_receipt_unavailable_or_unverified:" + str(workflow["workflowId"]))
            if proofs and len(proofs) == len(languages) and len({p["revision"] for p in proofs}) == 1:
                workflow["sourceProof"] = proofs[0]
                reason = f"workflow_execution_source_unavailable:{workflow['workflowId']}"
                if reason in blockers:
                    blockers.remove(reason)
                source.update({"testedRevision": proofs[0]["revision"], "parents": [main, head],
                               "proofStatus": "verified", "proofKind": proofs[0]["kind"]})
        if not result["rawSarif"]:
            block("raw_sarif_inventory_unavailable")
        after = api.get(prefix + f"/pulls/{number}")
        result["pullRequest"]["observedBefore"] = {"mergeable": pull.get("mergeable"), "mergeableState": pull.get("mergeable_state")}
        result["pullRequest"]["mergeable"] = after.get("mergeable")
        result["pullRequest"]["mergeableState"] = after.get("mergeable_state")
        result["pullRequest"]["observedAfter"] = {"headSha": after.get("head", {}).get("sha"),
                                                  "baseSha": after.get("base", {}).get("sha"),
                                                  "state": after.get("state"), "draft": after.get("draft"),
                                                  "mergeable": after.get("mergeable"), "mergeableState": after.get("mergeable_state")}
        after_main = api.get(prefix + "/git/ref/heads/main").get("object", {}).get("sha")
        if (after.get("id") != pull.get("id") or after.get("head", {}).get("sha") != head
                or after.get("base", {}).get("sha") != main or after_main != main
                or after.get("state") != pull.get("state") or after.get("draft") != pull.get("draft")):
            result["observations"]["drift"].append("pr_or_main_changed")
            block("pr_or_main_changed_during_collection")
        for workflow in result["workflows"]:
            latest = api.get(prefix + f"/actions/runs/{workflow['runId']}")
            workflow["latestAttempt"] = latest.get("run_attempt")
            if (latest.get("run_attempt") != workflow["attempt"] or latest.get("status") != workflow["status"]
                    or latest.get("conclusion") != workflow["conclusion"]):
                result["observations"]["drift"].append("run_changed:" + str(workflow["runId"]))
                block("run_changed_during_collection")
            latest_runs, _ = paginated(api, prefix + f"/actions/workflows/{workflow['workflowId']}/runs?head_sha={head}",
                                       "workflow_runs", limit=100, pages=limits["pages"])
            matching = [r for r in latest_runs if r.get("event") == workflow["event"] and r.get("head_sha") == head]
            if not matching or max(r.get("id", 0) for r in matching) != workflow["runId"]:
                block("newer_run_during_collection")
        if api.get(prefix + "/rules/branches/main") != rules:
            block("effective_rules_changed_during_collection")
        result["protection"]["ruleDetailsAfter"] = []
        result["protection"]["ruleDetailRequestsAfter"] = []
        result["protection"]["ruleDetailRereadStatus"] = "unchanged" if details else "unavailable"
        for detail in details:
            try:
                after_detail = api.get(prefix + f"/rulesets/{detail['id']}")
                if api.token != credential:
                    raise EvidenceError("collector_credential_changed")
                result["protection"]["ruleDetailsAfter"].append(after_detail)
                result["protection"]["ruleDetailRequestsAfter"].append({"rulesetId": detail["id"], "request": dict(api.requests[-1])})
                if after_detail != detail:
                    result["protection"]["ruleDetailRereadStatus"] = "changed"
                    result["protection"]["ruleDetailStatus"] = "changed"
                    result["observations"]["drift"].append("ruleset_changed:" + str(detail["id"]))
                    block("ruleset_details_changed_during_collection")
            except EvidenceError as error:
                if error.status in (403, 404):
                    result["protection"]["ruleDetailRereadStatus"] = "unavailable"
                    result["protection"]["ruleDetailStatus"] = "unavailable"
                    block("ruleset_details_reread_unavailable")
                else:
                    raise
        if api.token != credential:
            raise EvidenceError("collector_credential_changed")
        platform = [w for w in result["workflows"] if specs[w["workflowId"]].get("role") == "platform-code-quality"]
        if platform:
            result["platformGate"] = platform[0]
            result["workflows"] = [w for w in result["workflows"] if w not in platform]
    except EvidenceError as error:
        if error.code.startswith(("github_", "invalid_json", "duplicate_json", "nonfinite_json")):
            result["collection"]["errors"].append({"code": error.code, "httpStatus": error.status})
        else:
            block(error.code)
    except (KeyError, TypeError, ValueError, AttributeError) as error:
        result["collection"]["errors"].append({"code": "invalid_response_schema", "type": type(error).__name__})
    result["observations"]["requests"] = list(getattr(api, "requests", []))
    result["collector"]["finishedAt"] = timestamp()
    result["collection"]["status"] = ("failure" if result["collection"]["errors"]
                                        else "blocked" if blockers else "completed")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", required=True)
    parser.add_argument("--event", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        policy_bytes = Path(args.policy).read_bytes()
        event_bytes = Path(args.event).read_bytes()
        if len(policy_bytes) > 1024 * 1024 or len(event_bytes) > 5 * 1024 * 1024:
            raise EvidenceError("input_budget_exceeded")
        policy, event = decode_json(policy_bytes), decode_json(event_bytes)
        validate_policy(policy)
        api = GitHubGet(policy["repository"]["fullName"], os.environ.get("GITHUB_TOKEN", ""), policy.get("limits"))
        observation = collect(policy, event, os.environ, api)
        observation["collector"]["policyFileDigest"] = digest(policy_bytes)
    except (EvidenceError, OSError, KeyError, TypeError) as error:
        observation = {"schemaVersion": 1, "collection": {"status": "failure", "blockers": [],
                       "errors": [{"code": error.code if isinstance(error, EvidenceError) else "collector_input_error"}]}}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(observation, indent=2) + "\n", encoding="utf-8")
    # Blocked is a valid report-only observation, never a successful eligibility claim.
    print(json.dumps({"collectionStatus": observation["collection"]["status"], "mode": "report-only"}))
    return 1 if observation["collection"]["status"] == "failure" else 0


if __name__ == "__main__":
    raise SystemExit(main())
