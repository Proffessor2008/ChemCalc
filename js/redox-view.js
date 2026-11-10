export function renderRedoxPanel(panel, steps, redox) {
  panel.hidden = true;
  steps.replaceChildren();
  if (!redox?.isRedox) return;
  for (const text of redox.summary) {
    const item = document.createElement('li');
    item.textContent = text;
    steps.append(item);
  }
  panel.hidden = false;
}
