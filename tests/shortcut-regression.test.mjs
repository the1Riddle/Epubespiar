import test from "node:test";
import assert from "node:assert/strict";
import {
  createReaderShortcutHandler,
  readerShortcuts,
} from "../src/composables/reader/useReaderShortcuts.js";

const keyEvent = (key, { ctrl = false, alt = false, typing = false, repeat = false } = {}) => {
  const target = {
    isContentEditable: false,
    matches: () => typing,
  };
  return {
    key,
    ctrlKey: ctrl,
    altKey: alt,
    shiftKey: false,
    metaKey: false,
    repeat,
    defaultPrevented: false,
    isComposing: false,
    keyCode: 0,
    target,
    composedPath: () => [target],
    getModifierState: () => false,
    preventDefault() { this.defaultPrevented = true; },
  };
};

test("panel shortcuts toggle instead of repeatedly opening their target", () => {
  const state = { library: false, toc: false, settings: false };
  const toggle = key => { state[key] = !state[key]; };
  const actions = {
    openLibrary: { run: () => toggle("library") },
    openToc: { run: () => toggle("toc") },
    openSettings: { run: () => toggle("settings") },
  };
  const handler = createReaderShortcutHandler({ actions });
  handler(keyEvent("Home", {ctrl: true}));
  assert.equal(state.library, true);
  handler(keyEvent("Home", {ctrl: true}));
  assert.equal(state.library, false);
  handler(keyEvent("[", {ctrl: true}));
  assert.equal(state.toc, true);
  handler(keyEvent("]", {ctrl: true}));
  assert.equal(state.toc, false);
  handler(keyEvent("F9", {ctrl: true}));
  assert.equal(state.settings, true);
  handler(keyEvent("F9", {ctrl: true}));
  assert.equal(state.settings, false);
});

test("held toggle shortcut is not repeated and typing is protected except own panel close", () => {
  let isOpen = false;
  const actions = {
    openSettings: {
      run: () => { isOpen = !isOpen; },
      allowWhenTyping: () => isOpen,
    },
  };
  const handler = createReaderShortcutHandler({ actions });
  const typingOpen = keyEvent("F9", {ctrl: true, typing: true});
  handler(typingOpen);
  assert.equal(isOpen, false);
  assert.equal(typingOpen.defaultPrevented, false);

  handler(keyEvent("F9", {ctrl: true}));
  assert.equal(isOpen, true);
  handler(keyEvent("F9", {ctrl: true, typing: true, repeat: true}));
  assert.equal(isOpen, true);
  handler(keyEvent("F9", {ctrl: true, typing: true}));
  assert.equal(isOpen, false);
});

test("Escape is bound only to fullscreen and does not perform sidebar actions", () => {
  assert.deepEqual(
    readerShortcuts.filter(binding => binding.key === "Escape").map(binding => binding.action),
    ["exitFullscreen"],
  );
  let fullscreen = false;
  let toc = true;
  const handler = createReaderShortcutHandler({
    actions: {
      exitFullscreen: {
        enabled: () => fullscreen,
        run: () => { fullscreen = false; },
      },
    },
  });
  const noFullscreen = keyEvent("Escape");
  handler(noFullscreen);
  assert.equal(noFullscreen.defaultPrevented, false);
  assert.equal(toc, true);
  fullscreen = true;
  const inFullscreen = keyEvent("Escape");
  handler(inFullscreen);
  assert.equal(inFullscreen.defaultPrevented, true);
  assert.equal(fullscreen, false);
  assert.equal(toc, true);
});

test("modal blocking receives selected binding, and modifiers must match exactly", () => {
  let settingsOpen = true;
  const handler = createReaderShortcutHandler({
    isBlocked: binding => settingsOpen && binding.action !== "openSettings",
    actions: {
      openSettings: {run: () => { settingsOpen = !settingsOpen; }},
      openLibrary: {run: () => assert.fail("library shortcut must be blocked")},
    },
  });
  handler(keyEvent("Home", {ctrl: true}));
  assert.equal(settingsOpen, true);
  handler(keyEvent("F9", {ctrl: true}));
  assert.equal(settingsOpen, false);
  const wrongModifier = keyEvent("Home", {alt: true});
  handler(wrongModifier);
  assert.equal(wrongModifier.defaultPrevented, false);
});
