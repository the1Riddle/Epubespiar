<template>
  <div ref="host" class="chapter-content-host" :data-custom-font="fontFamily !== 'default'" :data-appearance="isDark ? 'dark' : 'light'" :style="{ '--chapter-font-size': `${fontSize}px`, '--chapter-font-weight': fontWeight, '--chapter-font-family': fontFamily === 'default' ? null : fontFamily }"></div>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue';
import { renderChapter } from '../../../services/epubProcesor/renderChapter.js';
import { useTheme } from '../../../composables/useTheme.js';
import chapterStyles from '../styles/shadow-content.css?inline';

const { isDark } = useTheme();

const props = defineProps({
  bookStyles: { type: Array, default: () => [] },
  contentHtml: { type: String, default: '' },
  isTrustedObjectUrl: { type: Function, default: () => false },
  fontSize: { type: Number, default: 16 },
  fontWeight: { type: String, default: '400' },
  fontFamily: { type: String, default: 'default' }
});

const host = ref(null);
let shadowRootRef = null;
const renderShadowContent = () => {
  if (!host.value) return;
  if (!shadowRootRef) {
    shadowRootRef = host.value.attachShadow({ mode: 'open' });
  }

  const content = renderChapter(props.contentHtml, props.isTrustedObjectUrl);
  const bookStyleNodes = props.bookStyles.map(({ css, media }) => {
    const style = document.createElement('style');
    style.textContent = css;
    if (media) style.media = media;
    return style;
  });

  const defaultStyle = document.createElement('style');
  defaultStyle.textContent = chapterStyles;
  shadowRootRef.replaceChildren(defaultStyle, ...bookStyleNodes, content);
};

onMounted(renderShadowContent);

watch(
  () => [props.bookStyles, props.contentHtml],
  () => {
    renderShadowContent();
  }
);
</script>

<style scoped>
.chapter-content-host {
  display: block;
}
</style>
