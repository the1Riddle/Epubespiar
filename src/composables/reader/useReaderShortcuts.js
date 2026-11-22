import { onMounted, onUnmounted } from "vue";

// Bindings describe keys, not UI components. Actions and availability belong to
// the caller, so new panels or reader implementations don't change dispatch.
export const readerShortcuts = [
  { action: "openSettings", key: "F9", ctrl: true },
  { action: "openLibrary", key: "Home", ctrl: true },
  { action: "closeBook", key: "End", ctrl: true },
  { action: "openBook", key: "Insert", ctrl: true, preserveSelection: true },
  { action: "openToc", key: "[", ctrl: true },
  { action: "openToc", key: "]", ctrl: true },
  { action: "zoomOut", key: ",", alt: true, repeat: true },
  { action: "zoomIn", key: ".", alt: true, repeat: true },
  { action: "resetZoom", key: "/", alt: true },
  { action: "fontSmaller", key: "-", alt: true, repeat: true },
  { action: "fontLarger", key: "=", alt: true, repeat: true },
  { action: "resetFont", key: "0", alt: true },
  // Escape belongs to fullscreen only; panels close with their own shortcuts.
  { action: "exitFullscreen", key: "Escape" },
];

export function isReaderTypingEvent(event) {
  // composedPath also covers editable elements inside the book's shadow DOM.
  const path = event.composedPath?.() || [event.target];
  return path.some(
    (element) =>
      element?.isContentEditable ||
      element?.matches?.('input, textarea, select, [role="textbox"]'),
  );
}

export function createReaderShortcutHandler({
  actions,
  isBlocked = () => false,
  hasSelection = () => false,
  bindings = readerShortcuts,
}) {
  return (event) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.getModifierState?.("AltGraph")
    )
      return;

    const binding = bindings.find(
      (binding) =>
        binding.key === event.key &&
        !!binding.ctrl === event.ctrlKey &&
        !!binding.alt === event.altKey &&
        !!binding.shift === event.shiftKey &&
        !!binding.meta === event.metaKey,
    );
    if (!binding || (binding.preserveSelection && hasSelection(event))) return;

    const action = actions[binding.action];
    if (!action || (action.enabled && !action.enabled())) return;
    if (isBlocked(binding)) return;

    // A panel's own shortcut may close it even if focus is inside its fields.
    // Unrelated shortcuts keep the normal text-entry protection.
    if (isReaderTypingEvent(event)) {
      const allowed = typeof action.allowWhenTyping === "function"
        ? action.allowWhenTyping()
        : action.allowWhenTyping;
      if (!allowed) return;
    }

    event.preventDefault();
    if (!event.repeat || binding.repeat) action.run();
  };
}

export function useReaderShortcuts(options) {
  const handler = createReaderShortcutHandler(options);
  // Capture permits the settings toggle to close its own modal dialog;
  // ReaderSettings intentionally stops bubbling key events inside the dialog.
  onMounted(() => document.addEventListener("keydown", handler, true));
  onUnmounted(() => document.removeEventListener("keydown", handler, true));
}
