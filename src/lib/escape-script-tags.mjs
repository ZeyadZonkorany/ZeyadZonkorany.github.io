import { defineMdastPlugin } from 'satteri';

/** Keep literal script tags visible as text and defer remote article images. */
export default defineMdastPlugin({
  name: 'escape-script-tags',
  html(node, context) {
    if (/<\/?script\b/i.test(node.value)) {
      context.replaceNode(node, { type: 'text', value: node.value });
    } else if (/^<img\b/i.test(node.value) && !/\bloading=/i.test(node.value)) {
      context.setProperty(node, 'value', node.value.replace(/^<img\b/i, '<img loading="lazy" decoding="async"'));
    }
  },
});
