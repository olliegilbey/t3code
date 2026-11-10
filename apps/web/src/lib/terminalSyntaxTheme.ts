import { createCSSVariablesTheme, registerCustomTheme } from "@pierre/diffs";

/** Terminal mode's code theme. Tokens read `--t3-syntax-*`, which terminal-mode.css maps to the active T3 theme. */
export const TERMINAL_SYNTAX_THEME_NAME = "t3-terminal";

// The stock CSS-variables theme folds these into a few shared colors. Split them,
// so a theme that colors types or operators apart keeps its look.
const SPLIT_SYNTAX = {
  operator: "token-operator",
  number: "token-number",
  boolean: "token-boolean",
  "string.escape": "token-string-escape",
  property: "token-property",
  "property.json_key": "token-property",
  variable: "token-variable",
  "variable.special": "token-variable-special",
  type: "token-type",
  enum: "token-type",
  namespace: "token-namespace",
  attribute: "token-attribute",
  tag: "token-tag",
};

const base = createCSSVariablesTheme({
  name: TERMINAL_SYNTAX_THEME_NAME,
  variablePrefix: "--t3-syntax-",
});
const theme = base.zed
  ? {
      ...base,
      zed: {
        ...base.zed,
        style: { ...base.zed.style, syntax: { ...base.zed.style.syntax, ...SPLIT_SYNTAX } },
      },
    }
  : base;

// Themes resolve on the main thread and reach the diff workers already resolved.
registerCustomTheme(TERMINAL_SYNTAX_THEME_NAME, () => Promise.resolve(theme), "diffs");
