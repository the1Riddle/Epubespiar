<template>
  <loading-page
    v-if="isLoadingBook"
    :title="loadingTitle"
    :message="loadingMessage"
    :subtitle="loadingSubtitle"
    :showProgress="showLoadingProgress"
    :progress="loadingProgress"
  />

  <div
    v-else
    class="epub-reader"
    @dragover.prevent="handleDragEnter"
    @dragenter.prevent="handleDragEnter"
    @dragleave.prevent="handleDragLeave"
    @drop.prevent="handleDrop"
  >
    <header-toolbar
      ref="headerToolbar"
      :currentPage="currentPage"
      :totalPages="totalPages"
      :isBookLoaded="isBookLoaded"
      :fontSize="fontSize"
      :zoomLevel="zoomLevel"
      :showInlineControls="showInlineControls"
      :currentChapterTitle="currentChapterTitle"
      @toggle-settings="toggleSettings"
      :epubUrl="currentEpubUrl"
      @toggle-bookshelf="toggleBookshelf"
      @toggle-sidebar="toggleSidebar"
      @scroll-up="scrollUp"
      @scroll-down="scrollDown"
      @zoom-in="zoomIn"
      @zoom-out="zoomOut"
      @zoom-change="changeZoom"
      @font-size-change="changeFontSize"
      @file-selected="loadEpub"
      @toggle-fullscreen="toggleFullscreen"
      @download-epub="downloadEpub"
      :download-pending="downloadPending"
      :download-delayed="downloadDelayed"
    />

    <bookshelf-sidebar :isOpen="bookshelfOpen" :books="shelfBooks" :isBookLoaded="isBookLoaded" @close="bookshelfOpen = false" @file-upload="file => loadEpub(file)" @book-select="openShelfBook" @book-deleted="refreshShelf" />
    <div class="main-content">
      <div
        v-if="sidebarOpen"
        class="sidebar-backdrop"
        @click="toggleSidebar"
      ></div>

      <sidebar-component
        :isOpen="sidebarOpen"
        :toc="tableOfContents"
        :currentChapter="currentChapter"
        @navigate="navigateToLocation"
        @close-book="handleCloseBook"
      />

      <epub-renderer
        ref="bookContent"
        :isLoading="false"
        :isBookLoaded="isBookLoaded"
        :zoomLevel="zoomLevel"
        :fontSize="fontSize"
        :fontWeight="fontWeight"
        :fontFamily="fontFamily"
        :chapters="chapters"
        :is-trusted-object-url="isTrustedObjectUrl"
        @content-scroll="handleContentScroll"
        @navigate-internal="handleInternalNavigation"
      />
    </div>
    <reader-settings v-if="settingsOpen && isBookLoaded" @close="settingsOpen = false"
      v-model:fontSize="fontSize" v-model:zoomLevel="zoomLevel"
      v-model:fontWeight="fontWeight" v-model:fontFamily="fontFamily"
      v-model:showInlineControls="showInlineControls" />
  </div>
</template>

<script>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import BookshelfSidebar from './components/BookshelfSidebar.vue';
import useBookStorage from '../../composables/useBookStorage.js';
import HeaderToolbar from './components/HeaderToolbar.vue';
import SidebarComponent from './components/SidebarComponent.vue';
import EpubRenderer from './components/EpubRenderer.vue';
import LoadingPage from './components/LoadingPage.vue';
import ReaderSettings from './components/ReaderSettings.vue';
import useNotification from '../../composables/useNotification.js';
import { useBookLoader } from '../../composables/reader/useBookLoader.js';
import { useReaderInteractions } from '../../composables/reader/useReaderInteractions.js';
import { useReaderNavigation } from '../../composables/reader/useReaderNavigation.js';
import { useReadingPosition } from '../../composables/reader/useReadingPosition.js';
import { useReaderState } from '../../composables/reader/useReaderState.js';
import { readerDefaults, readerLimits } from '../../composables/reader/useReaderSettings.js';
import { isReaderTypingEvent, useReaderShortcuts } from '../../composables/reader/useReaderShortcuts.js';
import { downloadEpub as downloadEpubFile } from '../../services/epubProcesor/downloadEpub.js';

