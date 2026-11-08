// MVFoundry visual style catalog (P1-G-A prototype).
//
// A style is a production language, not a palette and not a renderer. It
// describes intent, materials, composition, lighting, motion, typography,
// required asset types and which rendering backends can implement it.
//
// `implementedBackends` is the honest capability list for this phase. A style
// being listed in `compatibleBackends` does not mean a backend exists.

export const STYLE_BACKENDS = ['canvas2d', 'svg', 'html', 'three', 'video'] as const;
export type StyleBackend = (typeof STYLE_BACKENDS)[number];

/**
 * Media renderer kinds. A style must declare one of these explicitly before a
 * style-driven project may place that renderer on the timeline; the catalog
 * never assumes that approved footage is compatible with every style.
 */
export const MEDIA_RENDERER_KINDS = ['video', 'hybrid', 'parallax-2p5d'] as const;
export type MediaRendererKind = (typeof MEDIA_RENDERER_KINDS)[number];

/**
 * Capabilities inside a media route. They are checked against the actual shot
 * media so a style cannot silently accept a plate type it was never reviewed
 * for.
 */
export const STYLE_MEDIA_CAPABILITIES = [
  'image-plate',
  'video-plate',
  'comic-treatment',
] as const;
export type StyleMediaCapability = (typeof STYLE_MEDIA_CAPABILITIES)[number];

export type StyleMediaRoute = {
  renderer: MediaRendererKind;
  detail: string;
  capabilities: readonly StyleMediaCapability[];
  limitations: readonly string[];
};

export type StylePaletteRole = {
  role: string;
  value: string;
  note: string;
};

/**
 * Style-declared grading bias for approved media. Kept explicit so image-backed
 * scenes are never auto-washed by an unnamed default; `tintRole` names a palette
 * role instead of duplicating a hex value.
 */
export type StyleGradeBias = {
  saturation: number;
  contrast: number;
  brightness: number;
  tintRole: string;
  tintOpacity: number;
  vignette: number;
  grain: number;
};

export type VisualStyleProfile = {
  id: string;
  label: string;
  intent: string;
  keywords: readonly string[];
  palette: readonly StylePaletteRole[];
  materials: readonly string[];
  composition: readonly string[];
  lighting: readonly string[];
  motion: readonly string[];
  camera: readonly string[];
  typography: string | null;
  assetTypes: readonly string[];
  compatibleBackends: readonly StyleBackend[];
  implementedBackends: readonly StyleBackend[];
  mediaRoutes: readonly StyleMediaRoute[];
  gradeBias: StyleGradeBias;
  outputCapabilities: readonly string[];
  limitations: readonly string[];
  qualityExpectations: readonly string[];
};

const freezeRoute = (route: StyleMediaRoute): StyleMediaRoute =>
  Object.freeze({
    ...route,
    capabilities: Object.freeze([...route.capabilities]),
    limitations: Object.freeze([...route.limitations]),
  });

const freezeProfile = (profile: VisualStyleProfile): VisualStyleProfile =>
  Object.freeze({
    ...profile,
    keywords: Object.freeze([...profile.keywords]),
    palette: Object.freeze(profile.palette.map((entry) => Object.freeze({...entry}))),
    materials: Object.freeze([...profile.materials]),
    composition: Object.freeze([...profile.composition]),
    lighting: Object.freeze([...profile.lighting]),
    motion: Object.freeze([...profile.motion]),
    camera: Object.freeze([...profile.camera]),
    assetTypes: Object.freeze([...profile.assetTypes]),
    compatibleBackends: Object.freeze([...profile.compatibleBackends]),
    implementedBackends: Object.freeze([...profile.implementedBackends]),
    mediaRoutes: Object.freeze(profile.mediaRoutes.map(freezeRoute)),
    gradeBias: Object.freeze({...profile.gradeBias}),
    outputCapabilities: Object.freeze([...profile.outputCapabilities]),
    limitations: Object.freeze([...profile.limitations]),
    qualityExpectations: Object.freeze([...profile.qualityExpectations]),
  });

