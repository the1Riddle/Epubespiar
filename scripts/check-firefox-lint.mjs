import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Strict CI gate for addons-linter JSON output.
 *
 * Deliberately exempts at most one identified false positive from Vue's
 * generated runtime. Never blanket-ignore warning codes or skip files.
 */
export function checkFirefoxLint(report, cliExitCode = 0) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("Invalid addons-linter JSON report");
  }

  const diagnostics = (singular, plural) => {
    const entries = report[singular] ?? report[plural];
    if (!Array.isArray(entries)) {
      throw new Error(`addons-linter report missing "${singular}" diagnostics array`);
    }
    return entries;
  };

  const errors = diagnostics("error", "errors");
  const warnings = diagnostics("warning", "warnings");
  const notices = diagnostics("notice", "notices");

  const summaryValue = (singular, plural) =>
    report.summary?.[singular] ?? report.summary?.[plural];

  if (report.summary && (
    (typeof summaryValue("error", "errors") === "number" &&
      summaryValue("error", "errors") !== errors.length) ||
    (typeof summaryValue("warning", "warnings") === "number" &&
      summaryValue("warning", "warnings") !== warnings.length)
  )) {
    throw new Error("addons-linter summary does not match its diagnostics");
  }

  const isKnownVueWarning = (warning) => {
    const file = String(warning.file || "").replace(/\\/g, "/").replace(/^\.\//, "");
    return warning.code === "UNSAFE_VAR_ASSIGNMENT" &&
      file === "src/helper-plugin-vue_export-helper.js" &&
      warning.message === "Unsafe assignment to innerHTML";
  };

  const known = warnings.filter(isKnownVueWarning);
  const unexpected = [...errors, ...warnings.filter(warning => !isKnownVueWarning(warning))];
  if (known.length > 1) unexpected.push(...known.slice(1));

  const total = errors.length + warnings.length + notices.length;
  const messages = [
    `Firefox addons-linter: ${errors.length} errors, ${warnings.length} warnings, ${notices.length} notices.`,
  ];
  if (known.length) {
    messages.push(
      `Known Vue-generated innerHTML warning: ${Math.min(known.length, 1)} narrowly accepted (see scripts/check-firefox-lint.mjs).`,
    );
  }

  for (const item of unexpected) {
    const file = String(item.file || "").replace(/[\r\n]/g, " ");
    const code = String(item.code || "UNKNOWN").replace(/[\r\n]/g, " ");
    const message = String(item.message || "No message").replace(/[\r\n]/g, " ");
    const location = file ? ` (${file}:${item.line || "?"}:${item.column || "?"})` : "";
    messages.push(`FAIL ${code}: ${message}${location}`);
  }

  if (cliExitCode !== 0 && unexpected.length === 0) {
    messages.push(`addons-linter CLI exited with code ${cliExitCode} despite no unexpected diagnostics.`);
  }

  const failed = unexpected.length > 0 || cliExitCode !== 0;
  if (!failed) messages.push(`PASS: ${total} diagnostics examined; all errors and unexpected warnings absent.`);
  return { failed, messages, acceptedWarnings: Math.min(known.length, 1), unexpected };
}

function main() {
  const path = process.argv[2];
  const exitCodeText = process.argv[3] || "0";
  const cliExitCode = Number(exitCodeText);
  if (!path || !Number.isSafeInteger(cliExitCode) || cliExitCode < 0) {
    console.error("Usage: node scripts/check-firefox-lint.mjs <report.json> <cli-exit-code>");
    process.exitCode = 1;
    return;
  }
  try {
    const report = JSON.parse(readFileSync(resolve(path), "utf8"));
    const result = checkFirefoxLint(report, cliExitCode);
    for (const message of result.messages) console.log(message);
    if (result.failed) process.exitCode = 1;
  } catch (error) {
    console.error(`Firefox addon lint could not be verified: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main();
}
