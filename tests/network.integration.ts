/** Opt-in live broker smoke test: npx tsx tests/network.integration.ts */
import assert from 'node:assert/strict';
import { connectSession, createRoom } from '../src/network';
import type { GameSession, GameState, SessionOptions } from '../src/types';

const sessions: GameSession[] = [];
const states = new Map<string, GameState>();
const statuses = new Map<string, { message: string; connected: boolean }>();
const room = createRoom();

async function until(condition: () => boolean, description: string, timeout = 10_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${description}`);
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}

async function connect(id: string, host = false, secret = room.secret): Promise<GameSession> {
  const options: SessionOptions = {
    ...room, secret, host, playerId: id, name: id, color: '#79b8ff',
    onState: state => { states.set(id, state); },
    onStatus: (message, connected) => { statuses.set(id, { message, connected }); }
  };
  const session = await connectSession(options);
  sessions.push(session);
  return session;
}

try {
  const host = await connect('test_host', true);
  const guest = await connect('test_guest');
  await until(() => states.get('test_guest')?.players.length === 2, 'two authenticated clients see the same room');
  assert.equal(states.get('test_guest')?.hostId, 'test_host');
  console.log('PASS: two independent live MQTT sessions join one encrypted room.');

  const initialGuest = states.get('test_host')!.players.find(player => player.id === 'test_guest')!;
  const initialX = initialGuest.x;
  guest.sendInput({ x: 1, z: 0, jump: false });
  await until(() => (states.get('test_host')?.players.find(player => player.id === 'test_guest')?.x ?? 0) > initialX + 2, 'host applies guest inputs');
  guest.sendInput({ x: 0, z: 0, jump: false });
  await new Promise(resolve => setTimeout(resolve, 400));
  const onHost = states.get('test_host')!.players.find(player => player.id === 'test_guest')!;
  const onGuest = states.get('test_guest')!.players.find(player => player.id === 'test_guest')!;
  assert.ok(Math.abs(onHost.x - onGuest.x) < 0.3);
  console.log('PASS: guest movement is simulated by host and shared back.');

  host.sendInput({ x: 0, z: -1, jump: false });
  await until(() => (states.get('test_host')?.players[0].z ?? 100) < 3.6, 'host walks to the button');
  host.sendInput({ x: 0, z: 0, jump: false });
  host.pressButton();
  await until(() => states.get('test_guest')?.phase === 'warning', 'shared button press');
  assert.equal(states.get('test_guest')?.round, 1);
  assert.equal(states.get('test_guest')?.disaster, 'tornado');
  assert.equal(states.get('test_guest')?.seed, states.get('test_host')?.seed);
  await until(() => states.get('test_guest')?.phase === 'disaster', 'synchronized disaster phase');
  assert.equal(states.get('test_guest')?.disasterStartedAt, states.get('test_host')?.disasterStartedAt);
  console.log('PASS: one button press starts matching warning, tornado, seed, and clock.');

  const wrongKey = await connect('test_intruder', false, createRoom().secret);
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal(states.has('test_intruder'), false);
  assert.equal(states.get('test_host')?.players.length, 2);
  wrongKey.close();
  console.log('PASS: a client with a different room key cannot read or join the game.');

  guest.close();
  await until(() => states.get('test_host')?.players.length === 1, 'guest departure');
  states.delete('test_guest');
  await connect('test_guest');
  await until(() => states.get('test_guest')?.players.length === 2, 'guest reconnect');
  console.log('PASS: a guest can disconnect and reconnect.');

  host.close();
  await until(() => statuses.get('test_guest')?.connected === false && /zamknął/.test(statuses.get('test_guest')!.message), 'host closure notification');
  console.log('PASS: closing the host explicitly closes the room for the guest.');
} finally {
  sessions.forEach(session => session.close());
}
