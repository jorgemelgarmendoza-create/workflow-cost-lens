import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const severityWeight = { critical: 35, high: 20, medium: 10, low: 5 };

function cleanLine(line) {
  return line.replace(/\s+#.*$/, "").trim();
}

function add(findings, severity, category, title, detail, remediation, file, line) {
  findings.push({ severity, category, title, detail, remediation, file, line });
}

export function listWorkflowFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listWorkflowFiles(path));
    if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) files.push(path);
  }
  return files;
}

function matrixSize(lines) {
  let inMatrix = false;
  let matrixIndent = 0;
  let size = 1;
  let dimensions = 0;

  for (const raw of lines) {
    const indent = raw.length - raw.trimStart().length;
    const line = cleanLine(raw);
    if (/^matrix:\s*$/.test(line)) {
      inMatrix = true;
      matrixIndent = indent;
      continue;
    }
    if (!inMatrix || !line) continue;
    if (indent <= matrixIndent) {
      inMatrix = false;
      continue;
    }
    const match = line.match(/^[\w-]+:\s*\[([^\]]+)\]\s*$/);
    if (match) {
      const values = match[1].split(",").map((value) => value.trim()).filter(Boolean);
      if (values.length > 0) {
        size *= values.length;
        dimensions += 1;
      }
    }
  }
  return { size, dimensions };
}

function hasPullRequestTrigger(lines) {
  return lines.some((raw) => /^(pull_request|pull_request_target):(?:\s|$)/.test(cleanLine(raw)));
}

function hasFrequentSchedule(lines) {
  return lines.some((raw) => {
    const match = cleanLine(raw).match(/^cron:\s*["']?([^"']+)["']?\s*$/);
    if (!match) return false;
    const minute = match[1].trim().split(/\s+/)[0];
    return minute === "*" || /^\*\/(?:[1-9]|[12]\d)$/.test(minute);
  });
}

function isFullSha(reference) {
  return /^[a-f0-9]{40}$/i.test(reference);
}

export function auditWorkflow(content, file, options = {}) {
  const findings = [];
  const lines = content.split(/\r?\n/);
  const maxMatrixSize = Number(options.maxMatrixSize ?? 8);
  const pinActions = options.pinActions !== false;
  const hasPermissions = lines.some((raw) => /^permissions:\s*(?:$|\{|read-all|write-all)/.test(cleanLine(raw)));
  const pullRequestTrigger = hasPullRequestTrigger(lines);

  lines.forEach((raw, index) => {
    const line = cleanLine(raw);
    const number = index + 1;

    if (/^pull_request_target:(?:\s|$)/.test(line)) {
      add(findings, "high", "security", "pull_request_target can execute with elevated repository context", "This trigger is frequently unsafe when a workflow checks out or runs code from an untrusted pull request.", "Use pull_request for untrusted contributions; if pull_request_target is essential, keep it read-only and never execute PR code.", file, number);
    }
    if (/^permissions:\s*write-all\s*$/.test(line)) {
      add(findings, "high", "security", "Workflow grants write-all permissions", "Broad token permissions increase blast radius and can also allow unwanted write operations.", "Declare only the specific read/write scopes required by each job.", file, number);
    }
    if (/^fetch-depth:\s*["']?0["']?\s*$/.test(line)) {
      add(findings, "medium", "cost", "Full git history is fetched", "fetch-depth: 0 downloads the complete history and can make repeated runs slower and more expensive.", "Use the default shallow checkout unless a step demonstrably needs history.", file, number);
    }
    if (/\bnpm\s+install\b/.test(line)) {
      add(findings, "low", "reliability", "npm install is used in CI", "npm install can update the lockfile resolution and is less deterministic than npm ci in continuous integration.", "Use npm ci for reproducible installs and enable dependency caching when appropriate.", file, number);
    }

    const uses = line.match(/^(?:-\s*)?uses:\s*([^\s#]+)/);
    if (uses && pinActions) {
      const value = uses[1].replace(/["']/g, "");
      if (!value.startsWith("./") && !value.startsWith("docker://")) {
        const at = value.lastIndexOf("@");
        const reference = at >= 0 ? value.slice(at + 1) : "";
        if (!isFullSha(reference)) {
          add(findings, "low", "security", "Action is not pinned to a full commit SHA", `The action reference ${value} can change after this workflow is committed.`, "Pin trusted actions to a full commit SHA and document the corresponding release version in a comment.", file, number);
        }
      }
    }
  });

  if (!hasPermissions) {
    add(findings, "medium", "security", "No explicit token permissions are declared", "The workflow relies on repository or organization defaults, which makes least-privilege review harder.", "Declare a minimal permissions block at workflow or job level.", file, 1);
  }
  if (pullRequestTrigger && !lines.some((raw) => /^concurrency:(?:\s|$)/.test(cleanLine(raw)))) {
    add(findings, "medium", "cost", "Pull-request workflow has no concurrency control", "New commits can leave obsolete runs executing after a newer run starts.", "Add a concurrency group based on the workflow and pull request, with cancel-in-progress: true.", file, 1);
  }
  const hasNodeSetup = lines.some((raw) => /actions\/setup-node@/.test(raw));
  const hasNodeCache = lines.some((raw) => /^cache:\s*/.test(cleanLine(raw)) || /actions\/cache@/.test(raw));
  if (hasNodeSetup && !hasNodeCache) {
    add(findings, "low", "cost", "Node setup has no visible dependency cache", "Repeated dependency downloads lengthen CI runs when cache is appropriate for the project.", "For setup-node, add cache: npm, pnpm, or yarn and ensure the lockfile is available.", file, 1);
  }
  if (hasFrequentSchedule(lines)) {
    add(findings, "medium", "cost", "Workflow runs on a frequent schedule", "Schedules more frequent than every 30 minutes can consume runner minutes even when no code has changed.", "Use the slowest schedule that meets the service objective, or gate work on a detected change.", file, 1);
  }

  const matrix = matrixSize(lines);
  if (matrix.dimensions > 0 && matrix.size > maxMatrixSize) {
    add(findings, "medium", "cost", "Large matrix can fan out CI jobs", `The visible matrix has approximately ${matrix.size} combinations, above the configured limit of ${maxMatrixSize}.`, "Reduce duplicate combinations, split optional platforms, or run the full matrix only on main and releases.", file, 1);
  }
  return findings;
}

export function auditDirectory(directory, options = {}) {
  const files = listWorkflowFiles(directory);
  const findings = files.flatMap((file) => auditWorkflow(readFileSync(file, "utf8"), relative(process.cwd(), file), options));
  const penalty = findings.reduce((total, finding) => total + severityWeight[finding.severity], 0);
  return { files, findings, score: Math.max(0, 100 - penalty) };
}

export function shouldFail(findings, failOn) {
  if (failOn === "none") return false;
  const ranking = { low: 1, medium: 2, high: 3, critical: 4 };
  const threshold = ranking[failOn] ?? ranking.high;
  return findings.some((finding) => ranking[finding.severity] >= threshold);
}
