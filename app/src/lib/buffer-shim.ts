import {Buffer} from 'buffer';

declare global {
  // eslint-disable-next-line no-var
  var Buffer: typeof import('buffer').Buffer;
}

globalThis.Buffer ??= Buffer;

export {};
