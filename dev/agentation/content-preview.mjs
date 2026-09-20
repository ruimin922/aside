// Adapt event ownership only in the local annotation preview. Release content.js is unchanged.
export function prepareContentPreview(source) {
  const ownership = `
function previewFeedbackOwnsEvent(event) {
  const toolbar = document.querySelector('[data-agentation-toolbar]');
  if (toolbar && !toolbar.querySelector('[title="Start feedback mode"]')) return true;
  return event.composedPath().some(node => node instanceof Element && node.closest('[data-feedback-toolbar],[data-annotation-popup],[data-annotation-marker]'));
}
`;
  let output = source.replace('(() => {', '(() => {' + ownership)
    .replace('const host = location.hostname;', "const host = 'www.youtube.com';");
  const handlers = [
    '  const onDown = (e) => {',
    '  const onTopDown = (e) => {',
    '  const onClickOutside = (e) => {',
    '  const onGlobalEsc = (e) => {',
    'function onGlobalAltN(e) {',
    '  resizeHandle.addEventListener("mousedown", (e) => {',
    "      grip.addEventListener('pointerdown', e => {",
    "        handle.addEventListener('pointerdown', e => {",
    "document.addEventListener('keydown', e => {",
  ];
  for (const marker of handlers) {
    if (!output.includes(marker)) throw new Error(`Preview event adapter needs updating: ${marker}`);
    output = output.replace(marker, marker + '\n    if (previewFeedbackOwnsEvent(e)) return;');
  }
  return output;
}
