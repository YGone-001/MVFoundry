import {readFileSync} from 'node:fs';
import {MediaError} from '../errors';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_WIDTH = 7680;
const MAX_HEIGHT = 4320;

export type PngMetadata = {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  hasAlpha: boolean;
};

/**
 * Validates a layer image without a decoder: PNG signature, IHDR dimensions
 * and an alpha-capable color type. This is metadata validation, not a security
 * scan of arbitrary PNG decoder input.
 */
export const probeLayerPng = (file: string, assetId: string): PngMetadata => {
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    throw new MediaError(
      `Unable to read layer asset ${assetId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new MediaError(`Layer asset ${assetId} is not a PNG file`);
  }
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new MediaError(`Layer asset ${assetId} is missing a PNG IHDR chunk`);
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  if (width <= 0 || height <= 0) throw new MediaError(`Layer asset ${assetId} has invalid dimensions`);
  if (width > MAX_WIDTH || height > MAX_HEIGHT) {
    throw new MediaError(
      `Layer asset ${assetId} dimensions ${width}x${height} exceed ${MAX_WIDTH}x${MAX_HEIGHT}`,
    );
  }
  if (bitDepth !== 8) {
    throw new MediaError(`Layer asset ${assetId} must use 8-bit PNG channels`);
  }
  if (colorType !== 6 && colorType !== 4) {
    throw new MediaError(
      `Layer asset ${assetId} must be an RGBA or grayscale-alpha PNG (color type 6 or 4)`,
    );
  }
  return {width, height, bitDepth, colorType, hasAlpha: true};
};
