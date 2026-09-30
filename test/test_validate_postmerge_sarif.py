import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

VALIDATOR_PATH = Path(__file__).resolve().parents[1] / "scripts" / "validate-postmerge-sarif.py"
SPEC = importlib.util.spec_from_file_location("validator", VALIDATOR_PATH)
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)


def fixture(language):
    path = {"javascript-typescript": "src/main.ts", "python": "scripts/helper.py", "actions": ".github/workflows/ci.yml"}[language]
    expected = {"language": language, "revision": "a" * 40, "repository": "openboa-ai/openboa", "repository_id": 123,
                "run_id": 456, "attempt": 1, "workflow_sha": "b" * 40,
                "workflow_ref": "openboa-ai/openboa/.github/workflows/readme-writer.yml@refs/heads/main",
                "event": "workflow_run", "event_sha": "b" * 40, "source_root": "/home/runner/work/openboa/openboa"}
    category = "reusable-validation:" + validator.CATEGORIES[language]
    receipt = {"schemaVersion": 1, "repositoryId": 123, "repository": expected["repository"], "runId": 456, "runAttempt": 1,
               "workflowRef": expected["workflow_ref"], "workflowPath": ".github/workflows/codeql.yml", "workflowSha": "b" * 40,
               "workflowSha256": "c" * 64, "event": "workflow_run", "eventSha": "b" * 40, "headSha": None, "baseSha": None,
               "checkoutSha": "a" * 40, "parents": ["b" * 40], "sourceTree": "d" * 40,
               "sourceFiles": [{"path": path, "mode": "100755" if language == "python" else "100644", "type": "blob", "blob": "e" * 40}],
               "jobName": f"analyze ({language})", "language": language, "category": category}
    location = {"uri": path, "uriBaseId": "%SRCROOT%"}
    diag = {"javascript-typescript": "js", "python": "py", "actions": "actions"}[language] + "/diagnostics/successfully-extracted-files"
    sarif = {"version": "2.1.0", "runs": [{"tool": {"driver": {"name": "CodeQL", "semanticVersion": "2.27.1"}},
              "automationDetails": {"id": category + "/"}, "results": [], "artifacts": [{"location": location}],
              "invocations": [{"executionSuccessful": True, "toolExecutionNotifications": [{"level": "none", "descriptor": {"id": diag}, "locations": [{"physicalLocation": {"artifactLocation": copy.deepcopy(location)}}]}]}]}]}
    return expected, receipt, sarif


