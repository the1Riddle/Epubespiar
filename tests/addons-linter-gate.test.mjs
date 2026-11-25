import test from "node:test";
import assert from "node:assert/strict";
import { checkFirefoxLint } from "../scripts/check-firefox-lint.mjs";

const generatedVueWarning = {
  type: "warning",
  code: "UNSAFE_VAR_ASSIGNMENT",
  message: "Unsafe assignment to innerHTML",
  file: "src/helper-plugin-vue_export-helper.js",
  line: 17,
  column: 1093,
};

const builtSource = (file) => {
  if (file === "src/helper-plugin-vue_export-helper.js") {
    const preceding = "insertStaticContent(e,t,n,s,r,i){const o=n?n.previousSibling:t.lastChild;else{";
    return "\n".repeat(16) +
      " ".repeat(1092 - preceding.length) + preceding +
      "ir.innerHTML=Ni(s==='svg'?e:e);const l=ir.content;return l;";
  }
  throw new Error("Unexpected generated file");
};

const check = (report, cliExitCode = 0, source = builtSource) =>
  checkFirefoxLint(report, cliExitCode, { readBuiltSource: source });

const report = ({ error = [], warning = [], notice = [] } = {}) => ({
  summary: { error: error.length, warning: warning.length, notice: notice.length },
  error, warning, notice,
});

test("addon-linter gate passes clean Firefox package", () => {
  const result = check(report());
  assert.equal(result.failed, false);
});

test("allows one known Vue-generated innerHTML warning without suppressing other issues", () => {
  const result = check(report({warning: [generatedVueWarning]}));
  assert.equal(result.failed, false);
  assert.equal(result.acceptedWarnings, 1);
});

test("other unsafe innerHTML warnings must fail, even inside Vue's helper", () => {
  const otherFile = {...generatedVueWarning, file: "src/reader.js"};
  const otherMessage = {...generatedVueWarning, message: "Unsafe assignment to outerHTML"};
  const differentCode = {...generatedVueWarning, code: "DANGEROUS_EVAL"};
  for (const diagnostic of [otherFile, otherMessage, differentCode]) {
    assert.equal(check(report({warning: [diagnostic]})).failed, true);
  }
});

test("a second Vue warning is not silently accepted", () => {
  const second = {...generatedVueWarning, line: 23, column: 14};
  assert.equal(check(report({warning: [generatedVueWarning, second]})).failed, true);
});

test("all genuine linter errors and warnings block CI", () => {
  const result = check(report({
    error: [{code: "ADDON_ID_REQUIRED", message: "Missing Firefox ID", file: "manifest.json"}],
    warning: [
      generatedVueWarning,
      {code: "UNSUPPORTED_API", message: "Unknown API", file: "src/background.js"},
    ],
  }));
  assert.equal(result.failed, true);
  assert.equal(result.unexpected.length, 2);
});

test("linter CLI failure and invalid reports fail closed", () => {
  assert.equal(check(report(), 1).failed, true);
  assert.throws(() => check({warning: []}), /missing/);
  assert.throws(() => check({
    ...report(),
    summary: {error: 1, warning: 0, notice: 0},
  }), /summary/);
});

test("rejects Vue warnings with an unverified generated context", () => {
  assert.equal(check(report({warning: [generatedVueWarning]}), 0, () =>
    "ir.innerHTML=unsafeInput").failed, true);
});
