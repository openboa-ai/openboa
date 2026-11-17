#!/usr/bin/env python3
"""One bounded trusted-main, read-only reporting round. Never authorizes a merge."""

import argparse
import hashlib
import importlib.util
import io
import json
import math
import os
import re
import shutil
import signal
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("canary_collector", ROOT / "scripts/collect-merge-evidence.py")
C = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(C)
REPOSITORY = {"id": 1214829403, "fullName": "openboa-ai/openboa", "defaultBranch": "main"}
EVALUATOR = {"repository": "openboa-ai/.github", "revision": "e1ec2781ec180c96bcd520a497780bf6b8dc29ca",
             "path": "lib/evaluate-merge-evidence.mjs",
             "sha256": "482ea35629a9250bc591bd3ab169ddc163ee14e74b9c630f6e7e09c06ccfba22"}
POLICY_PATH = ".github/merge-canary-policy.json"
STAGING = ".round-staging"


def remaining(deadline):
    value = deadline - time.monotonic()
    if value <= 0:
        raise C.EvidenceError("round_deadline_exceeded")
    return value


def regular_bytes(path, limit):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise C.EvidenceError("nonregular_input_or_output")
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            value = stream.read(limit + 1)
        if len(value) > limit:
            raise C.EvidenceError("file_budget_exceeded")
        return value
    finally:
        os.close(descriptor)


def no_symlink_parents(path):
    for item in (path, *path.parents):
        if item.is_symlink():
            raise C.EvidenceError("symlink_path_rejected")


def git(root, arguments, deadline):
    result = subprocess.run(["git", "--no-optional-locks", "-C", str(root), *arguments],
                            check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            timeout=min(5, remaining(deadline)))
    return result.stdout


def context_identity(context):
    numbers = {}
    for key in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_RUN_NUMBER"):
        value = context.get(key, "")
        if not isinstance(value, str) or not re.fullmatch(r"[1-9][0-9]{0,19}", value):
            raise C.EvidenceError("invalid_round_identity")
        numbers[key] = int(value)
    revision = context.get("GITHUB_WORKFLOW_SHA", "")
    if not isinstance(revision, str) or not C.SHA.fullmatch(revision):
        raise C.EvidenceError("invalid_controller_revision")
    return {"repository": REPOSITORY["fullName"], "runId": numbers["GITHUB_RUN_ID"],
            "attempt": numbers["GITHUB_RUN_ATTEMPT"], "runNumber": numbers["GITHUB_RUN_NUMBER"],
            "controllerRevision": revision}


def validate_controller(policy, policy_bytes, event, context, root, deadline):
    """No network operation is allowed before this trusted-source verification."""
    C.validate_policy(policy)
    identity = context_identity(context)
    if (policy.get("mode") != "report-only" or policy.get("repository") != REPOSITORY
            or policy.get("evaluator") != EVALUATOR
            or context.get("GITHUB_REPOSITORY") != REPOSITORY["fullName"]
            or context.get("GITHUB_REPOSITORY_ID") != str(REPOSITORY["id"])
            or context.get("GITHUB_EVENT_NAME") not in ("schedule", "workflow_dispatch")
            or context.get("GITHUB_REF") != "refs/heads/main"
            or context.get("GITHUB_SHA") != identity["controllerRevision"]
            or not isinstance(event, dict) or event.get("inputs") not in (None, {})
            or event.get("repository", {}).get("id") != REPOSITORY["id"]
            or event.get("repository", {}).get("full_name") != REPOSITORY["fullName"]
            or event.get("repository", {}).get("default_branch") != "main"):
        raise C.EvidenceError("reporter_context_rejected")
    no_symlink_parents(root)
    if git(root, ["rev-parse", "--show-toplevel"], deadline).strip().decode() != str(root):
        raise C.EvidenceError("controller_git_root_mismatch")
    if git(root, ["rev-parse", "HEAD"], deadline).strip().decode() != identity["controllerRevision"]:
        raise C.EvidenceError("controller_checkout_mismatch")
    blob = hashlib.sha1(f"blob {len(policy_bytes)}\0".encode() + policy_bytes).hexdigest()
    if git(root, ["rev-parse", "HEAD:" + POLICY_PATH], deadline).strip().decode() != blob:
        raise C.EvidenceError("controller_policy_modified")
    evaluator = root / ".merge-evaluator"
    no_symlink_parents(evaluator)
    if not evaluator.is_dir():
        raise C.EvidenceError("evaluator_checkout_missing")
    if git(evaluator, ["rev-parse", "--show-toplevel"], deadline).strip().decode() != str(evaluator):
        raise C.EvidenceError("evaluator_git_root_mismatch")
    if git(evaluator, ["rev-parse", "HEAD"], deadline).strip().decode() != EVALUATOR["revision"]:
        raise C.EvidenceError("evaluator_revision_mismatch")
    if git(evaluator, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching"], deadline):
        raise C.EvidenceError("evaluator_checkout_dirty")
    module = evaluator / EVALUATOR["path"]
    no_symlink_parents(module)
    if C.digest(regular_bytes(module, 1024 * 1024)) != EVALUATOR["sha256"]:
        raise C.EvidenceError("evaluator_digest_mismatch")
    status = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching",
                        "--ignore-submodules=none"], deadline)
    if any(entry != b"?? .merge-evaluator/" for entry in status.split(b"\0") if entry):
        raise C.EvidenceError("controller_checkout_dirty")
    remaining(deadline)
    return identity


