import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { auditDirectory, shouldFail } from "./audit.js";

function input(name, fallback) {
  return process.env[`INPUT_${name.replaceAll("-", "_").toUpperCase()}`] ?? fallback;
}

function toBoolean(value) {
  return !["false", "0", "no"].includes(String(value).toLowerCase());
}

function escape(value) {
  return String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${escape(value)}\n`);
  else console.log(`::set-output name=${name}::${escape(value)}`);
}

function markdown(result, directory) {
  const rows = result.findings.map((finding) => `| ${finding.severity.toUpperCase()} | ${finding.category} | ${finding.title} | ${finding.file}:${finding.line} |`).join("\n");
  const recommendations = result.findings.map((finding) => `- **${finding.title}** — ${finding.remediation}`).join("\n");
  return [
    "## Workflow Cost Lens",
    "",
    `**Score:** ${result.score}/100  ·  **Workflows scanned:** ${result.files.length}  ·  **Signals:** ${result.findings.length}`,
    "",
    `Directory: \`${directory}\``,
    "",
    result.findings.length ? "| Severity | Category | Signal | Location |\n| --- | --- | --- | --- |\n" + rows : "No static cost or reliability signals were found.",
    result.findings.length ? "\n### Suggested next changes\n\n" + recommendations : "",
    "\n> This score is a static heuristic, not an estimate of GitHub billing or a security guarantee."
  ].filter(Boolean).join("\n");
}

const directory = input("workflows-directory", ".github/workflows");
const failOn = input("fail-on", "high").toLowerCase();
const result = auditDirectory(resolve(directory), {
  maxMatrixSize: input("max-matrix-size", "8"),
  pinActions: toBoolean(input("pin-actions", "true"))
});
const fails = shouldFail(result.findings, failOn);
const report = markdown(result, directory);

console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
setOutput("score", result.score);
setOutput("findings", result.findings.length);
setOutput("has-failures", fails);

if (fails) {
  console.error(`Workflow Cost Lens found findings at or above ${failOn}.`);
  process.exitCode = 1;
}