export const STYLE_PROFILES: Readonly<Record<string, VisualStyleProfile>> = Object.freeze({
  'cinematic-illustration-2p5d': freezeProfile({
    id: 'cinematic-illustration-2p5d',
    label: 'Cinematic 2.5D illustration',
    intent:
      'Painterly 2.5D cinematography: layered depth, volumetric practical light and restrained camera movement carry the emotion before any effect does.',
    keywords: ['cinematic', '2.5D', 'painterly', 'rain', 'depth', 'restrained'],
    palette: [
      {role: 'night', value: '#07101c', note: 'base night; 70-80% of the frame'},
      {role: 'harbour', value: '#123246', note: 'mid-distance buildings and haze'},
      {role: 'sodium', value: '#e29a4a', note: 'single warm practical per scene'},
      {role: 'warmHighlight', value: '#ffe0b0', note: 'lamp core and skin key'},
      {role: 'wetCyan', value: '#6fd0cc', note: 'shop fluorescent and reflections'},
      {role: 'skin', value: '#e6b189', note: 'lit skin; shadow uses #8f5b40'},
      {role: 'scarf', value: '#b84753', note: 'the one saturated red'},
      {role: 'olive', value: '#4c5838', note: 'Zhiming jacket; never neon'},
    ],
    materials: [
      'soft painterly gradients with broad value steps',
      'volumetric haze around lamps',
      'wet asphalt with broken vertical reflections',
      'static fine grain at 3-4%, never animated noise',
      'layered parallax cutouts at three depths',
    ],
    composition: [
      'rule-of-thirds subject placement, never dead centre by habit',
      'foreground rain or puddle, midground platform, background skyline',
      'negative space measured in character widths, not pixels',
      'eyeline and umbrella line lead toward the other character',
      'every shot must survive as a still frame',
    ],
    lighting: [
      'one warm practical and one cool ambient per scene',
      'rim light on the shadow side, never a full outline',
      'no light without a visible source',
      'tram windows sweep as moving light bands, not as a flash effect',
    ],
    motion: [
      'slow 3-5% push over the shot',
      'parallax drift opposite the camera',
      'rain carries the small motion; bodies carry the emotional motion',
      'tram pass is a wipe, not a cut',
    ],
    camera: [
      'wide establishing, medium two-shot, close portrait, final wide',
      'locked frame for distance; 4% push for realisation',
      'no handheld shake and no speed ramps',
    ],
    typography: 'Only a restrained end card. No lyric text inside the frame.',
    assetTypes: [
      'programmatic layered canvas art (implemented route)',
      'optional painted character sheets for higher fidelity',
      'optional approved video plates for footage-hybrid',
    ],
    compatibleBackends: ['canvas2d', 'svg', 'three', 'video'],
    implementedBackends: ['canvas2d'],
    mediaRoutes: [
      {
        renderer: 'parallax-2p5d',
        detail:
          'Approved PNG plates and RGBA layers compose into a deterministic layered 2.5D shot with camera, depth, atmosphere and light motion.',
        capabilities: ['image-plate', 'video-plate'],
        limitations: [
          'depth is layered cardboard parallax, not volumetric 3D',
          'no real depth of field; blur must be painted into the plates',
        ],
      },
      {
        renderer: 'video',
        detail:
          'Approved footage may occupy a shot when the plate already carries the intended cinematography; the style only grades and times it.',
        capabilities: ['video-plate'],
        limitations: ['the engine cannot repaint footage into the illustration language'],
      },
      {
        renderer: 'hybrid',
        detail:
          'Approved footage plus RGBA layers, with the style owning overlays, grade and typography.',
        capabilities: ['video-plate'],
        limitations: ['layers cannot invent geometry the footage does not contain'],
      },
    ],
    gradeBias: {
      saturation: 1.06,
      contrast: 1.08,
      brightness: 1.02,
      tintRole: 'harbour',
      tintOpacity: 0.07,
      vignette: 0.42,
      grain: 0.06,
    },
    outputCapabilities: [
      'deterministic 24fps output at 720p or 1080p',
      'true full-resolution Canvas2D (canvas.mode=output)',
      'safe for project-local modules with no external assets',
    ],
    limitations: [
      'procedural faces are vector illustrations, not painted portraits',
      'painterly texture is code-generated; a hand-painted look needs supplied sheets',
      'no real depth-of-field; depth is faked with layered alpha and haze',
    ],
    qualityExpectations: [
      'must read as a film still, not a diagram',
      'every frame needs a clear foreground, midground and background',
      'the two leads must be identifiable by silhouette and clothing colour',
    ],
  }),

  'anime-motion-comic': freezeProfile({
    id: 'anime-motion-comic',
    label: 'Anime motion comic',
    intent:
      'A comic page brought to motion: thick ink, cel colour, speed lines, impact frames and hard panel wipes, with dramatic angles instead of naturalistic coverage.',
    keywords: ['anime', 'comic', 'ink', 'impact', 'speed lines', 'cel'],
    palette: [
      {role: 'ink', value: '#0a0a12', note: 'outlines and shadow blocks'},
      {role: 'nightSky', value: '#14234a', note: 'flat sky, two-tone'},
      {role: 'electricBlue', value: '#2f5fd0', note: 'tram light and shadow accent'},
      {role: 'alertRed', value: '#e64545', note: 'scarf, signal, impact'},
      {role: 'highlight', value: '#ffd166', note: 'lamp and speed-line core'},
      {role: 'paper', value: '#f7f4ea', note: 'panel gutters and highlights'},
    ],
    materials: [
      'thick black ink outlines at 2-4 px',
      'two-tone cel shading with hard terminator',
      'halftone dot fields for memory and texture',
      'radial and horizontal speed lines',
      '2-3 frame impact flashes on cuts',
    ],
    composition: [
      'diagonal panel splits and dutch tilts',
      'extreme low angle for the tram, high angle for hesitation',
      'faces large in frame; environment reduced to graphic shapes',
      'white gutters and caption blocks separate beats',
    ],
    lighting: [
      'hard key with one shadow block, no soft gradients',
      'bloom only on the tram headlight',
      'backgrounds flat; light is a graphic shape, not a material',
    ],
    motion: [
      'snap zoom at tram arrival, 1-2 frame hold',
      'panel wipe at each narrative beat',
      'wind moves hair and scarf continuously',
      'impact frame at the turn-away',
    ],
    camera: [
      'dramatic low angle, dutch tilt, extreme close-up',
      'cuts are panel transitions, not physical camera moves',
    ],
    typography: 'Bold comic captions and sound-effect lettering are allowed, but never lyric subtitles.',
    assetTypes: [
      'programmatic comic art (implemented route)',
      'optional manga character sheets and halftone textures',
    ],
    compatibleBackends: ['canvas2d', 'svg'],
    implementedBackends: ['canvas2d'],
    mediaRoutes: [
      {
        renderer: 'parallax-2p5d',
        detail:
          'Ink plates and cel cutouts compose through the deterministic layer compositor with comic treatment: stepped motion, halftone, speed lines, panel gutters, impact frames and panel wipes.',
        capabilities: ['image-plate', 'comic-treatment'],
        limitations: [
          'the comic treatment is graphic, not real cel animation',
          'no in-between drawing: expression changes must exist in the supplied plates',
        ],
      },
      {
        renderer: 'video',
        detail: 'Approved footage can be graded and held as a comic panel.',
        capabilities: ['video-plate'],
        limitations: ['footage cannot gain ink linework from grading alone'],
      },
      {
        renderer: 'hybrid',
        detail: 'Approved footage plus RGBA comic cutouts.',
        capabilities: ['video-plate'],
        limitations: ['graphic panels still come from the supplied layer art'],
      },
    ],
    gradeBias: {
      saturation: 1.24,
      contrast: 1.30,
      brightness: 1.04,
      tintRole: 'nightSky',
      tintOpacity: 0.04,
      vignette: 0.18,
      grain: 0.02,
    },
    outputCapabilities: ['deterministic 24fps output', 'full-resolution Canvas2D'],
    limitations: [
      'motion-comic is not full character animation',
      'procedural faces are stylised, not hand-drawn manga',
      'text needs a local font; missing fonts fall back',
    ],
    qualityExpectations: [
      'must feel like a comic page in motion, not a slideshow of frames',
      'speed lines and impact frames must serve the story, not decorate every shot',
      'the two leads must remain on-model between panels',
    ],
  }),

  'ink-watercolor': freezeProfile({
    id: 'ink-watercolor',
    label: 'Ink and watercolour',
    intent:
      'Memory as ink on paper: wet washes, bleeding edges, enormous negative space, and a single vermilion accent that carries the emotional heat.',
    keywords: ['ink', 'watercolour', 'paper', 'negative space', 'memory', 'vermilion'],
    palette: [
      {role: 'paper', value: '#ece4d6', note: 'cold-press paper ground'},
      {role: 'ink', value: '#2b2926', note: 'nearest strokes'},
      {role: 'inkMid', value: '#6b655c', note: 'mid-distance wash'},
      {role: 'inkFar', value: '#9a9386', note: 'far wash, low contrast'},
      {role: 'vermilion', value: '#b0392e', note: 'umbrella, seal, the only warm'},
      {role: 'stain', value: '#d6c9b4', note: 'paper stains and tide marks'},
    ],
    materials: [
      'cold-press paper fibre and tooth',
      'wet ink bleed with soft edges',
      'dry-brush broken strokes',
      'tide marks and paper stains',
      'blooms that expand and settle, never digital glow',
    ],
    composition: [
      'horizontal scroll with low horizon',
      'asymmetric negative space; the empty area is the subject',
      'one vertical calligraphic mark per frame at most',
      'figures are 3-5 brush strokes, not detailed models',
    ],
    lighting: [
      'ambient paper light; no hard cast shadows',
      'vermilion sun or seal as the only saturated point',
      'contrast comes from ink density, not from colour',
    ],
    motion: [
      'very slow horizontal pan',
      'ink blooms expand and fade',
      'mist bands drift',
      'cuts land on still frames, never on a wipe',
    ],
    camera: ['long take, minimal cuts, scroll-like framing'],
    typography: 'Optional vertical calligraphy and a small seal. No lyric subtitles.',
    assetTypes: [
      'programmatic ink wash (implemented route)',
      'scanned paper and brush textures for higher fidelity',
    ],
    compatibleBackends: ['canvas2d', 'svg'],
    implementedBackends: ['canvas2d'],
    mediaRoutes: [
      {
        renderer: 'parallax-2p5d',
        detail:
          'Approved ink-wash plates compose with a slow horizontal drift and pigment-like edge treatment; negative space is preserved by keeping plates sparse.',
        capabilities: ['image-plate'],
        limitations: [
          'the compositor cannot simulate pigment diffusion; wash edges must be painted',
          'no strong camera moves: watercolour reads as a scroll, not a dolly',
        ],
      },
      {
        renderer: 'video',
        detail: 'Approved footage can be held in a still, paper-toned frame.',
        capabilities: ['video-plate'],
        limitations: ['video texture cannot become a wet wash without authored plates'],
      },
      {
        renderer: 'hybrid',
        detail: 'Approved footage plus sparse RGBA brush layers.',
        capabilities: ['video-plate'],
        limitations: ['pigment behaviour is authored, never synthesised per frame'],
      },
    ],
    gradeBias: {
      saturation: 0.94,
      contrast: 0.98,
      brightness: 1.10,
      tintRole: 'stain',
      tintOpacity: 0.10,
      vignette: 0.12,
      grain: 0.14,
    },
    outputCapabilities: ['deterministic 24fps output', 'full-resolution Canvas2D'],
    limitations: [
      'procedural ink cannot equal real watercolour',
      'wet-edge bleed is simulated with shadow blur, not pigment diffusion',
      'no third-party paper textures are used in this demo',
      'minimal figures carry less facial performance',
    ],
    qualityExpectations: [
      'must breathe: edges should feel wet, not like faded vector shapes',
      'wet edges must read as pigment diffusion, not as a blurred drop shadow',
      'the red accent must be meaningful, not decorative',
      'if it reads as brown blobs, it fails',
    ],
  }),

  'editorial-motion-graphics': freezeProfile({
    id: 'editorial-motion-graphics',
    label: 'Editorial motion graphics',
    intent:
      'A designed essay: grid, bold typography, duotone cutouts and hard graphic wipes turn the story into a layout with a point of view.',
    keywords: ['editorial', 'grid', 'typography', 'duotone', 'collage', 'motion'],
    palette: [
      {role: 'paper', value: '#f3efe6', note: 'ground; text is ink'},
      {role: 'ink', value: '#111111', note: 'type and silhouettes'},
      {role: 'coral', value: '#d97757', note: 'primary editorial accent'},
      {role: 'cobalt', value: '#2456d6', note: 'secondary field'},
      {role: 'yellow', value: '#ffcf5c', note: 'highlight block'},
      {role: 'gray', value: '#8a857b', note: 'secondary text and rules'},
    ],
    materials: [
      'flat colour fields with no gradients',
      '1 px grid and hairline rules',
      'halftone photo blocks',
      'monospace metadata labels',
      'subtle paper grain at 2%',
    ],
    composition: [
      '12-column grid with deliberate breaks',
      'one large typographic statement per shot',
      'duotone character cutouts placed as images, not actors',
      'circles, arrows and counters carry attention',
    ],
    lighting: ['flat and graphic; contrast comes from colour fields and type weight'],
    motion: [
      'kinetic type snapping to the grid',
      'hard colour wipes at cuts',
      'bars, counters and arrows grow or count',
      'cursor and highlight blocks move with intent',
    ],
    camera: ['graphic camera: layout transitions, not physical camera moves'],
    typography: 'Bold sans display and monospace labels are part of the story. No lyric subtitles.',
    assetTypes: [
      'programmatic type and cutouts (implemented route)',
      'illustrated duotone character cutouts for higher fidelity',
      'icon set',
    ],
    compatibleBackends: ['canvas2d', 'html', 'svg'],
    implementedBackends: ['canvas2d'],
    mediaRoutes: [
      {
        renderer: 'parallax-2p5d',
        detail:
          'Approved duotone cutouts compose as flat graphic cards with grid-snapped camera moves and hard layout wipes.',
        capabilities: ['image-plate'],
        limitations: [
          'cutouts must already be duotone; the compositor does not author type',
          'continuous photographic motion fights the editorial grid',
        ],
      },
      {
        renderer: 'video',
        detail: 'Approved footage is held as a duotone image block inside the layout.',
        capabilities: ['video-plate'],
        limitations: ['the footage is treated as a still block; no kinetic type is generated'],
      },
      {
        renderer: 'hybrid',
        detail: 'Approved footage plus duotone cutouts and graphic layers.',
        capabilities: ['video-plate'],
        limitations: ['the editorial layout must be authored in the layer art'],
      },
    ],
    gradeBias: {
      saturation: 1.12,
      contrast: 1.16,
      brightness: 1.05,
      tintRole: 'paper',
      tintOpacity: 0.06,
      vignette: 0.08,
      grain: 0.02,
    },
    outputCapabilities: ['deterministic 24fps output', 'full-resolution Canvas2D'],
    limitations: [
      'character performance is limited; type carries the narrative',
      'font availability must be verified in the render browser',
      'without the type layer the style loses its meaning',
    ],
    qualityExpectations: [
      'must look art-directed, not like a dashboard',
      'type must be readable at 720p and not collide with silhouettes',
      'the grid must be visible in the composition, not only in the code',
    ],
  }),

  'stylized-3d-diorama': freezeProfile({
    id: 'stylized-3d-diorama',
    label: 'Stylised 3D diorama',
    intent:
      'A miniature world: isometric volumes, soft shadows, glossy wet materials, tilt-shift and a slow orbit around a tiny stage.',
    keywords: ['diorama', 'isometric', 'miniature', 'soft shadow', 'tilt-shift', 'toy'],
    palette: [
      {role: 'night', value: '#0b1724', note: 'stage surround'},
      {role: 'teal', value: '#1d4a5a', note: 'platform and shelter'},
      {role: 'lamp', value: '#f0a24a', note: 'warm practical'},
      {role: 'cream', value: '#f5e6c8', note: 'coat and paper'},
      {role: 'umbrella', value: '#b84753', note: 'the one saturated red'},
      {role: 'mint', value: '#a8d8d2', note: 'glass and wet highlight'},
    ],
    materials: [
      'rounded low-poly volumes',
      'soft ambient occlusion under every object',
      'glossy wet floor with broad reflections',
      'miniature-scale props and tilt-shift falloff',
      'no photoreal textures',
    ],
    composition: [
      'floating isometric stage on a dark surround',
      '30-degree orbit around the tram stop',
      'characters one third the height of the shelter',
      'foreground rail and background city block frame the stage',
    ],
    lighting: [
      'warm lamp key from camera left, cool ambient fill',
      'soft shadows, no hard cast edges',
      'reflections lie on the floor plane, not on the characters',
    ],
    motion: [
      'slow camera orbit and 5% push',
      'tram moves on rails with a soft shadow',
      'rain falls in depth layers with tiny splashes',
    ],
    camera: ['isometric camera with shallow tilt-shift; no free 3D orbit'],
    typography: 'Small labels only. No lyric text.',
    assetTypes: [
      'programmatic isometric primitives (implemented route)',
      'modelled characters and props for true 3D',
    ],
    compatibleBackends: ['three', 'canvas2d'],
    implementedBackends: ['canvas2d'],
    mediaRoutes: [
      {
        renderer: 'video',
        detail:
          'Approved footage can be presented inside the miniature stage frame when the set was already shot in that language.',
        capabilities: ['video-plate'],
        limitations: [
          'grading cannot turn live-action footage into a miniature diorama',
          'no parallax route: the diorama is one continuous isometric stage, not cutout layers',
        ],
      },
      {
        renderer: 'hybrid',
        detail: 'Approved footage inside the stage plus RGBA miniature props.',
        capabilities: ['video-plate'],
        limitations: ['props must match the perspective of the supplied footage'],
      },
    ],
    gradeBias: {
      saturation: 1.04,
      contrast: 1.05,
      brightness: 1.02,
      tintRole: 'teal',
      tintOpacity: 0.05,
      vignette: 0.30,
      grain: 0.04,
    },
    outputCapabilities: ['deterministic 24fps output', 'full-resolution Canvas2D isometric simulation'],
    limitations: [
      'Canvas2D isometric is an approximation, not WebGL lighting',
      'no real transmission, refraction or PBR materials',
      'character geometry scales with the set, but close-up facial acting remains simple',
      'wide and medium shots still favour the miniature world over actor performance',
    ],
    qualityExpectations: [
      'must read as a diorama, not as flat icons on a grid',
      'every object needs contact shadow and consistent light direction',
      'the miniature scale must be obvious from the first frame',
      'characters must stay readable at the shot scale; never enlarge the set and leave fixed-pixel actors behind',
    ],
  }),

  'retro-pixel': freezeProfile({
    id: 'retro-pixel',
    label: 'Retro pixel art',
    intent:
      'A deliberate low-resolution look: limited palette, integer pixels, parallax and pixel lighting, with animation sampled at 12fps.',
    keywords: ['pixel', 'low resolution', 'limited palette', 'parallax', 'dither', '16-bit'],
    palette: [
      {role: 'night', value: '#05070d', note: 'deep night'},
      {role: 'navy', value: '#0d1b2a', note: 'mid buildings'},
      {role: 'harbour', value: '#16324a', note: 'distant haze'},
      {role: 'sodium', value: '#e29a4a', note: 'warm lamp'},
      {role: 'warmHighlight', value: '#ffcf7a', note: 'lamp core and windows'},
      {role: 'wetCyan', value: '#63cdc6', note: 'shop sign and reflection'},
      {role: 'scarf', value: '#b84753', note: 'the one saturated red'},
      {role: 'cream', value: '#f4d9b0', note: 'coat and receipts'},
    ],
    materials: [
      'integer pixel grid with nearest-neighbour scaling',
      'ordered dithering for value steps',
      '16-colour discipline',
      'no antialiasing inside the pixel canvas',
    ],
    composition: [
      '320x180 or 480x270 pixel stage, 4x to 16:9',
      'three-layer parallax: skyline, buildings, street',
      'foreground silhouette and puddle reflection',
      'characters 48-96 px tall at output scale',
    ],
    lighting: [
      'pixel light bands and hard-edged shadows',
      'dithered gradients, no soft blur',
      'reflections as broken vertical pixel columns',
    ],
    motion: [
      '12fps stepped animation on a 24fps master',
      'tram wipe, rain, two-frame walk cycles',
      'no smooth camera interpolation',
    ],
    camera: ['locked pixel camera with integer offsets; 4x nearest-neighbour presentation'],
    typography: 'Bitmap font only; no lyric subtitles.',
    assetTypes: [
      'programmatic pixel art (implemented route)',
      'pixel sprite sheets and tile sets for higher fidelity',
    ],
    compatibleBackends: ['canvas2d'],
    implementedBackends: ['canvas2d'],
    mediaRoutes: [],
    gradeBias: {
      saturation: 1.02,
      contrast: 1.02,
      brightness: 1.00,
      tintRole: 'navy',
      tintOpacity: 0.03,
      vignette: 0.16,
      grain: 0.00,
    },
    outputCapabilities: ['480x270 or 320x180 design grid, 4x nearest-neighbour to 1080p/720p'],
    limitations: [
      'detail ceiling is intentional; close-up faces are limited',
      'cannot represent photoreal skin or cloth',
      'not a substitute for cinematic illustration',
      'no approved-media route: any footage or photographic plate would break the pixel grid',
    ],
    qualityExpectations: [
      'must be intentionally pixel art, not downscaled vector art',
      'palette discipline must hold across every shot',
      'the film must still read as a narrative, not a game screen',
    ],
  }),
});

