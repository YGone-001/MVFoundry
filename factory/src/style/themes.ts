// Optional theme layer for the P1-G-A style prototype.
//
// Style and theme are separate: a style owns the visual language and default
// palette; a theme can override shared roles (ground, ink, accent, paper) for
// title cards, HUD blocks and editorial type. A theme cannot turn one style
// into another.

export type ThemeMode = 'dark' | 'light';

export type ThemeRoles = {
  bg: string;
  bgDeep: string;
  surface: string;
  ink: string;
  muted: string;
  accent: string;
  accentSoft: string;
  paper: string;
  flash: string;
};

export type ThemeProfile = {
  id: string;
  label: string;
  mode: ThemeMode;
  intent: string;
  roles: ThemeRoles;
  material: string;
  typography: string;
  limitations: readonly string[];
};

const freezeTheme = (theme: ThemeProfile): ThemeProfile =>
  Object.freeze({
    ...theme,
    roles: Object.freeze({...theme.roles}),
    limitations: Object.freeze([...theme.limitations]),
  });

export const THEME_PROFILES: Readonly<Record<string, ThemeProfile>> = Object.freeze({
  'coral-noir': freezeTheme({
    id: 'coral-noir',
    label: 'Coral noir',
    mode: 'dark',
    intent: 'Warm dark ground with a single coral accent; grain and restrained glow carry the film tone.',
    roles: {
      bg: '#0e0e0d',
      bgDeep: '#060605',
      surface: '#1a1917',
      ink: '#f5f0e8',
      muted: '#8f8981',
      accent: '#d97757',
      accentSoft: '#f0b49c',
      paper: '#f4efe6',
      flash: '#ffffff',
    },
    material: 'Static film grain at 5.5% and a coral radial glow used only at transitions.',
    typography: 'Heavy sans display for statements; serif italic for the closing line.',
    limitations: ['coral must stay under 5% of the frame', 'no glass or metal material'],
  }),
  'claude-light': freezeTheme({
    id: 'claude-light',
    label: 'Warm paper light',
    mode: 'light',
    intent: 'Warm paper ground with terracotta accent; quiet, printed, human.',
    roles: {
      bg: '#f0eee6',
      bgDeep: '#e7e3d7',
      surface: '#e8e4d8',
      ink: '#1f1e1d',
      muted: '#6b675e',
      accent: '#d97757',
      accentSoft: '#f2c7b5',
      paper: '#fbfaf6',
      flash: '#fffaf0',
    },
    material: 'Paper bloom and very light warm haze; no glass, metal or glow balls.',
    typography: 'Heavy sans for type; Playfair-style serif italic for the closing line.',
    limitations: ['light grounds need dark capsules for readable labels', 'no neon accents'],
  }),
  'aqua-morandi': freezeTheme({
    id: 'aqua-morandi',
    label: 'Aqua Morandi',
    mode: 'light',
    intent: 'Misty aqua ground with sage and dusty pink surfacing only through light and glass.',
    roles: {
      bg: '#f4f8f8',
      bgDeep: '#e6f0f1',
      surface: '#eaf2f2',
      ink: '#2f3a3c',
      muted: '#617376',
      accent: '#6e9fae',
      accentSoft: '#a9c9d3',
      paper: '#fbfcfc',
      flash: '#ffffff',
    },
    material: 'Soft liquid-glass panels with broad highlights; sage and pink are tints, never walls.',
    typography: 'Lighter weights and generous leading; serif for titles.',
    limitations: ['no pure white outside cards', 'no high-contrast black type', 'no neon'],
  }),
  'amber-noir': freezeTheme({
    id: 'amber-noir',
    label: 'Amber noir',
    mode: 'dark',
    intent: 'Near-black ground with old gold; a title-sequence texture, quiet and expensive.',
    roles: {
      bg: '#0c0a08',
      bgDeep: '#060504',
      surface: '#17130f',
      ink: '#ffffff',
      muted: '#9a9184',
      accent: '#c9a45a',
      accentSoft: '#e2c88e',
      paper: '#efe7d8',
      flash: '#fff3dd',
    },
    material: 'A single -24 degree gold sheen across type; no large gold gradient fields.',
    typography: 'Serif display and mono metadata; generous letter spacing.',
    limitations: ['no oversized gold gradient backgrounds', 'flash white must be warm'],
  }),
});

export const THEME_IDS: readonly string[] = Object.freeze(Object.keys(THEME_PROFILES));

/** Themes studied in the reference but not implemented here. */
export const THEME_REFERENCE_ONLY = Object.freeze([
  'blueprint-stone',
  'graphite-signal',
  'celadon-paper',
  'crimson-theater',
]);

export const getThemeProfile = (id: string): ThemeProfile | undefined => THEME_PROFILES[id];

export const isRegisteredTheme = (id: string): boolean => THEME_PROFILES[id] !== undefined;

export const assertRegisteredTheme = (id: string): ThemeProfile => {
  const theme = THEME_PROFILES[id];
  if (!theme) {
    throw new Error(`Unknown theme '${id}'. Registered themes: ${THEME_IDS.join(', ')}`);
  }
  return theme;
};
