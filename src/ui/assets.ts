import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Loads the Web UI assets (`index.html`, `styles.css`, `app.js`).
 */
export async function loadUiAssets(): Promise<{ html: string; css: string; js: string }> {
  const uiDir = path.resolve(import.meta.dir);
  const [html, css, js] = await Promise.all([
    fs.readFile(path.join(uiDir, "index.html"), "utf8"),
    fs.readFile(path.join(uiDir, "styles.css"), "utf8"),
    fs.readFile(path.join(uiDir, "app.js"), "utf8"),
  ]);
  return { html, css, js };
}
