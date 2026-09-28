export const $ = (id) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node;
};

/** Creates an element; text always goes through textContent, never parsed as markup. */
export function el(tag, { className, text, attrs } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, value);
  for (const child of children) node.append(child);
  return node;
}
