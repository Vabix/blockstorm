/** All distances are world units; player y is the height of their feet. */
export const ISLAND_HALF = 28;
export const PLAYER_HEIGHT = 2.6;
export const PLAYER_RADIUS = 0.52;
export const BUTTON = { x: 0, z: 0, radius: 1.6 };

export interface Platform { id: string; x: number; z: number; w: number; d: number; top: number; color: string; }
export const PLATFORMS: Platform[] = [
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `stair-${i}`, x: 16, z: 16 - i * 3, w: 6, d: 3, top: (i + 1) * 0.8,
    color: i % 2 ? '#c2b3a0' : '#d5c7b3',
  })),
  { id: 'tower-top', x: 16, z: -14, w: 8, d: 4, top: 8, color: '#ded2bd' },
  { id: 'shelter-west', x: -17, z: -13, w: 8, d: 7, top: 1.2, color: '#bc9f77' },
  { id: 'shelter-south', x: -17, z: 13, w: 6, d: 6, top: 1, color: '#c4a887' },
];

/** Pure integer mixer, independent from Math.random and the browser clock. */
export function randomAt(seed: number, index: number): number {
  let n = (seed + Math.imul(index + 1, 0x9e3779b9)) | 0;
  n = Math.imul(n ^ (n >>> 16), 0x21f0aaad);
  n = Math.imul(n ^ (n >>> 15), 0x735a2d97);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
}

export function tornadoAt(elapsedSeconds: number, seed: number) {
  const t = Math.max(0, elapsedSeconds);
  const offset = randomAt(seed, 0) * Math.PI * 2;
  return {
    x: Math.sin(t * 0.37 + offset) * 17,
    z: Math.sin(t * 0.51 + offset * 0.7) * 18,
    radius: 3.0,
  };
}

/** Water travels from the north (-z); the flooded area is z <= the front. */
export function tsunamiZ(elapsedSeconds: number): number { return -36 + Math.max(0, elapsedSeconds) * 3.1; }
export function tsunamiHeight(_elapsedSeconds: number): number { return 6.3; }

export interface Meteor { id: number; x: number; z: number; radius: number; impactAt: number; age: number; }
export function meteorsAt(elapsedSeconds: number, seed: number): Meteor[] {
  const result: Meteor[] = [];
  const t = Math.max(0, elapsedSeconds);
  const newest = Math.floor(t / 0.8);
  for (let i = Math.max(0, newest - 4); i <= newest; i++) {
    const impactAt = i * 0.8 + 2.2;
    const age = t - impactAt;
    if (age > 0.65) continue;
    result.push({
      id: i,
      x: i === 0 ? 0 : (randomAt(seed, i * 3 + 1) * 2 - 1) * 24,
      z: i === 0 ? 0 : (randomAt(seed, i * 3 + 2) * 2 - 1) * 24,
      radius: 3.4 + randomAt(seed, i * 3 + 3) * 1.5,
      impactAt, age,
    });
  }
  return result;
}

export interface QuakeCrack { x: number; z: number; w: number; d: number; active: boolean; }
export function quakeCracksAt(elapsedSeconds: number, seed: number): QuakeCrack[] {
  const t = Math.max(0, elapsedSeconds);
  const wave = Math.floor(t / 3.2);
  const progress = t - wave * 3.2;
  // Each layout has a full second of visible warning before it can hurt.
  const active = progress >= 1 && progress < 2.85;
  const result: QuakeCrack[] = [];
  for (let i = 0; i < 5; i++) {
    const coordinate = (randomAt(seed, wave * 12 + i) * 2 - 1) * 22;
    result.push(i % 2 === 0
      ? { x: coordinate, z: 0, w: 1.8, d: 51, active }
      : { x: 0, z: coordinate, w: 51, d: 1.8, active });
  }
  return result;
}
