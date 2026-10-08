// happy-dom fires `selectionchange` synchronously inside each selection call
// and does not map editable selections faithfully. CodeMirror then re-enters
// its own update, or chases a selection that never settles. Tests set the
// editor's selection through the editor, so the DOM event carries nothing.
if (typeof document !== "undefined") {
  const dispatch = document.dispatchEvent.bind(document);
  document.dispatchEvent = (event: Event) => event.type === "selectionchange" || dispatch(event);
}