class StrictPostmergeEvidence(unittest.TestCase):
    def test_gate_failure_preserves_prepared_evidence_and_upload_remains_independent(self):
        expected, receipt, sarif = fixture("python")
        sarif["runs"][0]["results"].append({"ruleId": "py/real-finding"})
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, value in [("receipt.json", receipt), ("python.sarif", sarif)]:
                (root / name).write_text(json.dumps(value))
            before = {p.name: p.read_bytes() for p in root.iterdir()}
            with self.assertRaises(ValueError):
                validator.validate(root, expected)
            self.assertEqual(before, {p.name: p.read_bytes() for p in root.iterdir()})
        workflow = (Path(__file__).resolve().parents[1] / ".github/workflows/codeql.yml").read_text()
        self.assertIn("id: prepare_evidence", workflow)
        self.assertIn("if: always() && !cancelled() && steps.prepare_evidence.outcome == 'success' && (success() || inputs.strict_postmerge == true)", workflow)
        strict = workflow.split("      - name: Require strict post-merge raw evidence", 1)[1].split("      - name: Upload merge evidence", 1)[0]
        self.assertNotIn("continue-on-error", strict)

    def check(self, expected, receipt, sarif, mutate_files=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "receipt.json").write_text(json.dumps(receipt))
            (root / (expected["language"] + ".sarif")).write_text(json.dumps(sarif))
            if mutate_files:
                mutate_files(root)
            return validator.validate(root, expected)

    def deny(self, mutate):
        expected, receipt, sarif = fixture("javascript-typescript")
        mutate(expected, receipt, sarif)
        with self.assertRaises((ValueError, KeyError, TypeError, AttributeError)):
            self.check(expected, receipt, sarif)

    def test_all_three_real_language_shapes_without_fake_pr_context(self):
        for language in validator.CATEGORIES:
            with self.subTest(language=language):
                expected, receipt, sarif = fixture(language)
                result = self.check(expected, receipt, sarif)
                self.assertEqual(result["trackedSourceMatches"], 1)
                self.assertNotEqual(receipt["workflowSha"], receipt["checkoutSha"])
                self.assertIsNone(receipt["headSha"])

    def test_context_bindings(self):
        for field in ["repositoryId", "repository", "runId", "runAttempt", "workflowRef", "workflowSha", "event", "eventSha", "checkoutSha", "workflowPath", "jobName", "language", "category"]:
            with self.subTest(field=field):
                self.deny(lambda e, r, s: r.__setitem__(field, "wrong"))
        for field in ["revision", "workflow_sha", "event_sha"]:
            self.deny(lambda e, r, s: e.__setitem__(field, "main"))
        self.deny(lambda e, r, s: e.__setitem__("event", "pull_request"))
        self.deny(lambda e, r, s: r.__setitem__("schemaVersion", True))

    def test_findings_even_suppressed_are_not_success(self):
        self.deny(lambda e, r, s: s["runs"][0].__setitem__("results", [{"suppressions": [{"status": "accepted"}]}]))
        self.deny(lambda e, r, s: s["runs"][0].pop("results"))

    def test_failed_missing_and_warning_invocations(self):
        self.deny(lambda e, r, s: s["runs"][0].__setitem__("invocations", []))
        self.deny(lambda e, r, s: s["runs"][0]["invocations"][0].__setitem__("executionSuccessful", False))
        for field in ["toolExecutionNotifications", "toolConfigurationNotifications"]:
            for level in ["warning", "error", None, "unknown"]:
                self.deny(lambda e, r, s: s["runs"][0]["invocations"][0].__setitem__(field, [{"level": level}]))

    def test_external_properties_and_conversion_cannot_hide_findings(self):
        self.deny(lambda e, r, s: s.__setitem__("inlineExternalProperties", [{"results": [{"ruleId": "hidden"}]}]))
        self.deny(lambda e, r, s: s["runs"][0].__setitem__("externalPropertyFileReferences", {"results": [{"location": {"uri": "external"}}]}))
        self.deny(lambda e, r, s: s["runs"][0].__setitem__("conversion", {"invocation": {"executionSuccessful": True}}))

    def test_zero_empty_analysis_and_wrong_language_scope_deny(self):
        self.deny(lambda e, r, s: s.__setitem__("runs", []))
        self.deny(lambda e, r, s: s["runs"][0].__setitem__("artifacts", []))
        self.deny(lambda e, r, s: r.__setitem__("sourceFiles", []))
        self.deny(lambda e, r, s: s["runs"][0]["invocations"][0].__setitem__("toolExecutionNotifications", []))
        self.deny(lambda e, r, s: s["runs"][0]["invocations"][0]["toolExecutionNotifications"][0]["descriptor"].__setitem__("id", "py/diagnostics/successfully-extracted-files"))
        self.deny(lambda e, r, s: r["sourceFiles"][0].__setitem__("path", "other.ts"))
        self.deny(lambda e, r, s: r["sourceFiles"].append(copy.deepcopy(r["sourceFiles"][0])))
        self.deny(lambda e, r, s: r["sourceFiles"][0].__setitem__("mode", "120000"))

    def test_version_and_category_are_exact(self):
        self.deny(lambda e, r, s: s["runs"][0]["tool"]["driver"].__setitem__("semanticVersion", "2.26.2"))
        self.deny(lambda e, r, s: s["runs"][0]["automationDetails"].__setitem__("id", ".github/workflows/codeql.yml:analyze/"))

    def test_nonlocal_traversal_and_unknown_base_deny(self):
        for uri in ["https://example.test/file.ts", "../main.ts", "file:///outside/main.ts"]:
            self.deny(lambda e, r, s: s["runs"][0]["artifacts"][0].__setitem__("location", {"uri": uri}))
        self.deny(lambda e, r, s: s["runs"][0]["artifacts"][0]["location"].__setitem__("uriBaseId", "%UNKNOWN%"))

    def test_extra_missing_duplicate_and_symlinked_files_deny(self):
        expected, receipt, sarif = fixture("actions")
        mutations = [lambda p: (p / "extra.json").write_text("{}"),
                     lambda p: (p / "actions.sarif").unlink(),
                     lambda p: (p / "actions.sarif").write_text('{"version":"2.1.0","version":"2.1.0"}'),
                     lambda p: ((p / "actions.sarif").unlink(), (p / "actions.sarif").symlink_to(p / "receipt.json"))]
        for mutate in mutations:
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                self.check(expected, receipt, sarif, mutate)


if __name__ == "__main__":
    unittest.main()