export const STYLE_IDS: readonly string[] = Object.freeze(Object.keys(STYLE_PROFILES));

export const getStyleProfile = (id: string): VisualStyleProfile | undefined =>
  STYLE_PROFILES[id];

export const isRegisteredStyle = (id: string): boolean => STYLE_PROFILES[id] !== undefined;

export const assertRegisteredStyle = (id: string): VisualStyleProfile => {
  const profile = STYLE_PROFILES[id];
  if (!profile) {
    throw new Error(`Unknown visual style '${id}'. Registered styles: ${STYLE_IDS.join(', ')}`);
  }
  return profile;
};

export const styleSupportsBackend = (profile: VisualStyleProfile, backend: StyleBackend): boolean =>
  profile.compatibleBackends.includes(backend);

export const styleImplementsBackend = (profile: VisualStyleProfile, backend: StyleBackend): boolean =>
  profile.implementedBackends.includes(backend);

export const getStyleMediaRoute = (
  profile: VisualStyleProfile,
  renderer: MediaRendererKind,
): StyleMediaRoute | undefined => profile.mediaRoutes.find((route) => route.renderer === renderer);

export const styleSupportsMediaRenderer = (
  profile: VisualStyleProfile,
  renderer: MediaRendererKind,
): boolean => getStyleMediaRoute(profile, renderer) !== undefined;

