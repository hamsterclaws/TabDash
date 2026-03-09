const ALLOWED_TAGS = new Set([
  'p','br','b','strong','i','em','u','s','del',
  'h1','h2','h3','h4','h5','h6',
  'ul','ol','li','blockquote','pre','code',
  'a','span','div',
]);

const ALLOWED_ATTRS = {
  'a':    ['href', 'target', 'rel'],
  '*':    ['class', 'style'],
};

export function sanitize(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  sanitizeNode(doc.body);
  return doc.body.innerHTML;
}

function sanitizeNode(node) {
  const children = [...node.childNodes];
  for (const child of children) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType !== Node.ELEMENT_NODE) {
      child.remove();
      continue;
    }
    const tag = child.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      // Replace disallowed element with its children
      while (child.firstChild) node.insertBefore(child.firstChild, child);
      child.remove();
      continue;
    }
    // Strip disallowed attributes
    const allowed = [...(ALLOWED_ATTRS[tag] || []), ...(ALLOWED_ATTRS['*'] || [])];
    for (const attr of [...child.attributes]) {
      if (!allowed.includes(attr.name)) child.removeAttribute(attr.name);
    }
    // Force links to be safe
    if (tag === 'a') {
      child.setAttribute('target', '_blank');
      child.setAttribute('rel', 'noopener noreferrer');
      const href = child.getAttribute('href') || '';
      if (/^javascript:/i.test(href)) child.removeAttribute('href');
    }
    sanitizeNode(child);
  }
}