class RoundBudget:
    """Shared only by the reporter; writer/default collector counters stay unchanged."""

    def __init__(self, limits, deadline, clock=time.monotonic):
        self.limits = {**C.DEFAULT_LIMITS, **limits}
        self.deadline, self.clock = min(deadline, clock() + self.limits["seconds"]), clock
        self.requests = self.bytes = self.expanded = 0
        self.failed_read_allowance = 0
        self.poisoned = False

    def check(self):
        if self.poisoned:
            raise C.EvidenceError("round_response_accounting_unknown")
        value = self.deadline - self.clock()
        if value <= 0:
            raise C.EvidenceError("round_deadline_exceeded")
        return value

    def request(self):
        self.check()
        if self.requests >= self.limits["requests"]:
            raise C.EvidenceError("round_request_budget_exceeded")
        self.requests += 1

    def read_size(self, requested):
        self.check()
        available = self.limits["jsonBytes"] - self.bytes
        if available < 0:
            raise C.EvidenceError("round_response_budget_exceeded")
        # One charged sentinel detects overflow; it never permits eligibility.
        return min(requested if requested >= 0 else available + 1, available + 1)

    def charge(self, raw):
        self.bytes += len(raw)
        if self.bytes > self.limits["jsonBytes"]:
            raise C.EvidenceError("round_response_budget_exceeded")
        self.check()

    def reserve_zip(self, raw):
        self.check()
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                declared = sum(item.file_size for item in archive.infolist())
        except (zipfile.BadZipFile, ValueError, OSError) as error:
            raise C.EvidenceError("artifact_invalid_zip") from error
        if declared < 0 or self.expanded + declared > self.limits["expandedBytes"]:
            raise C.EvidenceError("round_expanded_budget_exceeded")
        self.expanded += declared
        self.check()

    def observation(self):
        return {"requests": self.requests, "responseBytes": self.bytes,
                "responseBytesComplete": not self.poisoned,
                "failedReadAllowance": self.failed_read_allowance,
                "expandedBytesReserved": self.expanded,
                "responseAcceptanceLimit": self.limits["jsonBytes"]}


class BudgetResponse:
    def __init__(self, response, budget):
        self.response, self.budget = response, budget

    def __getattr__(self, name):
        return getattr(self.response, name)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.response.close()

    def read(self, size=-1):
        allowance = self.budget.read_size(size)
        try:
            raw = self.response.read(allowance)
        except Exception:
            # A failed read can have consumed partial bytes without returning them.
            # Preserve the known counter, mark the allowance unknown, and prevent
            # every subsequent request/read rather than pretending it consumed zero.
            self.budget.failed_read_allowance += allowance
            self.budget.poisoned = True
            raise
        self.budget.charge(raw)
        return raw


class BudgetOpener:
    def __init__(self, opener, budget):
        self.opener, self.budget = opener, budget

    def open(self, request, timeout=20):
        self.budget.request()
        try:
            response = self.opener.open(request, timeout=min(timeout, self.budget.check()))
        except urllib.error.HTTPError as error:
            error.close()
            self.budget.check()
            raise
        self.budget.check()
        return BudgetResponse(response, self.budget)


class ReporterAPI(C.GitHubGet):
    def __init__(self, repository, token, limits, deadline, opener=None, clock=time.monotonic):
        self.budget = RoundBudget(limits, deadline, clock)
        wrapped = BudgetOpener(opener or urllib.request.build_opener(C.NoRedirect()), self.budget)
        super().__init__(repository, token, limits, wrapped)

    def get(self, route):
        result = super().get(route)
        self.budget.check()
        return result

    def download_artifact(self, artifact_id):
        raw = super().download_artifact(artifact_id)
        # Reserve aggregate expanded bytes before collector member decompression.
        self.budget.reserve_zip(raw)
        return raw


