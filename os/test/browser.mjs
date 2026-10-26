// Chromium for the browser tests: the cloud image's preinstalled Playwright,
// or else the `playwright` package with the installed Google Chrome
// (npm i --no-save playwright), so the tests also run on Windows and macOS.
let pw, local = false;
try { pw = await import("/opt/node22/lib/node_modules/playwright/index.mjs"); }
catch { pw = await import("playwright"); local = true; }

export const chromium = { launch: (opts = {}) => pw.chromium.launch(local ? { channel: "chrome", ...opts } : opts) };
