// Format JavaScript source with Prettier, entirely inside the webview.
// Uses the standalone build (babel + estree plugins) so no Node process or
// external tooling is required. Prettier 3's format() is async.
//
// The Prettier sources (~600 kB, ~130 kB brotli) are the largest single
// dependency. They ship inside the app either way, but loading them on demand
// via dynamic import() and caching after first use keeps them out of the
// startup bundle, so they are only parsed once formatting is first needed.
let prettierBundle = null;

function loadPrettier() {
  if (!prettierBundle) {
    prettierBundle = Promise.all([
      import("prettier/standalone"),
      import("prettier/plugins/babel"),
      import("prettier/plugins/estree"),
    ]).then(([prettier, babelPlugin, estreePlugin]) => ({
      prettier,
      plugins: [babelPlugin, estreePlugin],
    }));
  }
  return prettierBundle;
}

// Rejects on a syntax error — callers decide whether to fall back to the
// raw buffer (save) or report the failure (manual format).
export async function formatJs(code) {
  const { prettier, plugins } = await loadPrettier();
  return prettier.format(code, {
    parser: "babel",
    plugins,
    // Match the editor: CodeMirror indents with two spaces (indentUnit "  ")
    tabWidth: 2,
    useTabs: false,
  });
}