def discover(policy, context, api):
    prefix = "/repos/" + REPOSITORY["fullName"]
    if api.get(prefix + "/git/ref/heads/main").get("object", {}).get("sha") != context["GITHUB_WORKFLOW_SHA"]:
        raise C.EvidenceError("controller_revision_is_not_current_main")
    limits = {**C.DEFAULT_LIMITS, **policy.get("limits", {})}
    pulls, pages = C.paginated(api, prefix + "/pulls?state=open&base=main&sort=created&direction=asc",
                                limit=1000, pages=limits["pages"])
    eligible, excluded, numbers, ids = [], [], set(), set()
    for pull in pulls:
        number = pull.get("number") if isinstance(pull, dict) else None
        identifier = pull.get("id") if isinstance(pull, dict) else None
        if (C.positive_int(number) and number in numbers) or (C.positive_int(identifier) and identifier in ids):
            raise C.EvidenceError("duplicate_discovery_identity")
        if C.positive_int(number):
            numbers.add(number)
        if C.positive_int(identifier):
            ids.add(identifier)
        reason = None
        if not C.positive_int(number) or not C.positive_int(identifier):
            reason = "invalid_identity"
        elif pull.get("state") != "open" or pull.get("base", {}).get("ref") != "main":
            reason = "not_open_against_main"
        elif any(pull.get(side, {}).get("repo", {}).get("id") != REPOSITORY["id"]
                 or pull.get(side, {}).get("repo", {}).get("full_name") != REPOSITORY["fullName"]
                 for side in ("head", "base")):
            reason = "foreign_repository"
        if reason:
            excluded.append({"number": number if C.positive_int(number) else None, "reason": reason})
        else:
            eligible.append(number)
    eligible.sort()
    selected = [] if not eligible else [eligible[(int(context["GITHUB_RUN_NUMBER"]) - 1) % len(eligible)]]
    return {"discoveryComplete": True, "discovered": len(pulls), "eligible": eligible,
            "selected": selected, "deferred": [n for n in eligible if n not in selected],
            "excluded": excluded, "pages": pages,
            "coverage": "partial" if len(pulls) > len(selected) else "selected-only" if selected else "empty"}


def atomic_json(path, value):
    no_symlink_parents(path.parent)
    temporary = path.with_name("." + path.name + "." + uuid.uuid4().hex)
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(value, output, indent=2, allow_nan=False)
            output.write("\n")
        if path.exists() or path.is_symlink():
            raise C.EvidenceError("output_already_exists")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def failed_summary(identity, code, discovery=None, budget=None):
    return {"schemaVersion": 1, "round": identity, "mode": "report-only", "mergeAuthorized": False,
            "status": "failure", "reason": code, "coverage": "partial", "processed": [],
            "selectedEvaluation": None, "discovery": discovery or {"discoveryComplete": False,
                "discovered": None, "selected": [], "deferred": [], "excluded": []},
            "budget": budget}


