import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

export const sha256File = (file: string): string =>
  createHash('sha256').update(readFileSync(file)).digest('hex');
