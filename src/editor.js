import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { searchKeymap, highlightSelectionMatches, search } from "@codemirror/search";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { bracketMatching, indentOnInput, indentUnit, syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// Handlers shared by every tab's state; set once via setHandlers()
const handlers = { onRun: null, onSave: null, onChange: null, onCursor: null };

export function setHandlers(h) {
  Object.assign(handlers, h);
}

// ---------------------------------------------------------------------------
// Theme + wrap compartments
// ---------------------------------------------------------------------------
// Both the editor theme and word wrap are swapped at runtime through
// compartments. A Compartment instance is shared safely across every tab's
// stored EditorState, so a single reconfigure updates all of them.
export const themeCompartment = new Compartment();
export const wrapCompartment = new Compartment();
let themeName = "dark";
let wrapEnabled = false;

export function setThemeName(name) {
  themeName = name === "light" ? "light" : "dark";
}

export function setWrapEnabled(v) {
  wrapEnabled = !!v;
}

// "dark" => Aether, "light" => CodeMirror's default light style
export function themeExtension(name = themeName) {
  return name === "light" ? syntaxHighlighting(defaultHighlightStyle) : aetherDark();
}

// word wrap: EditorView.lineWrapping when on, otherwise an empty extension
export function wrapExtension(v = wrapEnabled) {
  return v ? EditorView.lineWrapping : [];
}

// ---------- Aether (dark) — navy surface · synthwave syntax · violet accent ----------
const AE = {
  bg: "#0e1326",     // editor surface
  bgDark: "#0a0f20", // gutters / panels
  highlight: "#161d38",
  fg: "#e7ecff",
  fgDim: "#7c8db5",
  comment: "#506796",
  violet: "#906bff", // accent
  pink: "#ff7ac6",   // keywords
  cyan: "#6ee7ff",   // functions / operators
  green: "#5af7a8",  // types
  yellow: "#f4f99b", // strings
  purple: "#c79aff", // numbers
  red: "#ff6b81",
  operator: "#89ddff",
  selection: "#2a2f55",
  border: "#1c2444",
  gutter: "#4a5480",
};

const aetherHighlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: AE.comment, fontStyle: "italic" },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword], color: AE.pink },
  { tag: [t.name, t.variableName, t.definition(t.variableName), t.definition(t.propertyName)], color: AE.fg },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: AE.cyan },
  { tag: [t.standard(t.variableName)], color: AE.cyan },
  { tag: [t.constant(t.variableName), t.definition(t.constant(t.variableName))], color: AE.purple },
  { tag: [t.propertyName], color: AE.cyan },
  { tag: [t.className, t.typeName, t.namespace, t.macroName], color: AE.green },
  { tag: [t.tagName], color: AE.pink },
  { tag: [t.attributeName], color: AE.purple },
  { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom], color: AE.purple },
  { tag: [t.string, t.character, t.special(t.string)], color: AE.yellow },
  { tag: [t.regexp, t.escape], color: AE.green },
  { tag: [t.operator, t.controlOperator, t.definitionOperator, t.typeOperator], color: AE.operator },
  { tag: [t.punctuation, t.separator, t.bracket, t.brace, t.paren, t.squareBracket, t.angleBracket], color: AE.fgDim },
  { tag: [t.self, t.meta, t.documentMeta, t.annotation, t.processingInstruction], color: AE.pink },
  { tag: [t.invalid], color: AE.red },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.strong], fontWeight: "bold" },
  { tag: [t.strikethrough], textDecoration: "line-through" },
]);

const aetherBase = EditorView.theme(
  {
    "&": { color: AE.fg, backgroundColor: AE.bg },
    "&.cm-focused": { outline: "none" },
    ".cm-content": { caretColor: AE.violet },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: AE.violet },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: AE.selection },
    ".cm-activeLine": { backgroundColor: AE.highlight },
    ".cm-gutters": { backgroundColor: AE.bgDark, color: AE.gutter, border: "none" },
    ".cm-activeLineGutter": { backgroundColor: AE.highlight, color: AE.fgDim },
    ".cm-selectionMatch": { backgroundColor: "rgba(144, 107, 255, 0.18)" },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
      backgroundColor: "rgba(144, 107, 255, 0.22)",
      outline: "1px solid " + AE.violet,
    },
    ".cm-nonmatchingBracket": { color: AE.red },
    ".cm-tooltip": { backgroundColor: AE.bgDark, border: "1px solid " + AE.border, color: AE.fg },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: AE.selection, color: AE.fg },
    ".cm-panels": { backgroundColor: AE.bgDark, color: AE.fg },
  },
  { dark: true }
);

function aetherDark() {
  return [aetherBase, syntaxHighlighting(aetherHighlight)];
}

export function baseExtensions() {
  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged && handlers.onChange) handlers.onChange();
    if ((update.selectionSet || update.docChanged || update.focusChanged) && handlers.onCursor) handlers.onCursor(update);
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
    themeCompartment.of(themeExtension()),
    wrapCompartment.of(wrapExtension()),
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

export function createEditor(parent, { onRun, onSave, onChange, onCursor }) {
  setHandlers({ onRun, onSave, onChange, onCursor });
  const state = EditorState.create({
    doc: "",
    extensions: baseExtensions(),
  });
  return new EditorView({ state, parent });
}
