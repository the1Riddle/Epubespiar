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

const report = ({ error = [], warning = [], notice = [] } = {}) => ({
  summary: { error: error.length, warning: warning.length, notice: notice.length },
  error, warning, notice,
});

test("addon-linter gate passes clean Firefox package", () => {
  const result = checkFirefoxLint(report());
  assert.equal(result.failed, false);
});

test("allows one known Vue-generated innerHTML warning without suppressing other issues", () => {
  const result = checkFirefoxLint(report({warning: [generatedVueWarning]}));
  assert.equal(result.failed, false);
  assert.equal(result.acceptedWarnings, 1);
});

test("other unsafe innerHTML warnings must fail, even inside Vue's helper", () => {
  const otherFile = {...generatedVueWarning, file: "src/reader.js"};
  const otherMessage = {...generatedVueWarning, message: "Unsafe assignment to outerHTML"};
  const differentCode = {...generatedVueWarning, code: "DANGEROUS_EVAL"};
  for (const diagnostic of [otherFile, otherMessage, differentCode]) {
    assert.equal(checkFirefoxLint(report({warning: [diagnostic]})).failed, true);
  }
});

test("a second Vue warning is not silently accepted", () => {
  const second = {...generatedVueWarning, line: 23, column: 14};
  assert.equal(checkFirefoxLint(report({warning: [generatedVueWarning, second]})).failed, true);
});

test("all genuine linter errors and warnings block CI", () => {
  const result = checkFirefoxLint(report({
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
  assert.equal(checkFirefoxLint(report(), 1).failed, true);
  assert.throws(() => checkFirefoxLint({warning: []}), /missing/);
  assert.throws(() => checkFirefoxLint({
    ...report(),
    summary: {error: 1, warning: 0, notice: 0},
  }), /summary/);
});
