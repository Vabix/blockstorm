import test from 'node:test';
import assert from 'node:assert/strict';
import { addPlayer, createState, MAX_PLAYERS, pressButton, step } from '../src/simulation.ts';
import { meteorsAt, quakeCracksAt, tornadoAt, tsunamiZ } from '../src/map.ts';
import type { GameState, PlayerInput } from '../src/types.ts';

function setup() { const state = createState('test-room', 'host'); const player = addPlayer(state, 'host', 'Host', '#65d7b0')!; return { state, player }; }
function simulate(state: GameState, input: PlayerInput, seconds: number, start = 0) {
  for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) step(state, new Map([['host', input]]), 1 / 60, start + (frame + 1) * 1000 / 60);
}

test('validates admission, names, colors and room capacity', () => {
  const state = createState('room', 'host');
  const player = addPlayer(state, 'host', '<Very long player name with control\u0000>', 'red')!;
  assert.equal(player.name.length, 18);
  assert.ok(!player.name.includes('<'));
  assert.equal(player.color, '#f6c453');
  assert.equal(addPlayer(state, 'host', 'duplicate', 'red'), player);
  for (let i = 1; i < MAX_PLAYERS; i++) assert.ok(addPlayer(state, `${i}`, 'friend', 'red'));
  assert.equal(addPlayer(state, 'overflow', 'friend', 'red'), undefined);
});
test('button requires a living nearby player and cannot retrigger a round', () => {
  const { state, player } = setup();
  assert.equal(pressButton(state, 'host', 100), false);
  player.x = 0; player.z = 2; player.alive = false;
  assert.equal(pressButton(state, 'host', 100), false);
  player.alive = true;
  assert.equal(pressButton(state, 'host', 100), true);
  assert.equal(state.phase, 'warning');
  assert.equal(state.phaseEndsAt, 5100);
  assert.equal(pressButton(state, 'host', 110), false);
});
test('normalizes diagonal movement and rejects non-finite input', () => {
  const { state, player } = setup(); player.x = 0; player.z = 0;
  simulate(state, { x: 1, z: 1, jump: false }, 0.5);
  assert.ok(Math.abs(Math.hypot(player.x, player.z) - 4.4) < 0.01);
  const x = player.x;
  simulate(state, { x: Infinity, z: NaN, jump: false }, 0.5);
  assert.equal(player.x, x); assert.equal(player.y, 0);
});
test('tower walls block walking, while held jump lets the player ascend the stairs', () => {
  const { state, player } = setup(); player.x = 16; player.z = 21;
  simulate(state, { x: 0, z: -1, jump: false }, 1);
  assert.ok(player.z >= 18); assert.equal(player.y, 0);
  for (let frame = 0; frame < 480 && player.z > -14; frame++) {
    step(state, new Map([['host', { x: 0, z: -1, jump: true }]]), 1 / 60, 1000 + frame * 1000 / 60);
  }
  simulate(state, { x: 0, z: 0, jump: false }, 1, 10000);
  assert.ok(player.y >= 7.9, `Expected reachable tower top; y=${player.y},z=${player.z}`);
});
test('each round scores once, respawns and waits for another button press', () => {
  const { state, player } = setup(); const friend = addPlayer(state, 'friend', 'Friend', '#79b8ff')!;
  player.x = 0; player.z = 2; pressButton(state, player.id, 0);
  step(state, new Map(), 0, 5000); assert.equal(state.phase, 'disaster');
  friend.alive = false;
  step(state, new Map(), 0, 31000); assert.equal(state.phase, 'results');
  assert.equal(player.score, 1); assert.equal(friend.score, 0);
  step(state, new Map(), 0, 32000); assert.equal(player.score, 1);
  step(state, new Map(), 0, 37000); assert.equal(state.phase, 'waiting');
  assert.ok(friend.alive); assert.equal(friend.y, 0);
  step(state, new Map(), 0, 90000); assert.equal(state.phase, 'waiting');
  for (const expected of ['earthquake', 'tsunami', 'meteors', 'tornado']) {
    player.x = 0; player.z = 2; const now = 100000 + state.round * 50000;
    assert.ok(pressButton(state, player.id, now)); assert.equal(state.disaster, expected);
    step(state, new Map(), 0, now + 45000); assert.equal(state.phase, 'waiting');
  }
});
test('deterministic tornado, quake, tsunami and meteor hazards match shared geometry', () => {
  const { state, player } = setup(); state.phase = 'disaster'; state.phaseEndsAt = 100000; state.disasterStartedAt = 0;
  let now = 1500;
  const tornado = tornadoAt(now / 1000, state.seed); player.x = tornado.x; player.z = tornado.z;
  step(state, new Map(), 0, now); assert.equal(player.alive, false);
  state.disaster = 'earthquake'; player.alive = true; player.y = 0;
  const crack = quakeCracksAt(now / 1000, state.seed)[0]; player.x = crack.x; player.z = crack.z;
  step(state, new Map(), 0, now); assert.equal(player.alive, false);
  player.alive = true; player.y = 1.2; step(state, new Map(), 0, now); assert.equal(player.alive, true);
  state.disaster = 'tsunami'; player.y = 0; player.z = tsunamiZ(15) - 1;
  step(state, new Map(), 0, 15000); assert.equal(player.alive, false);
  player.alive = true; player.y = 8; step(state, new Map(), 0, 15000); assert.equal(player.alive, true);
  state.disaster = 'meteors'; player.x = 0; player.z = 0; player.y = 0;
  step(state, new Map(), 0, 2000); assert.equal(player.alive, true);
  step(state, new Map(), 0, 2201); assert.equal(player.alive, false);
  assert.deepEqual(meteorsAt(10, 123), meteorsAt(10, 123));
});
test('falling off island respawns in lobby and eliminates during a disaster', () => {
  const { state, player } = setup(); player.x = 35; player.y = 0;
  simulate(state, { x: 0, z: 0, jump: false }, 2);
  assert.ok(player.alive); assert.ok(Math.abs(player.x) < 28);
  state.phase = 'disaster'; state.disaster = 'tsunami'; state.phaseEndsAt = 100000; state.disasterStartedAt = 100000;
  player.x = 35; player.z = 35;
  simulate(state, { x: 0, z: 0, jump: false }, 2, 5000);
  assert.equal(player.alive, false);
});
