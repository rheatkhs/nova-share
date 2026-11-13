import htmlText from "./index.html" with { type: "text" };
import cssText from "./styles.css" with { type: "text" };
import jsText from "./app.js" with { type: "text" };

/**
 * Returns embedded Web UI assets (works both via `bun run` and inside
 * standalone compiled executables created with `bun build --compile`).
 */
export async function loadUiAssets(): Promise<{ html: string; css: string; js: string }> {
  return {
    html: String(htmlText),
    css: String(cssText),
    js: String(jsText),
  };
}
