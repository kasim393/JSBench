import * as prettier from "prettier/standalone";
import * as babelPlugin from "prettier/plugins/babel";
import * as estreePlugin from "prettier/plugins/estree";

// Format JavaScript source with Prettier, entirely inside the webview.
// Uses the standalone build (babel + estree plugins) so no Node process or
// external tooling is required. Prettier 3's format() is async.
// Rejects on a syntax error — callers decide whether to fall back to the
// raw buffer (save) or report the failure (manual format).
export async function formatJs(code) {
  return prettier.format(code, {
    parser: "babel",
    plugins: [babelPlugin, estreePlugin],
    // Match the editor: CodeMirror indents with two spaces (indentUnit "  ")
    tabWidth: 2,
    useTabs: false,
  });
}
