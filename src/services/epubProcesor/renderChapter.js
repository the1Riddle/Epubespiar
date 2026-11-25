const svg = 'http://www.w3.org/2000/svg';
const blocked = ['form', 'input', 'button', 'textarea', 'select', 'option', 'meta',
  'base', 'link', 'frame', 'frameset', 'iframe', 'object', 'embed', 'script'];
let chapterSanitizer;

function nativeSanitizer() {
  if (chapterSanitizer) return chapterSanitizer;
  const sanitizer = new Sanitizer('default');
  sanitizer.removeAttribute('srcset');
  for (const name of blocked) sanitizer.removeElement(name);
  // IDs and classes support fragment navigation, author CSS and highlighted code.
  for (const name of ['id', 'class', 'style', 'name']) sanitizer.allowAttribute(name);
  sanitizer.allowElement({ name: 'img', attributes: ['src', 'alt', 'width', 'height', 'title'] });
  for (const name of ['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line',
    'polygon', 'polyline', 'text', 'tspan', 'defs', 'title', 'desc', 'image']) {
    sanitizer.allowElement({ name, namespace: svg, attributes: [
      'viewBox', 'preserveAspectRatio', 'width', 'height', 'x', 'y', 'x1', 'x2',
      'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'fill', 'stroke',
      'stroke-width', 'transform', ...(name === 'image' ? ['href'] : []),
    ] });
  }
  chapterSanitizer = sanitizer;
  return sanitizer;
}

function imageSource(node, attr) {
  return (node.localName === 'img' && attr === 'src') ||
    (node.localName === 'image' && (attr === 'href' || attr === 'xlink:href'));
}

export function renderChapter(html, isTrustedObjectUrl) {
  // An inert document keeps image requests dormant until URL checks finish.
  const content = document.createElement('template').content.ownerDocument.createElement('div');
  content.setHTML(html, { sanitizer: nativeSanitizer() });
  // The native sanitizer handles executable markup. The reader additionally
  // limits images to embedded data and URLs issued for the open book.
  for (const node of content.querySelectorAll('img, image')) {
    for (const attr of Array.from(node.attributes)) {
      if (imageSource(node, attr.name) && !isTrustedObjectUrl(attr.value) &&
          !/^data:image\//i.test(attr.value)) node.removeAttributeNode(attr);
    }
  }
  content.className = 'chapter-content';
  return content;
}
