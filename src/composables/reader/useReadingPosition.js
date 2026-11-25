import { getPosition, savePosition } from "../../services/library/bookData.js";

export function useReadingPosition({
  currentBookKey,
  currentChapter,
  chapters,
  getScrollElement,
}) {
  let persistTimer = null;
  const persistReadingPosition = () => {
    if (!currentBookKey.value) return;
    const element = getScrollElement();
    if (!element) return;
    const maxScroll = Math.max(element.scrollHeight - element.clientHeight, 1);
    savePosition(currentBookKey.value, {
      scrollPercentage: Math.min(100, Math.max(0, (element.scrollTop / maxScroll) * 100)),
      chapterHref: currentChapter.value,
      timestamp: Date.now(),
    }).catch(error => console.error("Failed to save reading position", error));
  };

  const schedulePersistReadingPosition = () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistReadingPosition, 700);
  };

  const restoreReadingPosition = async (metadata) => {
    if (!currentBookKey.value || !chapters.value.length) return;
    const bookId = currentBookKey.value;
    const saved = await getPosition(bookId, metadata);
    if (currentBookKey.value !== bookId) return;
    if (!saved || typeof saved.scrollPercentage !== "number") return;
    setTimeout(() => {
      if (currentBookKey.value !== bookId) return;
      const element = getScrollElement();
      if (!element) return;
      const maxScroll = Math.max(
        element.scrollHeight - element.clientHeight,
        0,
      );
      element.scrollTop =
        (Math.min(100, Math.max(0, saved.scrollPercentage)) / 100) * maxScroll;
    }, 50);
    if (saved.chapterHref) currentChapter.value = saved.chapterHref;
  };

  const dispose = () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = null;
    persistReadingPosition();
  };
  return {
    persistReadingPosition,
    schedulePersistReadingPosition,
    restoreReadingPosition,
    dispose,
  };
}
