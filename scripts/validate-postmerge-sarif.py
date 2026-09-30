#!/usr/bin/env python3
"""Validate local post-merge CodeQL evidence; never execute source or fetch references."""
import argparse
import json
import os
import re
import stat
from pathlib import Path
from urllib.parse import unquote, urlparse

SHA = re.compile(r"[0-9a-f]{40}\Z")
CATEGORIES = {
    "javascript-typescript": ".github/workflows/codeql.yml:analyze",
    "python": ".github/workflows/codeql.yml:analyze-python",
    "actions": ".github/workflows/codeql.yml:analyze-actions",
}
SUFFIXES = {"javascript-typescript": {".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"}, "python": {".py"}, "actions": {".yml", ".yaml"}}


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, "duplicate-json-key")
        result[key] = value
    return result


def read_json(path, limit, directory_fd=None):
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd)
    except OSError:
        raise ValueError("unavailable-or-nonregular-evidence-file") from None
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode), "nonregular-evidence-file")
        require(0 < info.st_size <= limit, "missing-or-oversized-evidence")
        data = stream.read(limit + 1)
    require(len(data) <= limit, "oversized-evidence")
    return json.loads(data, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite-json")))


def source_path(value, language):
    require(isinstance(value, str) and value and not value.startswith("/") and "\\" not in value
            and all(part not in ("", ".", "..") for part in value.split("/"))
            and not any(ord(char) < 32 or ord(char) == 127 for char in value), "invalid-source-path")
    require(Path(value).suffix.lower() in SUFFIXES[language]
            and (language != "actions" or value.startswith(".github/workflows/")), "source-language-mismatch")
    return value


def artifact_path(location, bases, source_root):
    """Resolve local SARIF locations only; no URL fetching, recursive bases or execution."""
    require(isinstance(location, dict) and isinstance(location.get("uri"), str), "invalid-artifact-location")
    uri = location["uri"]
    if location.get("uriBaseId") is not None:
        base = bases.get(location["uriBaseId"])
        if base is None and location["uriBaseId"] == "%SRCROOT%":
            base = {"uri": source_root.as_uri() + "/"}
        require(isinstance(base, dict) and isinstance(base.get("uri"), str) and "uriBaseId" not in base, "unknown-artifact-base")
        uri = base["uri"] + uri
    parsed = urlparse(uri)
    require(parsed.scheme in ("", "file") and not parsed.netloc and not parsed.query and not parsed.fragment,
            "nonlocal-artifact-location")
    path = unquote(parsed.path)
    require("\\" not in path and not any(ord(char) < 32 or ord(char) == 127 for char in path), "invalid-artifact-location")
    parts = Path(path).parts
    require(".." not in parts, "artifact-traversal")
    if Path(path).is_absolute():
        try:
            return Path(path).relative_to(source_root).as_posix()
        except ValueError:
            return None
    return path


def validate(directory, expected):
    language = expected["language"]
    require(language in CATEGORIES, "unsupported-language")
    for key in ("revision", "workflow_sha", "event_sha"):
        require(isinstance(expected[key], str) and SHA.fullmatch(expected[key]), "invalid-expected-sha")
    for key in ("repository_id", "run_id", "attempt"):
        require(type(expected[key]) is int and expected[key] > 0, "invalid-expected-id")
    require(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", expected["repository"]), "invalid-repository")
    require(expected["event"] in ("workflow_run", "workflow_dispatch"), "unsupported-postmerge-event")
    require(expected["workflow_ref"].startswith(expected["repository"] + "/.github/workflows/")
            and expected["workflow_ref"].endswith("@refs/heads/main"), "invalid-caller-workflow-ref")
    root = Path(expected["source_root"])
    require(root.is_absolute(), "invalid-source-root")
    try:
        directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError:
        raise ValueError("nonregular-evidence-directory") from None
    try:
        require(set(os.listdir(directory_fd)) == {"receipt.json", language + ".sarif"}, "evidence-member-set")
        receipt = read_json("receipt.json", 2 * 1024 * 1024, directory_fd)
        document = read_json(language + ".sarif", 8 * 1024 * 1024, directory_fd)
    finally:
        os.close(directory_fd)
    require(isinstance(receipt, dict) and type(receipt.get("schemaVersion")) is int and receipt["schemaVersion"] == 1, "invalid-receipt")
    bindings = {"repositoryId": "repository_id", "repository": "repository", "runId": "run_id", "runAttempt": "attempt",
                "workflowRef": "workflow_ref", "workflowSha": "workflow_sha", "event": "event", "eventSha": "event_sha", "checkoutSha": "revision"}
    for field, key in bindings.items():
        require(type(receipt.get(field)) is type(expected[key]) and receipt[field] == expected[key], "receipt-" + field + "-mismatch")
    category = "reusable-validation:" + CATEGORIES[language]
    require(receipt.get("workflowPath") == ".github/workflows/codeql.yml"
            and receipt.get("jobName") == f"analyze ({language})"
            and receipt.get("language") == language and receipt.get("category") == category, "receipt-analysis-identity")
    require(isinstance(receipt.get("workflowSha256"), str) and re.fullmatch(r"[0-9a-f]{64}", receipt["workflowSha256"]), "missing-workflow-digest")
    require(isinstance(receipt.get("sourceTree"), str) and SHA.fullmatch(receipt["sourceTree"]), "missing-source-tree")
    files = receipt.get("sourceFiles")
    require(isinstance(files, list) and files, "empty-source-inventory")
    paths = []
    for file in files:
        require(isinstance(file, dict) and file.get("mode") in ("100644", "100755") and file.get("type") == "blob"
                and isinstance(file.get("blob"), str) and SHA.fullmatch(file["blob"]), "invalid-source-object")
        paths.append(source_path(file.get("path"), language))
    require(len(paths) == len(set(paths)), "duplicate-source-path")
    require(isinstance(document, dict) and document.get("version") == "2.1.0"
            and isinstance(document.get("runs"), list) and len(document["runs"]) == 1, "invalid-sarif-run-set")
    require(document.get("inlineExternalProperties", []) == [], "external-sarif-properties")
    run = document["runs"][0]
    require(isinstance(run, dict), "invalid-sarif-run")
    require(run.get("externalPropertyFileReferences", {}) == {} and "conversion" not in run, "external-or-converted-sarif")
    driver = run.get("tool", {}).get("driver", {})
    require(driver.get("name") == "CodeQL" and driver.get("semanticVersion") == "2.27.1", "codeql-version-mismatch")
    require(run.get("automationDetails", {}).get("id") == category + "/", "sarif-category-mismatch")
    require(isinstance(run.get("results"), list) and len(run["results"]) == 0, "sarif-findings-or-missing-results")
    invocations = run.get("invocations")
    require(isinstance(invocations, list) and invocations, "missing-invocations")
    extracted = set()
    diagnostic = {"javascript-typescript": "js", "python": "py", "actions": "actions"}[language] + "/diagnostics/successfully-extracted-files"
    for invocation in invocations:
        require(isinstance(invocation, dict) and invocation.get("executionSuccessful") is True, "unsuccessful-invocation")
        for field in ("toolExecutionNotifications", "toolConfigurationNotifications"):
            notifications = invocation.get(field, [])
            require(isinstance(notifications, list) and all(isinstance(item, dict) and item.get("level") in ("none", "note") for item in notifications), "sarif-warning-or-error")
            for item in notifications:
                if item.get("descriptor", {}).get("id") == diagnostic:
                    for location in item.get("locations", []):
                        extracted.add(artifact_path(location.get("physicalLocation", {}).get("artifactLocation"), run.get("originalUriBaseIds", {}), root))
    artifacts = run.get("artifacts")
    require(isinstance(artifacts, list) and artifacts, "empty-analysis-artifacts")
    bases = run.get("originalUriBaseIds", {})
    require(isinstance(bases, dict), "invalid-artifact-bases")
    analyzed = {artifact_path(item.get("location"), bases, root) for item in artifacts if isinstance(item, dict) and "location" in item}
    require(bool(analyzed.intersection(paths).intersection(extracted)), "no-tracked-language-source-in-analysis")
    return {"language": language, "revision": expected["revision"], "resultCount": 0,
            "trackedSourceMatches": len(analyzed.intersection(paths).intersection(extracted)), "category": category + "/"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True)
    for key in ("language", "revision", "repository", "workflow-sha", "workflow-ref", "event", "event-sha", "source-root"):
        parser.add_argument("--" + key, required=True)
    for key in ("repository-id", "run-id", "attempt"):
        parser.add_argument("--" + key, required=True, type=int)
    args = vars(parser.parse_args())
    directory = args.pop("directory")
    try:
        print(json.dumps(validate(directory, args), sort_keys=True))
    except (ValueError, OSError, KeyError, TypeError, AttributeError, RecursionError):
        # Evidence may contain sensitive source excerpts. Never echo raw parser exceptions.
        raise SystemExit("Post-merge CodeQL evidence did not satisfy the strict gate") from None


if __name__ == "__main__":
    main()
