import type { ThemeColors } from "@t3tools/shared/themePalettes";

const TERMINAL_PALETTES_STORAGE_KEY = "t3code:terminal-palettes:v1";
const MAX_STORED_PALETTES = 64;
const MAX_TOKEN_COLOR_RULES = 4_000;
const MAX_SCOPE_LENGTH = 512;

const ANSI_HUES = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;
const TERMINAL_ANSI_NAMES = [
  ...ANSI_HUES,
  ...ANSI_HUES.map((hue) => `bright-${hue}` as const),
] as const;
export type TerminalAnsiName = (typeof TERMINAL_ANSI_NAMES)[number];

// Slots match the token variables of lib/terminalSyntaxTheme.ts. Each lists the
// TextMate scopes a typical grammar emits for it, most representative first.
const SYNTAX_SLOT_SCOPES = {
  comment: ["comment.line.double-slash", "comment"],
  "string-expression": ["string.quoted.double", "string"],
  string: ["markup.inline.raw.string.markdown", "markup.inline.raw", "string.quoted.double"],
  "string-escape": ["constant.character.escape"],
  keyword: ["keyword.control", "storage.type", "keyword"],
  operator: ["keyword.operator"],
  number: ["constant.numeric"],
  boolean: ["constant.language.boolean", "constant.language"],
  constant: ["constant.other", "constant.language", "support.constant", "constant"],
  parameter: ["variable.parameter"],
  variable: ["variable.other.readwrite", "variable"],
  "variable-special": ["variable.language"],
  property: [
    "variable.other.property",
    "variable.other.object.property",
    "meta.object-literal.key",
  ],
  function: ["entity.name.function", "support.function"],
  type: ["entity.name.type", "entity.name.class", "support.type", "support.class"],
  namespace: ["entity.name.namespace", "entity.name.type.module"],
  attribute: ["entity.other.attribute-name"],
  tag: ["entity.name.tag"],
  punctuation: ["punctuation.separator", "punctuation"],
  link: ["markup.underline.link"],
  inserted: ["markup.inserted"],
  deleted: ["markup.deleted"],
} as const;
export type TerminalSyntaxSlot = keyof typeof SYNTAX_SLOT_SCOPES;
const SYNTAX_SLOTS = Object.keys(SYNTAX_SLOT_SCOPES) as TerminalSyntaxSlot[];

export type TerminalPalette = Readonly<{
  ansi: Readonly<Partial<Record<TerminalAnsiName, string>>>;
  syntax: Readonly<Partial<Record<TerminalSyntaxSlot, string>>>;
}>;

type TokenColorRule = { scope: string | string[]; settings: { foreground: string } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hexColor(value: unknown): string | null {
  return typeof value === "string" && /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)
    ? value
    : null;
}

function ansiColorKey(name: TerminalAnsiName): string {
  const bright = name.startsWith("bright-");
  const hue = bright ? name.slice("bright-".length) : name;
  return `terminal.ansi${bright ? "Bright" : ""}${hue[0]!.toUpperCase()}${hue.slice(1)}`;
}

const ANSI_COLOR_KEYS: ReadonlySet<string> = new Set(TERMINAL_ANSI_NAMES.map(ansiColorKey));

export function isTerminalAnsiColorKey(key: string): boolean {
  return ANSI_COLOR_KEYS.has(key);
}

/** Keeps only scoped foreground rules, so imports stay small and inert. */
export function sanitizeTokenColors(value: unknown): TokenColorRule[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rules: TokenColorRule[] = [];
  for (const rule of value.slice(0, MAX_TOKEN_COLOR_RULES)) {
    if (!isRecord(rule) || !isRecord(rule.settings)) continue;
    const foreground = hexColor(rule.settings.foreground);
    const scope =
      typeof rule.scope === "string"
        ? rule.scope.slice(0, MAX_SCOPE_LENGTH)
        : Array.isArray(rule.scope)
          ? rule.scope
              .filter((entry): entry is string => typeof entry === "string")
              .map((entry) => entry.slice(0, MAX_SCOPE_LENGTH))
          : null;
    if (foreground && scope && scope.length > 0) rules.push({ scope, settings: { foreground } });
  }
  return rules.length > 0 ? rules : undefined;
}

