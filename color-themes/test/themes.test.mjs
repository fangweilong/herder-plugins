import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const dir = new URL("../themes/", import.meta.url);
const hex = /^#[0-9a-f]{6}$/;

// Herdr derives the dark/light list from the background's luminance, so a
// bright background would move a theme out of the "dark" picker.
function luminance(value) {
  const channels = [1, 3, 5]
    .map((i) => parseInt(value.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

// The 16 ANSI colors each theme was derived from.
const expected = {
  "idea-new-ui.json": [
    // IntelliJ 2026 New UI Dark: BLOCK_TERMINAL_* in the Darcula scheme.
    "#000000", "#f27481", "#6bcc62", "#e0ce70", "#5594fa", "#c092fa",
    "#47ccbd", "#ced0d6", "#4e5157", "#ff6b7a", "#67ff59", "#ffec1a",
    "#3399ff", "#d970ff", "#40ffe9", "#ffffff",
  ],
  "opencode-black-gold.json": [
    // OpenCode's "opencode" theme: syntax colors, plus lightened brights.
    "#1e1e1e", "#e06c75", "#7fd88f", "#e5c07b", "#5c9cf5", "#9d7cd8",
    "#56b6c2", "#eeeeee", "#606060", "#ff8a93", "#a6f0b3", "#ffd38a",
    "#8ab4ff", "#c3a6ff", "#7fd6e0", "#ffffff",
  ],
};

const semantic = new Set([
  "background", "canvas", "chrome", "surface", "popover", "raised", "hover",
  "selected", "border", "input", "foreground", "muted", "dim", "accent",
  "accent_foreground", "solid", "solid_foreground", "selection", "ring",
  "working", "blocked", "done", "idle", "unknown",
  ...Array.from({ length: 16 }, (_, i) => `ansi${i}`),
]);

const files = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
assert.deepEqual(files, Object.keys(expected).sort(), "themes/ files");

for (const [file, ansi] of Object.entries(expected)) {
  const theme = JSON.parse(await readFile(new URL(file, dir), "utf8"));

  test(`${file}: terminal colors are six-digit hex`, () => {
    for (const key of ["background", "foreground", "selection", "cursor"]) {
      assert.match(theme[key], hex, key);
    }
    assert.equal(theme.ansi.length, 16);
    theme.ansi.forEach((value, i) => assert.match(value, hex, `ansi${i}`));
  });

  test(`${file}: ANSI palette matches its source theme`, () => {
    assert.deepEqual(theme.ansi, ansi);
  });

  test(`${file}: background is dark so the picker lists it under 深色`, () => {
    assert.ok(luminance(theme.background) < 0.2);
  });

  test(`${file}: semantic colors are valid and only override known roles`, () => {
    for (const [key, value] of Object.entries(theme.colors)) {
      assert.ok(semantic.has(key), `unknown theme color: ${key}`);
      assert.match(value, hex, key);
    }
    assert.equal(theme.colors.background, theme.background);
  });

  test(`${file}: terminal and UI text stay readable`, () => {
    assert.ok(contrast(theme.foreground, theme.background) >= 7);
    assert.ok(contrast(theme.colors.foreground, theme.colors.chrome) >= 7);
    assert.ok(contrast(theme.colors.muted, theme.colors.chrome) >= 3);
    assert.ok(contrast(theme.colors.accent_foreground, theme.colors.solid) >= 4);
  });
}