export const styleMediaRouteSupports = (
  route: StyleMediaRoute,
  capability: StyleMediaCapability,
): boolean => route.capabilities.includes(capability);

/**
 * The existing approved-video route. This is a production route, not a style;
 * it composes approved footage or transparent layers under a supporting style.
 */
export const FOOTAGE_HYBRID_ROUTE = Object.freeze({
  id: 'footage-hybrid',
  label: 'Approved footage / layer hybrid',
  description:
    'Composes approved local video clips and transparent PNG layers through the existing video and hybrid renderers. The supporting style still owns grading, overlays and typography.',
  requiredAssetKinds: Object.freeze(['video', 'layer'] as const),
  compatibleStyles: Object.freeze([
    'cinematic-illustration-2p5d',
    'anime-motion-comic',
    'editorial-motion-graphics',
    'ink-watercolor',
    'stylized-3d-diorama',
  ]),
  limitations: Object.freeze([
    'source video must be MP4/H.264 CFR, zero rotation, muted, SHA256-verified and FFprobe-validated',
    'endBehavior is reject; source must be long enough for the shot',
    'embedded source audio is never used',
    'no remote media, no cross-project assets',
  ]),
});

export type StyleBackendCapability = {
  backend: StyleBackend | MediaRendererKind;
  status: 'implemented' | 'framework-available' | 'BLOCKED_CAPABILITY';
  detail: string;
};

