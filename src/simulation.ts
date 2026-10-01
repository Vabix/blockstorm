import { DISASTERS, type Disaster, type GameState, type PlayerInput, type PlayerState } from './types.ts';
import { ISLAND_HALF, PLAYER_RADIUS, PLATFORMS, meteorsAt, quakeCracksAt, tornadoAt, tsunamiHeight, tsunamiZ } from './map.ts';

export const PLAYER_COLORS = ['#f6c453', '#65d7b0', '#79b8ff', '#bf9aff', '#ff8b9a', '#fb9d5d', '#91daff', '#e4ebee'] as const;
export const MAX_PLAYERS = 8;
export const MOVE_SPEED = 8.8;
export const JUMP_SPEED = 9.6;
export const GRAVITY = 25;
const DISASTER_CYCLE: Disaster[] = ['tornado', 'earthquake', 'tsunami', 'meteors'];
const velocities = new WeakMap<GameState, Map<string, number>>();

function hash(text: string): number {
  let n = 2166136261;
  for (let i = 0; i < text.length; i++) n = Math.imul(n ^ text.charCodeAt(i), 16777619);
  return n >>> 0;
}
function velocityMap(state: GameState) {
  let map = velocities.get(state);
  if (!map) { map = new Map(); velocities.set(state, map); }
  return map;
}
function spawn(player: PlayerState, index: number) {
  const angle = (index / MAX_PLAYERS) * Math.PI * 2;
  player.x = Math.sin(angle) * 6;
  player.y = 0;
  player.z = 7 + Math.cos(angle) * 3;
  player.rotation = Math.PI;
  player.alive = true;
  player.grounded = true;
}
export function createState(roomId: string, hostId: string): GameState {
  return { roomId, hostId, players: [], phase: 'waiting', disaster: 'tornado', round: 0,
    phaseEndsAt: 0, disasterStartedAt: 0, seed: hash(roomId), tick: 0 };
}
export function addPlayer(state: GameState, id: string, name: string, color: string): PlayerState | undefined {
  const existing = state.players.find(p => p.id === id);
  if (existing) return existing;
  if (!id || id.length > 96 || state.players.length >= MAX_PLAYERS) return undefined;
  const cleanName = String(name).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 18) || 'Gracz';
  const cleanColor = (PLAYER_COLORS as readonly string[]).includes(color) ? color : PLAYER_COLORS[state.players.length % PLAYER_COLORS.length];
  const player: PlayerState = { id, name: cleanName, color: cleanColor, x: 0, y: 0, z: 0,
    rotation: 0, alive: true, score: 0, grounded: true };
  spawn(player, state.players.length);
  if (state.phase === 'disaster' || state.phase === 'results') player.alive = false;
  state.players.push(player);
  velocityMap(state).set(id, 0);
  return player;
}
export function removePlayer(state: GameState, id: string): void {
  state.players = state.players.filter(p => p.id !== id);
  velocityMap(state).delete(id);
}
export function pressButton(state: GameState, playerId: string, now: number): boolean {
  const player = state.players.find(p => p.id === playerId);
  if (state.phase !== 'waiting' || !player?.alive || !Number.isFinite(now)) return false;
  if (Math.hypot(player.x, player.z) > 4 || player.y > 3 || player.y < -0.1) return false;
  state.disaster = DISASTER_CYCLE[state.round % DISASTER_CYCLE.length];
  state.round++;
  state.seed = hash(`${state.roomId}:${state.round}`);
  state.phase = 'warning';
  state.phaseEndsAt = now + 5000;
  state.disasterStartedAt = state.phaseEndsAt;
  return true;
}
function overlaps(x: number, z: number, box: {x:number;z:number;w:number;d:number}, radius = PLAYER_RADIUS) {
  return Math.abs(x - box.x) < box.w / 2 + radius && Math.abs(z - box.z) < box.d / 2 + radius;
}
function blocked(x: number, y: number, z: number) {
  return PLATFORMS.some(platform => y < platform.top - 0.07 && y + 2.6 > 0 && overlaps(x, z, platform));
}
function kill(player: PlayerState) { player.alive = false; player.grounded = false; }
function advancePhase(state: GameState, now: number) {
  if (state.phase === 'warning' && now >= state.phaseEndsAt) {
    state.phase = 'disaster';
    state.disasterStartedAt = state.phaseEndsAt;
    state.phaseEndsAt += DISASTERS[state.disaster].duration;
  }
  if (state.phase === 'disaster' && now >= state.phaseEndsAt) {
    state.phase = 'results';
    state.phaseEndsAt += 6000;
    for (const player of state.players) if (player.alive) player.score++;
  }
  if (state.phase === 'results' && now >= state.phaseEndsAt) {
    state.phase = 'waiting';
    state.phaseEndsAt = 0;
    state.players.forEach(spawn);
    velocityMap(state).clear();
  }
}
function movePlayer(state: GameState, player: PlayerState, input: PlayerInput | undefined, dt: number) {
  if (!player.alive) return;
  const map = velocityMap(state);
  let vy = map.get(player.id) || 0;
  let mx = Number.isFinite(input?.x) ? Math.max(-1, Math.min(1, input!.x)) : 0;
  let mz = Number.isFinite(input?.z) ? Math.max(-1, Math.min(1, input!.z)) : 0;
  const length = Math.hypot(mx, mz);
  if (length > 1) { mx /= length; mz /= length; }
  if (length > 0.02) player.rotation = Math.atan2(mx, mz);
  if (input?.jump === true && player.grounded) { vy = JUMP_SPEED; player.grounded = false; }
  const oldY = player.y;
  vy -= GRAVITY * dt;
  let nextY = player.y + vy * dt;
  const nextX = player.x + mx * MOVE_SPEED * dt;
  if (!blocked(nextX, nextY, player.z)) player.x = nextX;
  const nextZ = player.z + mz * MOVE_SPEED * dt;
  if (!blocked(player.x, nextY, nextZ)) player.z = nextZ;
  player.grounded = false;
  let floor = -Infinity;
  if (Math.abs(player.x) <= ISLAND_HALF && Math.abs(player.z) <= ISLAND_HALF) floor = 0;
  for (const platform of PLATFORMS) {
    if (overlaps(player.x, player.z, platform, PLAYER_RADIUS * 0.75)
      && oldY >= platform.top - 0.08 && platform.top > floor) floor = platform.top;
  }
  if (vy <= 0 && nextY <= floor && oldY >= floor - 0.08) {
    nextY = floor; vy = 0; player.grounded = true;
  }
  player.y = nextY;
  map.set(player.id, vy);
  if (player.y < -7) {
    if (state.phase === 'waiting' || state.phase === 'warning') {
      spawn(player, state.players.indexOf(player)); map.set(player.id, 0);
    } else kill(player);
  }
}
function applyDisaster(state: GameState, player: PlayerState, t: number, dt: number) {
  if (!player.alive) return;
  if (state.disaster === 'tornado') {
    const tornado = tornadoAt(t, state.seed);
    const dx = tornado.x - player.x, dz = tornado.z - player.z;
    const distance = Math.hypot(dx, dz);
    if (distance < tornado.radius + PLAYER_RADIUS && player.y < 11) { kill(player); return; }
    if (distance < 8 && player.y < 11) {
      const force = (1 - distance / 8) * 6 * dt;
      const x = player.x + dx / distance * force, z = player.z + dz / distance * force;
      if (!blocked(x, player.y, z)) { player.x = x; player.z = z; }
    }
  } else if (state.disaster === 'tsunami') {
    if (player.z < tsunamiZ(t) && player.y < tsunamiHeight(t) - 0.1) kill(player);
  } else if (state.disaster === 'earthquake') {
    if (player.y < 0.85 && quakeCracksAt(t, state.seed).some(crack => crack.active && overlaps(player.x, player.z, crack, PLAYER_RADIUS * 0.7))) kill(player);
  } else if (state.disaster === 'meteors') {
    if (meteorsAt(t, state.seed).some(meteor => meteor.age >= 0 && meteor.age <= 0.45
      && Math.hypot(player.x - meteor.x, player.z - meteor.z) <= meteor.radius + PLAYER_RADIUS)) kill(player);
  }
}
/** Host clock is epoch milliseconds; dt is elapsed seconds. Inputs never carry positions. */
export function step(state: GameState, inputs: Map<string, PlayerInput>, dt: number, now: number): void {
  if (!Number.isFinite(dt) || !Number.isFinite(now) || dt < 0) return;
  advancePhase(state, now);
  const duration = Math.min(dt, 0.1);
  const count = Math.max(1, Math.ceil(duration * 60));
  const delta = duration / count;
  for (let sub = 0; sub < count; sub++) {
    const sampleNow = now - (count - sub - 1) * delta * 1000;
    for (const player of state.players) {
      movePlayer(state, player, inputs.get(player.id), delta);
      if (state.phase === 'disaster') applyDisaster(state, player, Math.max(0, (sampleNow - state.disasterStartedAt) / 1000), delta);
    }
  }
  state.tick++;
}
export const createGameState = createState;
export const stepGame = step;
