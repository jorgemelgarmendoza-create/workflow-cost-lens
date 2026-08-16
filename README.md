# Workflow Cost Lens

Static, dependency-free checks for GitHub Actions workflows that point to avoidable runner time, workflow fan-out, and fragile defaults. It produces a Markdown summary in the workflow run and can fail a pull request at a chosen severity.

It is intentionally a signal finder—not a billing calculator or a security guarantee. It helps teams decide where a human review is worth the time.

## Why it exists

CI spend often grows quietly: obsolete pull-request jobs keep running, matrices multiply across operating systems, full Git histories are downloaded for routine checks, and scheduled workflows run more frequently than the work requires. This action makes those trade-offs visible in code review.

## Quick start

```yaml
name: Workflow health

on:
  pull_request:
    paths:
      - ".github/workflows/**"

permissions:
  contents: read

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - uses: jorgemelgarmendoza-create/workflow-cost-lens@v1
        with:
          fail-on: high
          max-matrix-size: 8
```

Replace the action reference with the released tag after publishing this repository. During local development, use a relative action path or test the JavaScript directly.

## Signals

| Area | What it surfaces |
| --- | --- |
| Cost | Full git history, a high-frequency schedule, large visible matrices, missing PR concurrency, and a missing Node dependency cache. |
| Reliability | `npm install` in CI, which can be less reproducible than `npm ci`. |
| Reviewable security defaults | `pull_request_target`, `permissions: write-all`, missing explicit permissions, and unpinned action references. |

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `workflows-directory` | `.github/workflows` | Directory to scan recursively. |
| `fail-on` | `high` | `none`, `low`, `medium`, `high`, or `critical`. |
| `max-matrix-size` | `8` | Warn above this visible matrix size. |
| `pin-actions` | `true` | Report non-SHA-pinned external action references. |

## Outputs

| Output | Description |
| --- | --- |
| `score` | A 0–100 heuristic score. |
| `findings` | Number of static signals. |
| `has-failures` | `true` when the configured threshold is met. |

## Commercial use and support

The core action is free to use. Teams that need a policy tailored to their repositories can request a scoped workflow audit and a pull request with reviewed fixes through the repository's issue tracker after the project is published. The audit should be performed only against repositories the requester is authorized to share.

## Local verification

Requires Node.js 20 or later.

```bash
npm test
```

## License

MIT. See [LICENSE](LICENSE).