export const STYLE_BACKEND_CAPABILITIES: readonly StyleBackendCapability[] = Object.freeze([
  {
    backend: 'canvas2d',
    status: 'implemented',
    detail:
      'Full-resolution Canvas2D via project-local modules with canvas.mode=output, or integer project pixels via canvas.mode=project-pixel. All six gallery styles use this backend.',
  },
  {
    backend: 'video',
    status: 'implemented',
    detail:
      'The existing video renderer accepts approved project video assets with hash and probe validation, and a style-driven project may bind it when the selected style declares a video media route.',
  },
  {
    backend: 'hybrid',
    status: 'implemented',
    detail:
      'The existing hybrid renderer composes approved footage with RGBA layers, and a style-driven project may bind it when the selected style declares a hybrid media route.',
  },
  {
    backend: 'parallax-2p5d',
    status: 'implemented',
    detail:
      'Asset-backed 2.5D compositor: approved PNG plates and RGBA layers on explicit depth roles with deterministic camera, parallax, atmosphere, light and optional comic treatment. Depth is layered cardboard parallax, never volumetric 3D.',
  },
  {
    backend: 'svg',
    status: 'BLOCKED_CAPABILITY',
    detail:
      'No reviewed SVG contract exists. Executing project-local SVG/HTML markup would bypass the canvas-only scene-module trust boundary; a sanitizer and capability model must be designed before enabling it.',
  },
  {
    backend: 'html',
    status: 'BLOCKED_CAPABILITY',
    detail:
      'No trusted HTML composition adapter exists. Project-local DOM markup would gain layout, font and event access outside the current module contract; not enabled in this phase.',
  },
  {
    backend: 'three',
    status: 'BLOCKED_CAPABILITY',
    detail:
      'No Three.js/WebGL renderer exists in MVFoundry. Adding one needs a reviewed GPU determinism policy, a WebGL context contract and headless SwiftShader validation; the stylised-3d-diorama demo therefore uses an isometric Canvas2D simulation, not real 3D.',
  },
]);