def evaluate(policy, root, observation, directory, identity, deadline, context):
    observation["round"] = identity
    atomic_json(directory / "observations.json", observation)
    temporary_report = directory / ".evaluation.json"
    env = dict(context)
    env.pop("GITHUB_TOKEN", None)
    # Only the parent may publish a completed round to the Actions summary.
    env.pop("GITHUB_STEP_SUMMARY", None)
    env.pop("GITHUB_OUTPUT", None)
    arguments = ["node", str(root / "scripts/evaluate-merge-canary.mjs"),
                 "--policy", str(root / POLICY_PATH), "--observations", str(directory / "observations.json"),
                 "--evaluator", str(root / ".merge-evaluator" / EVALUATOR["path"]),
                 "--output", str(temporary_report)]
    subprocess.run(arguments, cwd=root, env=env, check=True, timeout=remaining(deadline),
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    remaining(deadline)
    report = C.decode_json(regular_bytes(temporary_report, 5 * 1024 * 1024))
    if (report.get("mode") != "report-only" or report.get("mergeAuthorized") is not False
            or type(report.get("result", {}).get("eligible")) is not bool
            or report["result"]["eligible"] and observation.get("collection", {}).get("status") != "completed"):
        raise C.EvidenceError("invalid_evaluator_report")
    report["round"] = identity
    atomic_json(directory / "report.json", report)
    temporary_report.unlink()
    return report


def worker(args, context):
    deadline = min(args.deadline, time.monotonic() + C.DEFAULT_LIMITS["seconds"])
    output = Path(args.output).absolute()
    no_symlink_parents(output)
    identity = C.decode_json(regular_bytes(output / "round.json", 8192))
    expected = {**context_identity(context), "identity": args.round_id}
    if identity != expected or not re.fullmatch(r"[a-f0-9]{32}", args.round_id):
        raise C.EvidenceError("round_handoff_mismatch")
    discovery = api = None
    files = []
    staging = output / STAGING
    try:
        policy_bytes = regular_bytes(ROOT / POLICY_PATH, 1024 * 1024)
        event_bytes = regular_bytes(Path(args.event), 5 * 1024 * 1024)
        policy, event = C.decode_json(policy_bytes), C.decode_json(event_bytes)
        validate_controller(policy, policy_bytes, event, context, ROOT, deadline)
        staging.mkdir(mode=0o700)
        api = ReporterAPI(REPOSITORY["fullName"], context.get("GITHUB_TOKEN", ""), policy.get("limits", {}), deadline)
        discovery = discover(policy, context, api)
        summary = {"schemaVersion": 1, "round": identity, "mode": "report-only", "mergeAuthorized": False,
                   "status": "completed", "coverage": discovery["coverage"], "discovery": discovery,
                   "processed": [], "selectedEvaluation": None}
        for number in discovery["selected"]:
            remaining(deadline)
            directory = staging / str(number)
            directory.mkdir(mode=0o700)
            observation = C.collect(policy, event, context, api, report_number=number)
            observation["collector"]["policyFileDigest"] = C.digest(policy_bytes)
            api.budget.check()
            report = evaluate(policy, ROOT, observation, directory, identity, deadline, context)
            summary["processed"].append(number)
            summary["selectedEvaluation"] = {"number": number, "eligible": report["result"]["eligible"],
                                               "collectionStatus": report["collectionStatus"]}
            if report["collectionStatus"] == "failure":
                raise C.EvidenceError("collection_failed")
            for name in ("observations.json", "report.json"):
                files.append({"path": f"{number}/{name}", "sha256": C.digest(regular_bytes(directory / name, 30 * 1024 * 1024))})
        api.budget.check()
        summary["budget"] = api.budget.observation()
    except (C.EvidenceError, OSError, ValueError, TypeError, KeyError, AttributeError,
            subprocess.SubprocessError) as error:
        code = error.code if isinstance(error, C.EvidenceError) else "round_worker_failed"
        summary = failed_summary(identity, code, discovery, api.budget.observation() if api else None)
        files = []
        if staging.exists():
            shutil.rmtree(staging)
    atomic_json(output / "worker-result.json", {"round": identity, "summary": summary, "files": files})


def supervise(arguments, context, deadline):
    process = subprocess.Popen(arguments, env=context, start_new_session=True,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        code = process.wait(timeout=remaining(deadline))
    except (subprocess.TimeoutExpired, C.EvidenceError):
        # This live process group was created exclusively for this round.
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)
        raise C.EvidenceError("round_watchdog_timeout")
    if code != 0:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            # The exclusively owned group may have exited; no process remains to signal.
            pass
        raise C.EvidenceError("round_worker_failed")
    remaining(deadline)


def publish(output, identity, deadline):
    remaining(deadline)
    result = C.decode_json(regular_bytes(output / "worker-result.json", 1024 * 1024))
    summary = result.get("summary", {})
    if (result.get("round") != identity or summary.get("round") != identity
            or summary.get("mode") != "report-only" or summary.get("mergeAuthorized") is not False):
        raise C.EvidenceError("round_handoff_mismatch")
    files = result.get("files")
    processed = summary.get("processed")
    selected = summary.get("discovery", {}).get("selected", [])
    evaluation = summary.get("selectedEvaluation")
    if (not isinstance(files, list) or len(files) > 2
            or summary.get("status") not in ("completed", "failure")
            or not isinstance(processed, list) or len(processed) > 1
            or any(not C.positive_int(n) for n in processed)
            or not isinstance(selected, list) or len(selected) > 1
            or any(not C.positive_int(n) for n in selected)
            or any(n not in selected for n in processed)
            or len(files) != 2 * len(processed)
            or (not processed and evaluation is not None)
            or (processed and (not isinstance(evaluation, dict)
                or evaluation.get("number") != processed[0] or type(evaluation.get("eligible")) is not bool))):
        raise C.EvidenceError("round_output_manifest_rejected")
    names = set()
    for item in files:
        path = item.get("path", "")
        if (not re.fullmatch(r"[1-9][0-9]*/(?:observations|report)\.json", path) or path in names
                or int(path.split("/")[0]) not in summary.get("processed", [])):
            raise C.EvidenceError("round_output_manifest_rejected")
        names.add(path)
        file = output / STAGING / path
        no_symlink_parents(file)
        raw = regular_bytes(file, 30 * 1024 * 1024)
        value = C.decode_json(raw)
        if C.digest(raw) != item.get("sha256") or value.get("round") != identity:
            raise C.EvidenceError("round_output_identity_mismatch")
        if path.endswith("/report.json") and (value.get("mode") != "report-only"
                or value.get("mergeAuthorized") is not False
                or value.get("result", {}).get("eligible") is not evaluation["eligible"]):
            raise C.EvidenceError("invalid_evaluator_report")
    if files and (len(files) != 2 or len(summary.get("processed", [])) != 1):
        raise C.EvidenceError("round_output_manifest_rejected")
    if summary.get("status") == "failure" and files:
        raise C.EvidenceError("failed_round_cannot_publish_reports")
    remaining(deadline)
    if files:
        number = str(summary["processed"][0])
        if (output / number).exists() or (output / number).is_symlink():
            raise C.EvidenceError("output_already_exists")
        os.rename(output / STAGING / number, output / number)
    (output / "worker-result.json").unlink()
    atomic_json(output / "summary.json", summary)
    return summary


def prepare_output(path, identity):
    if any(ord(char) < 32 for char in str(path)):
        raise C.EvidenceError("output_path_rejected")
    no_symlink_parents(path)
    if not path.parent.is_dir():
        raise C.EvidenceError("output_parent_missing")
    path.mkdir(mode=0o700)  # Exclusive: an existing root is never read or reused.
    atomic_json(path / "round.json", identity)


def discard_unpublished(output):
    (output / "worker-result.json").unlink(missing_ok=True)
    staging = output / STAGING
    if staging.is_symlink():
        staging.unlink()
    elif staging.exists():
        shutil.rmtree(staging)
    # All numeric directories belong to this exclusively created round.
    for directory in output.iterdir():
        if re.fullmatch(r"[1-9][0-9]*", directory.name):
            if directory.is_symlink():
                directory.unlink()
            elif directory.is_dir():
                shutil.rmtree(directory)


def main():
    deadline = time.monotonic() + C.DEFAULT_LIMITS["seconds"]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--round-id", help=argparse.SUPPRESS)
    parser.add_argument("--deadline", type=float, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker:
        if args.deadline is None or not math.isfinite(args.deadline) or not args.round_id:
            raise C.EvidenceError("round_handoff_missing")
        worker(args, os.environ)
        return 0
    if args.round_id is not None or args.deadline is not None:
        raise C.EvidenceError("round_handoff_rejected")
    identity = {**context_identity(os.environ), "identity": uuid.uuid4().hex}
    output = Path(args.output).absolute()
    prepare_output(output, identity)
    # Set only after exclusive creation, so failed reuse cannot upload old output.
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as stream:
            stream.write("report-path=" + str(output) + "\n")
    context = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    arguments = [sys.executable, "-I", "-B", str(Path(__file__).resolve()), "--worker",
                 "--event", args.event, "--output", str(output),
                 "--round-id", identity["identity"], "--deadline", str(deadline)]
    try:
        supervise(arguments, context, deadline)
        summary = publish(output, identity, deadline)
    except (C.EvidenceError, OSError, ValueError, TypeError, subprocess.SubprocessError) as error:
        code = error.code if isinstance(error, C.EvidenceError) else "round_parent_failed"
        summary = failed_summary(identity, code)
        discard_unpublished(output)
        atomic_json(output / "summary.json", summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as stream:
            stream.write(f"Read-only canary round: {summary['status']}; coverage: {summary['coverage']}. "
                         f"Processed {len(summary['processed'])} PR(s). No merge authorized. "
                         "Deferred and excluded targets are listed in the current-round artifact.\n")
    print(json.dumps({"status": summary["status"], "coverage": summary["coverage"], "mergeAuthorized": False}))
    return 1 if summary["status"] == "failure" else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (C.EvidenceError, OSError, ValueError, TypeError, subprocess.SubprocessError):
        print("Read-only canary failed; no current eligibility report was published", file=sys.stderr)
        raise SystemExit(1)
