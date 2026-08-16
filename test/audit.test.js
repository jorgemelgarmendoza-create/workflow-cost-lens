import test from "node:test";
import assert from "node:assert/strict";
import { auditWorkflow, shouldFail } from "../src/audit.js";

test("reports avoidable CI cost and permission signals", () => {
  const findings = auditWorkflow(`name: CI
on:
  pull_request:
  schedule:
    - cron: '*/5 * * * *'
jobs:
  test:
    strategy:
      matrix:
        node: [20, 22]
        os: [ubuntu-latest, windows-latest, macos-latest]
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
      - run: npm install
`, "ci.yml", { maxMatrixSize: 4 });

  assert.ok(findings.some((finding) => finding.title.includes("concurrency")));
  assert.ok(findings.some((finding) => finding.title.includes("Full git history")));
  assert.ok(findings.some((finding) => finding.title.includes("Large matrix")));
  assert.ok(findings.some((finding) => finding.title.includes("not pinned")));
  assert.ok(findings.some((finding) => finding.title.includes("No explicit token permissions")));
});

test("accepts a scoped, cached, SHA-pinned workflow", () => {
  const findings = auditWorkflow(`name: CI
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  test:
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - uses: actions/setup-node@1e60f620b9541d9b882cd86e7294044633f6d3c8 # v4.0.3
        with:
          cache: npm
      - run: npm ci
`, "ci.yml");

  assert.equal(findings.length, 0);
  assert.equal(shouldFail(findings, "low"), false);
});
