const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const LOOKUP = new Uint8Array(128);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

// Standard base64 -> bytes, in plain JS: React Native has no reliable way to turn a local file
// into bytes (fetch(uri).arrayBuffer() is flaky there), but image pickers can hand over base64.
// Tolerates a "data:...;base64," prefix, whitespace and missing padding.
export function base64ToArrayBuffer(input: string): ArrayBuffer {
  const clean = input.replace(/^data:[^,]*,/, '').replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let out = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = LOOKUP[clean.charCodeAt(i)];
    const b = LOOKUP[clean.charCodeAt(i + 1)];
    const c = i + 2 < clean.length ? LOOKUP[clean.charCodeAt(i + 2)] : 0;
    const d = i + 3 < clean.length ? LOOKUP[clean.charCodeAt(i + 3)] : 0;
    bytes[out++] = (a << 2) | (b >> 4);
    if (i + 2 < clean.length) bytes[out++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < clean.length) bytes[out++] = ((c & 3) << 6) | d;
  }
  return bytes.buffer.slice(0, out);
}
