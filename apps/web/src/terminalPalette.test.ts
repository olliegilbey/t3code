import { describe, expect, it } from "vite-plus/test";

import { extractTerminalPalette, sanitizeTokenColors } from "./terminalPalette";

describe("extractTerminalPalette", () => {
  it("reads ANSI colors and resolves syntax slots by the most specific scope", () => {
    const palette = extractTerminalPalette({
      colors: {
        "terminal.ansiRed": "#C34043",
        "terminal.ansiBrightGreen": "#98BB6C",
        "terminal.ansiBlue": "not a color",
      },
      tokenColors: [
        { settings: { foreground: "#DCD7BA" } },
        { scope: "comment", settings: { foreground: "#727169", fontStyle: "italic" } },
        { scope: ["keyword", "storage.type"], settings: { foreground: "#957FB8" } },
        { scope: "keyword.control", settings: { foreground: "#E46876" } },
        { scope: "keyword", settings: { foreground: "#000000" } },
        { scope: "string, markup.inline.raw", settings: { foreground: "#98BB6C" } },
        { scope: "source.ts entity.name.function", settings: { foreground: "#111111" } },
        { scope: "entity.name.function", settings: { foreground: "#7E9CD8" } },
        { scope: "constant", settings: { foreground: "#D27E99" } },
        { scope: "keyword.operator", settings: { foreground: "#C0A36E" } },
        { scope: "entity.name.type", settings: { foreground: "#7AA89F" } },
      ],
    });

    expect(palette).toEqual({
      ansi: { red: "#C34043", "bright-green": "#98BB6C" },
      syntax: {
        comment: "#727169",
        "string-expression": "#98BB6C",
        string: "#98BB6C",
        "string-escape": "#D27E99",
        keyword: "#E46876",
        operator: "#C0A36E",
        number: "#D27E99",
        boolean: "#D27E99",
        constant: "#D27E99",
        function: "#7E9CD8",
        type: "#7AA89F",
        namespace: "#7AA89F",
      },
    });
  });

  it("returns null when a theme carries neither ANSI nor token colors", () => {
    expect(extractTerminalPalette({ colors: { "editor.background": "#1F1F28" } })).toBeNull();
  });
});

describe("sanitizeTokenColors", () => {
  it("drops rules without a scope or a hex foreground", () => {
    expect(
      sanitizeTokenColors([
        { scope: "comment", settings: { foreground: "#727169" } },
        { scope: "keyword", settings: { fontStyle: "bold" } },
        { settings: { foreground: "#DCD7BA" } },
        { scope: [42, "string"], settings: { foreground: "url(evil)" } },
      ]),
    ).toEqual([{ scope: "comment", settings: { foreground: "#727169" } }]);
  });
});
