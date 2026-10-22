// Scene colours derived only from the supplied six-colour palette (plus white and near-white tints).
import type { EnvTheme } from './environment';

export const PALETTE = { forest: '#051F20', pine: '#0B2B26', spruce: '#163832', moss: '#235347', sage: '#8EB69B', mint: '#DAF1DE' } as const;

export type SceneTheme = {
  exposure: number;
  env: number;
  hemi: [string, string, number];
  key: [string, number];
  rim: [string, number];
  shell: string;
  paint: string;
  shadow: number;
  glow: string;
  env3d: EnvTheme;
};

export const SCENE_THEMES: Record<'light' | 'dark', SceneTheme> = {
  light: {
    exposure: 1.0,
    env: 1.0,
    hemi: ['#ffffff', PALETTE.sage, 0.9],
    key: ['#ffffff', 2.6],
    rim: [PALETTE.mint, 1.2],
    shell: '#f4faf6',
    paint: '#e9f4ed',
    shadow: 0.5,
    glow: PALETTE.moss,
    env3d: {
      floor: '#e9f3ec',
      floorAlpha: 0.86,
      line: '#ffffff',
      bay: PALETTE.sage,
      hedge: PALETTE.moss,
      canopy: '#f4faf6',
      canopyGlow: '#ffffff',
      hills: [PALETTE.sage, PALETTE.sage],
      hillAlpha: 0.22,
      block: '#cfe2d6',
      blockTop: '#ffffff',
      route: PALETTE.moss,
      pinCar: PALETTE.moss,
      pinBike: PALETTE.pine,
    },
  },
  dark: {
    exposure: 1.1,
    env: 0.38,
    hemi: [PALETTE.sage, PALETTE.forest, 0.45],
    key: [PALETTE.mint, 1.4],
    rim: [PALETTE.sage, 2.6],
    shell: '#dfece4',
    paint: '#e3efe7',
    shadow: 0.75,
    glow: PALETTE.sage,
    env3d: {
      floor: '#0b2421',
      floorAlpha: 0.78,
      line: PALETTE.sage,
      bay: PALETTE.moss,
      hedge: PALETTE.spruce,
      canopy: '#122d29',
      canopyGlow: PALETTE.mint,
      hills: [PALETTE.spruce, PALETTE.pine],
      hillAlpha: 0.9,
      block: '#10302a',
      blockTop: PALETTE.spruce,
      route: PALETTE.mint,
      pinCar: PALETTE.mint,
      pinBike: PALETTE.sage,
    },
  },
};
