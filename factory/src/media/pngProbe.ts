import {readFileSync, statSync} from 'node:fs';
import {MediaError} from '../errors';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const IEND_MARKER = Buffer.from([0x49, 0x45, 0x4e, 0x44]); // "IEND"
const MAX_WIDTH = 7680;
const MAX_HEIGHT = 4320;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_LAYER_BYTES = 64 * 1024 * 1024;
const MIN_PNG_BYTES = 45;

/** 8-bit, non-palette PNG color types accepted for ordinary still images. */
const IMAGE_COLOR_TYPES = new Set([0, 2, 4, 6]);
/** Alpha-capable PNG color types accepted for transparent layers. */
const LAYER_COLOR_TYPES = new Set([4, 6]);

export type PngMetadata = {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  hasAlpha: boolean;
};

type PngRead = {
  bytes: Buffer;
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
};

const label = (kind: 'image' | 'layer'): string =>
  kind === 'layer' ? 'Layer asset' : 'Image asset';

const colorTypeName = (colorType: number): string => {
  switch (colorType) {
    case 0:
      return 'grayscale';
    case 2:
      return 'RGB';
    case 3:
      return 'palette';
    case 4:
      return 'grayscale+alpha';
    case 6:
      return 'RGBA';
    default:
      return `unknown(colorType ${colorType})`;
  }
};

/**
 * Reads and structurally validates a PNG without running a full decoder:
 * signature, IHDR position, 8-bit channels and a terminating IEND chunk.
 * Decoder compatibility is proven by an actual render, never by this probe.
 */
const readPng = (file: string, assetId: string, kind: 'image' | 'layer'): PngRead => {
  const name = label(kind);
  const maxBytes = kind === 'layer' ? MAX_LAYER_BYTES : MAX_IMAGE_BYTES;
  let size: number;
  try {
    size = statSync(file).size;
  } catch (error) {
    throw new MediaError(
      `Unable to read ${name.toLowerCase()} ${assetId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (size > maxBytes) {
    throw new MediaError(
      `${name} ${assetId} is ${size} bytes; the supported limit is ${maxBytes} bytes`,
    );
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    throw new MediaError(
      `Unable to read ${name.toLowerCase()} ${assetId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new MediaError(`${name} ${assetId} is not a PNG file`);
  }
  if (bytes.length < 33 || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(8) !== 13) {
    throw new MediaError(`${name} ${assetId} is missing a valid PNG IHDR chunk`);
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  if (width <= 0 || height <= 0) {
    throw new MediaError(`${name} ${assetId} has invalid dimensions`);
  }
  if (width > MAX_WIDTH || height > MAX_HEIGHT) {
    throw new MediaError(
      `${name} ${assetId} dimensions ${width}x${height} exceed ${MAX_WIDTH}x${MAX_HEIGHT}`,
    );
  }
  if (bitDepth !== 8) {
    throw new MediaError(
      `${name} ${assetId} uses ${bitDepth}-bit channels; only 8-bit PNG data is supported`,
    );
  }
  if (colorType === 3) {
    throw new MediaError(
      `${name} ${assetId} is a palette PNG (color type 3); convert it to 8-bit RGB or RGBA`,
    );
  }
  const tail = bytes.subarray(Math.max(0, bytes.length - 1024));
  if (tail.indexOf(IEND_MARKER) < 0) {
    throw new MediaError(`${name} ${assetId} is truncated: the PNG has no IEND chunk`);
  }
  return {bytes, width, height, bitDepth, colorType};
};

/**
 * Validates an ordinary still image: 8-bit grayscale, RGB, grayscale-alpha or
 * RGBA PNG. Opaque photographs are accepted; transparency is optional and only
 * reported. Palette and 16-bit PNG data are refused rather than approximated.
 */
export const probeImagePng = (file: string, assetId: string): PngMetadata => {
  const image = readPng(file, assetId, 'image');
  if (!IMAGE_COLOR_TYPES.has(image.colorType)) {
    throw new MediaError(
      `Image asset ${assetId} has unsupported PNG color type ${image.colorType} (${colorTypeName(image.colorType)})`,
    );
  }
  return {
    width: image.width,
    height: image.height,
    bitDepth: image.bitDepth,
    colorType: image.colorType,
    hasAlpha: image.colorType === 4 || image.colorType === 6,
  };
};

/**
 * Validates a transparent layer image without a decoder: PNG signature, IHDR
 * dimensions and an alpha-capable color type. This is metadata validation, not
 * a security scan of arbitrary PNG decoder input.
 */
export const probeLayerPng = (file: string, assetId: string): PngMetadata => {
  const layer = readPng(file, assetId, 'layer');
  if (!LAYER_COLOR_TYPES.has(layer.colorType)) {
    throw new MediaError(
      `Layer asset ${assetId} must be an RGBA or grayscale-alpha PNG (color type 6 or 4), received ${colorTypeName(layer.colorType)}`,
    );
  }
  return {
    width: layer.width,
    height: layer.height,
    bitDepth: layer.bitDepth,
    colorType: layer.colorType,
    hasAlpha: true,
  };
};