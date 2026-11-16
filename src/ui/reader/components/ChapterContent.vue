<template>
  <div ref="host" class="chapter-content-host" :data-custom-font="fontFamily !== 'default'" :data-appearance="isDark ? 'dark' : 'light'" :style="{ '--chapter-font-size': `${fontSize}px`, '--chapter-font-weight': fontWeight, '--chapter-font-family': fontFamily === 'default' ? null : fontFamily }"></div>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue';
import DOMPurify from 'dompurify';
import { useTheme } from '../../../composables/useTheme.js';
import chapterStyles from '../styles/shadow-content.css?inline';

const { isDark } = useTheme();

const props = defineProps({
  bookStyles: { type: String, default: '' },
  contentHtml: { type: String, default: '' },
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

  // EPUB markup is untrusted. Shadow DOM isolates styles, not script execution.
  const safeContent = DOMPurify.sanitize(props.contentHtml || '', {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: [
      'script', 'iframe', 'object', 'embed', 'form', 'input',
      'button', 'textarea', 'select', 'option', 'meta', 'base',
      'link', 'frame', 'frameset', 'foreignObject'
    ],
    FORBID_ATTR: ['srcdoc', 'formaction']
  });

  // Only copy stylesheet text, never book-supplied HTML nodes.
  // Extension CSP blocks remote CSS, image, font and media loading.
  const bookCssDocument = new DOMParser().parseFromString(
    props.bookStyles || '', 'text/html'
  );
  const bookStyleNodes = Array.from(bookCssDocument.querySelectorAll('style'))
    .map(node => {
      const stylesheet = document.createElement('style');
      stylesheet.textContent = node.textContent || '';
      return stylesheet;
    });

  const defaultStyle = document.createElement('style');
  defaultStyle.textContent = chapterStyles;
  const content = document.createElement('div');
  content.className = 'chapter-content';
  content.appendChild(safeContent);

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
