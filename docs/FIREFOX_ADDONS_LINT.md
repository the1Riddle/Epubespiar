# Firefox add-on validation in CI

The [Extension audit workflow](../.github/workflows/extension-audit.yml)
runs Mozilla's `addons-linter` on the **packaged Firefox ZIP** after the
production builds and ZIP size checks. It uses a pinned, one-off tool command:

```bash
pnpm dlx addons-linter@10.15.0 epubespiar-firefox.zip --output=json > addons-linter-report.json
node scripts/check-firefox-lint.mjs addons-linter-report.json
```

The tool is deliberately **not** included in `dependencies` or
`devDependencies`, and does not change the shipped extension's size. You can
also run the globally installed `addons-linter` command locally. When running
the linter directly, it will still print the known generated-code warnings;
the CI gate is what verifies and classifies them.

## Firefox add-on ID

The Firefox manifest reads `FIREFOX_MANIFEST_EXT_ID` from the environment when
the build generates `dist/firefox/manifest.json`. GitHub Actions passes the
existing secret `FIREFOX_MANIFEST_EXT_ID` to the build step. The workflow
stops with an explicit error if the secret is unavailable; it does not use a
fake ID or silently allow the MV3 add-on ID validation error.

To reproduce locally, provide the actual ID through your existing environment
configuration, then build the extension and run the linter. Do not commit a
private environment file or expose a secret's value in job logs.

## Warning policy

`scripts/check-firefox-lint.mjs` inspects Mozilla's JSON diagnostics:

- **Every linter error fails CI.**
- **Every unexpected warning fails CI.**
- At most one warning per exact generated file can be accepted for two reviewed
  third-party implementation details, and only after checking the reported
  location against the bundled source:
  - `src/helper-plugin-vue_export-helper.js`: Vue's
    `insertStaticContent` static-template insertion.
  - `src/reader.js`: DOMPurify's fallback parser using a detached document
    before it sanitizes markup.
- Both exceptions require the exact code `UNSAFE_VAR_ASSIGNMENT`, the message
  `Unsafe assignment to innerHTML`, the expected file, a valid line/column,
  and the expected library-specific instructions around that location. A
  second warning from either file, a shifted or changed sink, or another type
  of unsafe assignment fails.
- Notices are informational; invalid JSON, missing diagnostic lists, an
  inconsistent summary or a failed linter invocation also fails CI.

**Security note:** The Vue and DOMPurify exceptions are *not* an exemption for
reader code assigning untrusted EPUB HTML to `innerHTML`. They must be reviewed
again when the build output or dependencies change. Untrusted EPUB chapter
markup is sanitized and appended as a DOM fragment in `ChapterContent.vue`;
that protection is separate from the generated-library warning classification.

See [the gate tests](../tests/addons-linter-gate.test.mjs) for positive and
negative cases. For changes to this allowlist, inspect the actual packaged JS
and explain why the flagged library operation is safe before changing the
accepted patterns.
