export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
} as const;

export const radii = { small: 6, medium: 8, large: 12, pill: 999 } as const;

export const typography = {
  xs: 11,
  small: 12,
  body: 14,
  chat: 13,
  panelTitle: 22,
  pageTitle: 32,
  authTitle: 34,
} as const;

export const darkColors = {
  canvas: "#0d0f12",
  surface: "#15181d",
  surfaceRaised: "#1b1f25",
  surfaceHover: "#2b3139",
  input: "#12161b",
  border: "#2a3038",
  borderStrong: "#424a55",
  fieldBorder: "#39414b",
  text: "#f1f3ee",
  textMuted: "#b1b7bf",
  textDim: "#929aa4",
  accent: "#7dff98",
  accentSoft: "#24422c",
  accentInk: "#071009",
  danger: "#e36a6a",
  dangerSurface: "#2a1618",
} as const;

export const lightColors = {
  canvas: "#f7f7f5",
  surface: "#ffffff",
  surfaceRaised: "#f1f2ef",
  surfaceHover: "#e2e5df",
  input: "#ffffff",
  border: "#dfe2dc",
  borderStrong: "#c8cdc5",
  fieldBorder: "#cdd2cb",
  text: "#171b18",
  textMuted: "#626a64",
  textDim: "#777f79",
  accent: "#18843a",
  accentSoft: "#e4f3e8",
  accentInk: "#ffffff",
  danger: "#c63f49",
  dangerSurface: "#fff0f1",
} as const;

export type ThemeColors = { [Key in keyof typeof darkColors]: string };
export type ThemeMode = "light" | "dark";
