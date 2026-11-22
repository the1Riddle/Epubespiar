import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Precisely two known generated sinks: Vue static template insertion and
 * DOMPurify's detached-document fallback. Neither exception applies unless
 * the bundled source around the reported line/column proves its origin.
 */
const KNOWN_GENERATED_SINKS = Object.freeze({
  "src/helper-plugin-vue_export-helper.js": {
    name: "Vue static-template insertion",
    verify: snippet => snippet.includes("insertStaticContent(") &&
      snippet.includes(".innerHTML=") && snippet.includes(".content"),
  },
  "src/reader.js": {
    name: "DOMPurify detached-document parser fallback",
    verify: snippet => snippet.includes(".parseFromString(") &&
      snippet.includes(".createDocument(") &&
      snippet.includes(".documentElement.innerHTML="),
  },
});
const normalizeFile = file => String(file || "").replace(/\\/g, "/").replace(/^\.\//, "");


/**
 * Strict CI gate for addons-linter JSON output.
 *
 * Deliberately exempts at most one identified false positive from Vue's
 * generated runtime. Never blanket-ignore warning codes or skip files.
 */
export function checkFirefoxLint(report, cliExitCode = 0, {
  readBuiltSource = file => readFileSync(resolve("dist/firefox", file), "utf8"),
} = {}) {
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

  const sourceCache = new Map();
  const knownByFile = new Map();
  const unexpected = [...errors];
  for (const warning of warnings) {
    const file = normalizeFile(warning.file);
    const knownSink = KNOWN_GENERATED_SINKS[file];
    const lineNo = Number(warning.line);
    const columnNo = Number(warning.column);
    if (!knownSink ||
        warning.code !== "UNSAFE_VAR_ASSIGNMENT" ||
        warning.message !== "Unsafe assignment to innerHTML" ||
        !Number.isSafeInteger(lineNo) || lineNo < 1 ||
        !Number.isSafeInteger(columnNo) || columnNo < 1 ||
        knownByFile.has(file)) {
      unexpected.push(warning);
      continue;
    }
    try {
      if (!sourceCache.has(file)) sourceCache.set(file, readBuiltSource(file));
      const line = sourceCache.get(file).split(/\r?\n/)[lineNo - 1] || "";
      const idx = columnNo - 1;
      const assignment = line.slice(idx, idx + 80);
      const atAssignment = /^[A-Za-z_$][\w$]*(?:\.documentElement)?\.innerHTML=/.test(assignment);
      const nearby = line.slice(Math.max(0, idx - 600), idx + 230);
      if (!atAssignment || !knownSink.verify(nearby)) {
        unexpected.push(warning);
        continue;
      }
      knownByFile.set(file, knownSink.name);
    } catch {
      // Failure to verify the actual generated file fails closed.
      unexpected.push(warning);
    }
  }

  const total = errors.length + warnings.length + notices.length;
  const messages = [
    `Firefox addons-linter: ${errors.length} errors, ${warnings.length} warnings, ${notices.length} notices.`,
  ];
  for (const name of knownByFile.values()) {
    messages.push("Accepted verified library-generated warning: " + name + ".");
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
  return { failed, messages, acceptedWarnings: knownByFile.size, unexpected };
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
