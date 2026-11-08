import type {Ctx} from './shared';
import {
  drawCinematicBokehCloseup,
  drawCinematicBokehMidground,
  drawCinematicPlatformMidground,
  drawCinematicRailForeground,
  drawCinematicStreetBackground,
} from './cinematicEnvironment';
import {
  drawCinematicMan,
  drawCinematicTram,
  drawCinematicWoman,
  drawCinematicWomanCloseup,
} from './cinematicFigures';
import {
  drawAnimeBackground,
  drawAnimeBokehMidground,
  drawAnimeCloseup,
  drawAnimeCloseupBackground,
  drawAnimeForeground,
  drawAnimeMan,
  drawAnimeMidground,
  drawAnimeTram,
  drawAnimeWoman,
} from './animePlates';

export type ArtPlateSpec = {
  name: string;
  width: number;
  height: number;
  opaque: boolean;
  note: string;
  draw: (ctx: Ctx, width: number, height: number) => void;
};

/**
 * The approved artwork inventory for the two prototypes. Every plate is
 * generated offline by this repository's own code; nothing is downloaded.
 */
export const ART_PLATES: readonly ArtPlateSpec[] = Object.freeze([
  {
    name: 'cinematic-bg-street',
    width: 1920,
    height: 1080,
    opaque: true,
    note: 'Rainy tram stop establishing background: skyline, wet street, rails, reflections',
    draw: drawCinematicStreetBackground,
  },
  {
    name: 'cinematic-bg-closeup',
    width: 1920,
    height: 1080,
    opaque: true,
    note: 'Shallow close-up backdrop: bokeh practicals behind the subject',
    draw: drawCinematicBokehCloseup,
  },
  {
    name: 'cinematic-mg-bokeh',
    width: 1920,
    height: 1080,
    opaque: false,
    note: 'Transparent defocus plane for close shots: bokeh practicals and light streaks',
    draw: drawCinematicBokehMidground,
  },
  {
    name: 'cinematic-mg-platform',
    width: 1920,
    height: 1080,
    opaque: false,
    note: 'Midground shelter, tiled wall, bench, route board and lamp',
    draw: drawCinematicPlatformMidground,
  },
  {
    name: 'cinematic-fg-rail',
    width: 1920,
    height: 1080,
    opaque: false,
    note: 'Foreground railing, near cable, wet pavement rim and soft foliage',
    draw: drawCinematicRailForeground,
  },
  {
    name: 'cinematic-subject-woman',
    width: 1000,
    height: 1400,
    opaque: false,
    note: 'Full figure: cream coat, red scarf, dark bob',
    draw: drawCinematicWoman,
  },
  {
    name: 'cinematic-subject-man',
    width: 1000,
    height: 1400,
    opaque: false,
    note: 'Full figure: olive jacket, dark trousers',
    draw: drawCinematicMan,
  },
  {
    name: 'cinematic-subject-woman-close',
    width: 1400,
    height: 1400,
    opaque: false,
    note: 'Chest-up portrait with readable expression and a tear',
    draw: drawCinematicWomanCloseup,
  },
  {
    name: 'cinematic-tram',
    width: 1700,
    height: 800,
    opaque: false,
    note: 'Tram side plate with lit windows, headlight and livery band',
    draw: drawCinematicTram,
  },
  {
    name: 'anime-bg-street',
    width: 1920,
    height: 1080,
    opaque: true,
    note: 'Comic street: two-tone sky, halftone, graphic skyline and rain',
    draw: drawAnimeBackground,
  },
  {
    name: 'anime-mg-platform',
    width: 1920,
    height: 1080,
    opaque: false,
    note: 'Ink-outlined shelter, flat glass fields and a hard light cone',
    draw: drawAnimeMidground,
  },
  {
    name: 'anime-bg-closeup',
    width: 1920,
    height: 1080,
    opaque: true,
    note: 'Comic close-up backdrop: flat tone blocks, halftone and radial emphasis lines',
    draw: drawAnimeCloseupBackground,
  },
  {
    name: 'anime-mg-bokeh',
    width: 1920,
    height: 1080,
    opaque: false,
    note: 'Transparent comic midground: halftone field and radial emphasis lines',
    draw: drawAnimeBokehMidground,
  },
  {
    name: 'anime-fg-rail',
    width: 1920,
    height: 1080,
    opaque: false,
    note: 'Heavy ink railing, foreground cable and splash marks',
    draw: drawAnimeForeground,
  },
  {
    name: 'anime-subject-woman',
    width: 1000,
    height: 1400,
    opaque: false,
    note: 'Cel figure: cream coat, alert-red scarf, manga eyes',
    draw: drawAnimeWoman,
  },
  {
    name: 'anime-subject-man',
    width: 1000,
    height: 1400,
    opaque: false,
    note: 'Cel figure: olive coat, taller proportions',
    draw: drawAnimeMan,
  },
  {
    name: 'anime-subject-woman-close',
    width: 1400,
    height: 1400,
    opaque: false,
    note: 'Dramatic manga close-up with radial speed lines and a tear',
    draw: drawAnimeCloseup,
  },
  {
    name: 'anime-tram',
    width: 1700,
    height: 800,
    opaque: false,
    note: 'Graphic tram with motion lines and a comic headlight starburst',
    draw: drawAnimeTram,
  },
]);

export const ART_PLATE_DRAWERS: Readonly<Record<string, ArtPlateSpec['draw']>> = Object.freeze(
  Object.fromEntries(ART_PLATES.map((plate) => [plate.name, plate.draw])),
);
