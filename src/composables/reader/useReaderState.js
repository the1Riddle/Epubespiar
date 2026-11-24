import { ref, shallowRef, computed } from "vue";
import { useReaderSettings } from "./useReaderSettings.js";

export function useReaderState() {
  const sidebarOpen = ref(false);
  const currentPage = ref(0);
  const totalPages = ref(100);
  const preferences = useReaderSettings();
  const { zoomLevel, fontSize } = preferences;

  const bookContent = ref(null);
  const tableOfContents = ref([]);
  const chapters = ref([]);
  const spineItems = ref([]);
  const currentChapter = ref(null);
  const openBookFile = shallowRef(null);
  const currentEpubUrl = ref(null);
  const onlineLoadError = ref("");
  const currentBookKey = ref(null);

  const isDragging = ref(false);
  const isLoadingBook = ref(false);
  const loadingTitle = ref("Loading Book");
  const loadingMessage = ref("Please wait while we prepare your book...");
  const loadingSubtitle = ref("This may take a moment");
  const showLoadingProgress = ref(false);
  const loadingProgress = ref(0);

  const createdObjectUrls = new Set();
  const isBookLoaded = computed(() => chapters.value.length > 0);

  const registerObjectUrl = (url) => {
    createdObjectUrls.add(url);
    return url;
  };

  const createTrackedObjectUrl = (blob) =>
    registerObjectUrl(URL.createObjectURL(blob));

  // Only object URLs created by our ZIP extractor can be kept by the
  // EPUB HTML sanitizer. A string supplied by the book is never trusted.
  const isTrustedObjectUrl = (url) => createdObjectUrls.has(url);

  const cleanupObjectUrls = () => {
    createdObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    createdObjectUrls.clear();
  };

  const resetReaderState = () => {
    cleanupObjectUrls();
    openBookFile.value = null;
    chapters.value = [];
    tableOfContents.value = [];
    spineItems.value = [];
    currentChapter.value = null;
    currentPage.value = 0;
    currentBookKey.value = null;
  };

  return {
    ...preferences,
    sidebarOpen,
    currentPage,
    totalPages,
    zoomLevel,
    fontSize,
    bookContent,
    tableOfContents,
    chapters,
    spineItems,
    currentChapter,
    openBookFile,
    currentEpubUrl,
    onlineLoadError,
    currentBookKey,
    isDragging,
    isLoadingBook,
    loadingTitle,
    loadingMessage,
    loadingSubtitle,
    showLoadingProgress,
    loadingProgress,
    isBookLoaded,
    createTrackedObjectUrl,
    registerObjectUrl,
    isTrustedObjectUrl,
    cleanupObjectUrls,
    resetReaderState,
  };
}