function scopeSelectors(scope: string | string[]): string[] {
  return (Array.isArray(scope) ? scope : [scope])
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** VS Code's rule: the longest matching selector wins, and later rules win ties. */
function resolveScopeColor(rules: ReadonlyArray<TokenColorRule>, target: string): string | null {
  let best: { color: string; depth: number } | null = null;
  for (const rule of rules) {
    for (const selector of scopeSelectors(rule.scope)) {
      // Descendant selectors need grammar context we do not have.
      if (selector.includes(" ")) continue;
      if (selector !== target && !target.startsWith(`${selector}.`)) continue;
      const depth = selector.split(".").length;
      if (!best || depth >= best.depth) best = { color: rule.settings.foreground, depth };
    }
  }
  return best?.color ?? null;
}

export function extractTerminalPalette(theme: unknown): TerminalPalette | null {
  if (!isRecord(theme)) return null;
  const colors = isRecord(theme.colors) ? theme.colors : {};
  const ansi: Partial<Record<TerminalAnsiName, string>> = {};
  for (const name of TERMINAL_ANSI_NAMES) {
    const color = hexColor(colors[ansiColorKey(name)]);
    if (color) ansi[name] = color;
  }
  const rules = sanitizeTokenColors(theme.tokenColors) ?? [];
  const syntax: Partial<Record<TerminalSyntaxSlot, string>> = {};
  for (const slot of SYNTAX_SLOTS) {
    for (const target of SYNTAX_SLOT_SCOPES[slot]) {
      const color = resolveScopeColor(rules, target);
      if (color) {
        syntax[slot] = color;
        break;
      }
    }
  }
  if (Object.keys(ansi).length === 0 && Object.keys(syntax).length === 0) return null;
  return { ansi, syntax };
}

// Keyed by the theme's core colors, not its id: ids change when light and dark files are
// paired or renamed on install, while a variant's colors pass through unchanged.
function paletteKey(colors: ThemeColors): string {
  return [colors.canvas, colors.text, colors.accent, colors.codeBackground, colors.border].join(
    "|",
  );
}

function readStoredPalettes(): Record<string, TerminalPalette> {
  try {
    const raw = globalThis.localStorage?.getItem(TERMINAL_PALETTES_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isRecord(parsed) ? (parsed as Record<string, TerminalPalette>) : {};
  } catch {
    return {};
  }
}

export function rememberTerminalPalette(
  colors: ThemeColors,
  palette: TerminalPalette | null,
): void {
  if (!palette) return;
  const stored = readStoredPalettes();
  const key = paletteKey(colors);
  delete stored[key];
  stored[key] = palette;
  const keys = Object.keys(stored);
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_STORED_PALETTES))) {
    delete stored[stale];
  }
  try {
    globalThis.localStorage?.setItem(TERMINAL_PALETTES_STORAGE_KEY, JSON.stringify(stored));
  } catch {}
}

/** Unset variables fall back to the defaults in terminal-mode.css. */
export function applyTerminalPalette(root: HTMLElement, colors: ThemeColors | null): void {
  const palette = colors ? readStoredPalettes()[paletteKey(colors)] : undefined;
  for (const name of TERMINAL_ANSI_NAMES) {
    const color = hexColor(palette?.ansi?.[name]);
    if (color) root.style.setProperty(`--t3-ansi-${name}`, color);
    else root.style.removeProperty(`--t3-ansi-${name}`);
  }
  for (const slot of SYNTAX_SLOTS) {
    const color = hexColor(palette?.syntax?.[slot]);
    if (color) root.style.setProperty(`--t3-theme-syntax-${slot}`, color);
    else root.style.removeProperty(`--t3-theme-syntax-${slot}`);
  }
}