export default {
  components: {
    BookshelfSidebar, HeaderToolbar,
    SidebarComponent,
    EpubRenderer,
    LoadingPage, ReaderSettings
  },
  setup() {
    const { addNotification } = useNotification();
    const readerState = useReaderState();
    const settingsOpen = ref(false);
    const headerToolbar = ref(null);
    const downloadPending = ref(false);
    const downloadDelayed = ref(false);
    let downloadDelayTimer = null;
    const {
      sidebarOpen, currentPage, totalPages, zoomLevel,
      fontSize, fontWeight, fontFamily, showInlineControls, settingsReady, bookContent, tableOfContents,
      chapters, spineItems, currentChapter, currentEpubUrl,
      currentBookKey, isDragging, isLoadingBook,
      loadingTitle, loadingMessage, loadingSubtitle,
      showLoadingProgress, loadingProgress, isBookLoaded,
      registerObjectUrl, isTrustedObjectUrl, cleanupObjectUrls, resetReaderState
    } = readerState;

    const currentChapterTitle = computed(() => {
      const href = currentChapter.value?.split('#')[0];
      return chapters.value.find(chapter => chapter.href.split('#')[0] === href)?.title || '';
    });

    const navigation = useReaderNavigation({
      bookContent,
      chapters,
      currentChapter,
      sidebarOpen
    });

    const readingPosition = useReadingPosition({
      currentBookKey,
      currentChapter,
      chapters,
      getScrollElement: navigation.getScrollElement
    });

    const bookshelfOpen = ref(false);
    const shelfBooks = ref([]);
    const storage = useBookStorage();
    const refreshShelf = async () => {
      try { shelfBooks.value = await storage.getAllBooks(); }
      catch { addNotification({message:'Could not load library', type:'error'}); }
    };
    const toggleBookshelf = () => {
      bookshelfOpen.value = !bookshelfOpen.value;
      if (bookshelfOpen.value) {
        sidebarOpen.value = false;
        refreshShelf();
      }
    };
    const openShelfBook = async book => {
      try {
        const saved = await storage.getBook(book.id);
        if (!saved?.file) throw new Error('Missing book');
        await loader.loadEpub(new File([saved.file], saved.file.name || 'book.epub', {type:'application/epub+zip'}), false, book.id);
      } catch { addNotification({message:'Could not open saved book', type:'error'}); }
    };
    const loader = useBookLoader({
      onSaved: refreshShelf,
      onOpened: () => { bookshelfOpen.value = false; },
      persistReadingPosition: readingPosition.persistReadingPosition,
      refs: {
        isLoadingBook, loadingTitle, loadingMessage,
        loadingSubtitle, showLoadingProgress, currentEpubUrl,
        currentBookKey, chapters, tableOfContents,
        currentChapter, spineItems
      },
      addNotification,
      resetReaderState,
      registerObjectUrl,
      restoreReadingPosition: readingPosition.restoreReadingPosition
    });

    const interactions = useReaderInteractions({
      loadEpub: loader.loadEpub,
      addNotification,
      schedulePersistReadingPosition: readingPosition.schedulePersistReadingPosition,
      chapters,
      currentChapter,
      currentPage,
      isDragging
    });

    const toggleSidebar = () => {
      sidebarOpen.value = !sidebarOpen.value;
      if (sidebarOpen.value) bookshelfOpen.value = false;
    };

    const toggleSettings = () => {
      settingsOpen.value = !settingsOpen.value;
    };

    const handleCloseBook = () => {
      settingsOpen.value = false;
      readingPosition.dispose();
      resetReaderState();
      bookshelfOpen.value = true;
      refreshShelf();
      currentEpubUrl.value = null;
      sidebarOpen.value = false;
      
      const homeUrl = `${window.location.pathname}${window.location.hash || ''}`;
      window.history.replaceState({}, '', homeUrl);
    };

    const zoomIn = () => {
      zoomLevel.value = Math.min(Number((zoomLevel.value + readerLimits.zoomLevel.step).toFixed(2)), readerLimits.zoomLevel.max);
    };

    const zoomOut = () => {
      zoomLevel.value = Math.max(Number((zoomLevel.value - readerLimits.zoomLevel.step).toFixed(2)), readerLimits.zoomLevel.min);
    };

    const changeZoom = (value) => {
      zoomLevel.value = value === 'auto' ? 1 : parseInt(value, 10) / 100;
    };

    const changeFontSize = (value) => {
      fontSize.value = parseInt(value, 10);
    };

    const toggleFullscreen = () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    };

    const downloadEpub = async () => {
      if (downloadPending.value) return;
      const url = currentEpubUrl.value;
      if (!url) {
        addNotification({ message: 'No EPUB URL available for download', type: 'error' });
        return;
      }

      downloadPending.value = true;
      downloadDelayed.value = false;
      // Do not animate the normal, near-instant browser handoff.
      downloadDelayTimer = setTimeout(() => {
        if (downloadPending.value) downloadDelayed.value = true;
      }, 3000);
      try {
        const result = await downloadEpubFile(url);
        if (result.status === 'waiting') {
          addNotification({
            message: 'The browser accepted the download but is still waiting for data. Check Downloads for its status.',
            type: 'info',
            timeout: 9000,
          });
        } else {
          addNotification({
            message: 'EPUB download started in your browser.',
            type: 'success',
          });
        }
      } catch (error) {
        console.error('Browser EPUB download failed:', error);
        addNotification({
          message: `EPUB download failed: ${error?.message || 'network error'}`,
          type: 'error',
          timeout: 8000,
        });
      } finally {
        clearTimeout(downloadDelayTimer);
        downloadDelayTimer = null;
        downloadPending.value = false;
        downloadDelayed.value = false;
      }
    };

    // Include legacy library overlays as well as native/accessible dialogs.
    const shortcutsBlocked = binding => {
      // Esc must never dismiss reader panels; it only exits fullscreen.
      if (binding?.action === 'exitFullscreen') return false;
      if (isLoadingBook.value) return true;
      // Repeating Ctrl+F9 must work from inside the settings dialog.
      if (settingsOpen.value) return binding?.action !== 'openSettings';
      // Nested collection dialogs still protect their form shortcuts.
      return !!document.querySelector(
        'dialog[open], [role="dialog"], [role="alertdialog"], .dialog-overlay'
      );
    };
    const canAdjustBook = () => isBookLoaded.value && !bookshelfOpen.value;
    const adjustFont = direction => {
      const { min, max, step } = readerLimits.fontSize;
      fontSize.value = Math.max(min, Math.min(max, fontSize.value + direction * step));
    };
    useReaderShortcuts({
      isBlocked: shortcutsBlocked,
      hasSelection: event => {
        const roots = (event.composedPath?.() || []).map(element => element?.getRootNode?.());
        return [document, ...roots].some(root => root?.getSelection?.()?.toString().length > 0);
      },
      actions: {
        openSettings: {
          enabled: () => isBookLoaded.value && !bookshelfOpen.value,
          allowWhenTyping: () => settingsOpen.value,
          run: toggleSettings
        },
        openToc: {
          enabled: () => isBookLoaded.value,
          allowWhenTyping: () => sidebarOpen.value,
          run: toggleSidebar
        },
        openLibrary: {
          allowWhenTyping: () => bookshelfOpen.value,
          run: toggleBookshelf
        },
        openBook: { enabled: () => !!headerToolbar.value, run: () => headerToolbar.value.openFilePicker() },
        closeBook: { enabled: () => isBookLoaded.value, run: handleCloseBook },
        zoomOut: { enabled: canAdjustBook, run: zoomOut },
        zoomIn: { enabled: canAdjustBook, run: zoomIn },
        resetZoom: { enabled: canAdjustBook, run: () => { zoomLevel.value = readerDefaults.zoomLevel; } },
        fontSmaller: { enabled: canAdjustBook, run: () => adjustFont(-1) },
        fontLarger: { enabled: canAdjustBook, run: () => adjustFont(1) },
        resetFont: { enabled: canAdjustBook, run: () => { fontSize.value = readerDefaults.fontSize; } },
        exitFullscreen: {
          enabled: () => !!document.fullscreenElement,
          allowWhenTyping: true,
          run: () => document.exitFullscreen()
        },
      },
    });

    const handleKeyUp = (event) => {
      if (shortcutsBlocked() || bookshelfOpen.value || isReaderTypingEvent(event)
        || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
      if (event.key === 'ArrowLeft') navigation.scrollUp();
      if (event.key === 'ArrowRight') navigation.scrollDown();
    };

    let touchStartX = 0;
    let touchStartY = 0;

    const handleTouchStart = (event) => {
      if (settingsOpen.value) return;
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
    };

    const handleTouchEnd = (event) => {
      if (settingsOpen.value) return;
      const deltaX = event.changedTouches[0].clientX - touchStartX;
      const deltaY = event.changedTouches[0].clientY - touchStartY;
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
        if (deltaX > 0) navigation.scrollUp();
        else navigation.scrollDown();
      }
    };

    onMounted(() => {
      document.addEventListener('keyup', handleKeyUp);
      window.addEventListener('touchstart', handleTouchStart, { passive: true });
      window.addEventListener('touchend', handleTouchEnd, { passive: true });
      refreshShelf();
      bookshelfOpen.value = !new URLSearchParams(window.location.search).has('file')
        && localStorage.getItem('reader-has-imported') === 'true';
      settingsReady.then(() => loader.loadBookFromUrl());
    });
    onUnmounted(() => {
      document.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
      readingPosition.dispose();
      clearTimeout(downloadDelayTimer);
      cleanupObjectUrls();
    });

    return {
      headerToolbar,
      bookshelfOpen, shelfBooks, toggleBookshelf, toggleSettings, openShelfBook, refreshShelf,
      sidebarOpen, currentPage, totalPages,
      settingsOpen, fontWeight, fontFamily, showInlineControls, currentChapterTitle,
      zoomLevel, fontSize, bookContent, tableOfContents,
      currentChapter, chapters, currentEpubUrl,
      isTrustedObjectUrl,
      isLoadingBook, loadingTitle, loadingMessage,
      loadingSubtitle, showLoadingProgress,
      loadingProgress, isBookLoaded, toggleSidebar,
      scrollUp: navigation.scrollUp,
      scrollDown: navigation.scrollDown,
      zoomIn, zoomOut,
      changeZoom, changeFontSize,
      loadEpub: loader.loadEpub, handleCloseBook,
      navigateToLocation: navigation.navigateToLocation,
      handleInternalNavigation: navigation.handleInternalNavigation,
      handleContentScroll: interactions.handleContentScroll,
      handleDragEnter: interactions.handleDragEnter,
      handleDragLeave: interactions.handleDragLeave,
      handleDrop: interactions.handleDrop,
      toggleFullscreen, downloadEpub, downloadPending, downloadDelayed, isDragging, spineItems
    };
  }
};
</script>

<style scoped>
.epub-reader {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  overflow: hidden;
}

.main-content {
  display: flex;
  flex: 1;
  overflow: hidden;
  position: relative;
}

.sidebar-backdrop {
  position: fixed;
  top: 36px;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.2);
  z-index: 50;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@media print {
  .epub-reader, .main-content {
    display: block;
    height: auto;
    overflow: visible;
  }
  .main-content > :not(.epub-renderer), .epub-reader > :not(.main-content) {
    display: none;
  }
}
</style>
