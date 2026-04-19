---
name: forge
description: "Forge utility for PR-centric repos. Use when the harness or a user needs `gh` CLI help for pull requests, workflow runs, issues, or API reads inside the current repository."
---

# Forge

Use `gh` to inspect or manipulate the current repository's forge state.

This skill is a utility surface for the harness, not a workflow owner.

Use it when you need:

- PR metadata
- workflow run state
- issue or discussion lookups
- API reads that are missing from simpler `gh` subcommands

Prefer running inside the current repo so branch and PR resolution are automatic.

## Pull Requests

Check CI status on a PR:

```bash
gh pr checks 55 --repo owner/repo
```

List recent workflow runs:

```bash
gh run list --repo owner/repo --limit 10
```

View a run and see which steps failed:

```bash
gh run view <run-id> --repo owner/repo
```

View logs for failed steps only:

```bash
gh run view <run-id> --repo owner/repo --log-failed
```

If the task is specifically "find and fix failing CI", route through `ci-recovery`.

## API for advanced queries

The `gh api` command is useful for data not exposed through simpler subcommands.

Get a PR with specific fields:

```bash
gh api repos/owner/repo/pulls/55 --jq '.title, .state, .user.login'
```

## JSON output

Most commands support `--json` and `--jq`:

```bash
gh issue list --repo owner/repo --json number,title --jq '.[] | "\(.number): \(.title)"'
```
