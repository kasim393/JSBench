import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { searchKeymap, highlightSelectionMatches, search } from "@codemirror/search";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { bracketMatching, indentOnInput, indentUnit } from "@codemirror/language";

// Handlers shared by every tab's state; set once via setHandlers()
const handlers = { onRun: null, onSave: null, onChange: null };

export function setHandlers(h) {
  Object.assign(handlers, h);
}

export function baseExtensions() {
  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged && handlers.onChange) handlers.onChange();
  });
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    drawSelection(),
    history(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightSelectionMatches(),
    autocompletion(),
    indentUnit.of("  "),
    javascript(),
    oneDark,
    search({ top: true }),
    keymap.of([
      { key: "Ctrl-Enter", run: () => { handlers.onRun?.(); return true; } },
      { key: "Ctrl-s", run: () => { handlers.onSave?.(); return true; } },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...completionKeymap,
    ]),
    updateListener,
  ];
}

export function createEditor(parent, { onRun, onSave, onChange }) {
  setHandlers({ onRun, onSave, onChange });
  const state = EditorState.create({
    doc: "",
    extensions: baseExtensions(),
  });
  return new EditorView({ state, parent });
}
