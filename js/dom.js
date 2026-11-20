export function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function button(label, className = 'button secondary', type = 'button') {
  const node = element('button', className, label);
  node.type = type;
  return node;
}
