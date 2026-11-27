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
  xs: 12,
  small: 13,
  body: 14,
  chat: 14,
  panelTitle: 18,
  pageTitle: 24,
  authTitle: 28,
} as const;

export const darkColors = {
  canvas: "#111214",
  surface: "#161719",
  surfaceRaised: "#1d1f22",
  surfaceHover: "#2a2d31",
  input: "#191b1e",
  border: "#ffffff12",
  borderStrong: "#ffffff29",
  fieldBorder: "#ffffff24",
  text: "#eceef0",
  textMuted: "#adb2b9",
  textDim: "#9299a3",
  accent: "#88e5a2",
  accentSoft: "#20382a",
  accentInk: "#071009",
  danger: "#e36a6a",
  dangerSurface: "#2a1618",
} as const;

export const lightColors = {
  canvas: "#fafafa",
  surface: "#ffffff",
  surfaceRaised: "#f4f5f6",
  surfaceHover: "#e9ecef",
  input: "#ffffff",
  border: "#18202b14",
  borderStrong: "#18202b33",
  fieldBorder: "#18202b29",
  text: "#20242a",
  textMuted: "#59616d",
  textDim: "#697380",
  accent: "#18843a",
  accentSoft: "#e4f3e8",
  accentInk: "#ffffff",
  danger: "#c63f49",
  dangerSurface: "#fff0f1",
} as const;

export type ThemeColors = { [Key in keyof typeof darkColors]: string };
export type ThemeMode = "light" | "dark";
