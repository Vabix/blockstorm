import mqtt, { type MqttClient } from 'mqtt';
import type { GameSession, GameState, PlayerInput, SessionOptions } from './types';
import { addPlayer, createState, pressButton as simulatePress, removePlayer, step } from './simulation';

const DEFAULT_BROKER = 'wss://test.mosquitto.org:8081/mqtt';
const MAX_WIRE_BYTES = 24_000;
const PEER_TIMEOUT = 10_000;
const HOST_TIMEOUT = 5_000;
const ZERO: PlayerInput = { x: 0, z: 0, jump: false };
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

type WireMessage = {
  v: 1; type: 'join' | 'input' | 'press' | 'leave' | 'snapshot' | 'reject' | 'closed' | 'host-offline';
  from: string; session: string; seq: number; at: number;
  name?: string; color?: string; input?: PlayerInput; state?: GameState; target?: string; reason?: string;
};

function base64(bytes: Uint8Array): string {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const result = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) result[i] = decoded.charCodeAt(i);
  return result;
}

function randomId(bytes = 16): string {
  return base64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function createRoom(): { roomId: string; secret: string } {
  return { roomId: randomId(), secret: randomId(32) };
}

function cleanInput(input: unknown): PlayerInput {
  if (!input || typeof input !== 'object') return { ...ZERO };
  const value = input as Record<string, unknown>;
  let x = typeof value.x === 'number' && Number.isFinite(value.x) ? Math.max(-1, Math.min(1, value.x)) : 0;
  let z = typeof value.z === 'number' && Number.isFinite(value.z) ? Math.max(-1, Math.min(1, value.z)) : 0;
  const length = Math.hypot(x, z);
  if (length > 1) { x /= length; z /= length; }
  return { x, z, jump: value.jump === true };
}

function validState(value: unknown, roomId: string): value is GameState {
  if (!value || typeof value !== 'object') return false;
  const state = value as GameState;
  if (state.roomId !== roomId || typeof state.hostId !== 'string' || !Array.isArray(state.players) || state.players.length > 8) return false;
  if (!['waiting', 'warning', 'disaster', 'results'].includes(state.phase) || !['tornado', 'earthquake', 'tsunami', 'meteors'].includes(state.disaster)) return false;
  if (![state.round, state.phaseEndsAt, state.disasterStartedAt, state.seed, state.tick].every(Number.isFinite)) return false;
  return state.players.every(player => player && typeof player.id === 'string' && player.id.length <= 80 && typeof player.name === 'string' && player.name.length <= 40
    && typeof player.color === 'string' && /^#[a-fA-F0-9]{6}$/.test(player.color)
    && [player.x, player.y, player.z, player.rotation, player.score].every(Number.isFinite)
    && Math.abs(player.x) < 10_000 && Math.abs(player.y) < 10_000 && Math.abs(player.z) < 10_000
    && typeof player.alive === 'boolean' && typeof player.grounded === 'boolean');
}

/** One authoritative simulation runs in the host's browser. All broker traffic is encrypted. */
export async function connectSession(options: SessionOptions): Promise<GameSession> {
  if (!/^[\w-]{16,64}$/.test(options.roomId) || !/^[\w-]{43}$/.test(options.secret)) throw new Error('Nieprawidłowy link do pokoju. Poproś gospodarza o pełny link.');
  if (!/^[\w-]{6,80}$/.test(options.playerId)) throw new Error('Nieprawidłowy identyfikator gracza. Odśwież stronę.');
  const keyBytes = fromBase64(options.secret);
  if (keyBytes.length !== 32) throw new Error('Nieprawidłowy klucz pokoju.');
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const sessionId = randomId(12);
  const upstream = `blockstorm/v1/${options.roomId}/up`;
  const downstream = `blockstorm/v1/${options.roomId}/down`;
  let sequence = 0;
  let closed = false;
  let brokerReady = false;
  let transportWasReady = false;
  let joined = options.host;
  let hostId = options.host ? options.playerId : '';
  let hostSession = '';
  let lastHostSeen = 0;
  let lastHostTick = -1;
  let input: PlayerInput = { ...ZERO };
  let lastButtonPress = 0;
  let lastStatus = '';
  let lastConnected = false;
  let reconnectAt = 0;
  let waitingSince = Date.now();
  let client: MqttClient;
  const intervals: ReturnType<typeof setInterval>[] = [];
  const peerSeen = new Map<string, number>();
  const peerInputAt = new Map<string, number>();
  const peerPressAt = new Map<string, number>();
  const peerSessions = new Map<string, string>();
  const inputs = new Map<string, PlayerInput>();
  const replay = new Map<string, number>();
  const state = options.host ? createState(options.roomId, options.playerId) : undefined;
  if (state) addPlayer(state, options.playerId, options.name, options.color);

  function status(message: string, connected: boolean): void {
    if (message === lastStatus && connected === lastConnected) return;
    lastStatus = message;
    lastConnected = connected;
    options.onStatus(message, connected);
  }

  function envelope(type: WireMessage['type'], extra: Partial<WireMessage> = {}): WireMessage {
    return { ...extra, v: 1, type, from: options.playerId, session: sessionId, seq: ++sequence, at: Date.now() };
  }

  async function encrypt(value: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: textEncoder.encode(options.roomId) }, key, textEncoder.encode(value));
    return `${base64(iv)}:${base64(new Uint8Array(encrypted))}`;
  }

  let outgoing = Promise.resolve();
  function send(type: WireMessage['type'], extra: Partial<WireMessage> = {}, force = false): Promise<void> {
    if ((!brokerReady || closed) && !force) return Promise.resolve();
    const plaintext = JSON.stringify(envelope(type, extra));
    const topic = options.host ? downstream : upstream;
    outgoing = outgoing.catch(() => undefined).then(async () => {
      const encrypted = await encrypt(plaintext);
      if (!client.connected || (closed && !force)) return;
      client.publish(topic, encrypted, { qos: 0, retain: false });
    });
    return outgoing;
  }

  function snapshot(): void {
    if (state) void send('snapshot', { state });
  }

  function join(): void {
    if (!options.host && !closed) void send('join', { name: options.name.slice(0, 18), color: options.color });
  }

  function dropPeer(id: string): void {
    if (!state) return;
    removePlayer(state, id);
    inputs.delete(id);
    peerSeen.delete(id);
    peerInputAt.delete(id);
    peerPressAt.delete(id);
    peerSessions.delete(id);
  }

  function handleMessage(message: WireMessage): void {
    if (closed || message.from === options.playerId || message.v !== 1 || typeof message.from !== 'string' || !/^[\w-]{6,80}$/.test(message.from)
      || typeof message.session !== 'string' || !/^[\w-]{8,32}$/.test(message.session) || !Number.isSafeInteger(message.seq) || message.seq < 0 || !Number.isFinite(message.at)) return;
    // Broker does not retain game state. Ignore replayed packets in this connection.
    const replayKey = `${message.from}/${message.session}`;
    if (message.type !== 'host-offline') {
      if (message.seq <= (replay.get(replayKey) ?? -1)) return;
      if (!replay.has(replayKey) && replay.size >= 64) replay.delete(replay.keys().next().value!);
      replay.set(replayKey, message.seq);
    }
    const now = Date.now();
    if (options.host && state) {
      if (message.type === 'join') {
        const existing = state.players.find(player => player.id === message.from);
        if (!existing && state.players.length >= 8) { void send('reject', { target: message.from, reason: 'Pokój jest pełny (maks. 8 graczy).' }); return; }
        if (typeof message.name !== 'string' || typeof message.color !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(message.color)) return;
        if (!existing) addPlayer(state, message.from, message.name.replace(/[<>\u0000-\u001f]/g, '').slice(0, 18), message.color);
        else { existing.name = message.name.replace(/[<>\u0000-\u001f]/g, '').slice(0, 18); existing.color = message.color; }
        peerSessions.set(message.from, message.session);
        peerSeen.set(message.from, now);
        inputs.set(message.from, { ...ZERO });
        snapshot();
      } else if (peerSessions.get(message.from) === message.session) {
        if (message.type === 'input') {
          peerSeen.set(message.from, now);
          if (now - (peerInputAt.get(message.from) ?? 0) < 30) return;
          peerInputAt.set(message.from, now);
          inputs.set(message.from, cleanInput(message.input));
        } else if (message.type === 'press') {
          peerSeen.set(message.from, now);
          if (now - (peerPressAt.get(message.from) ?? 0) < 500) return;
          peerPressAt.set(message.from, now);
          if (simulatePress(state, message.from, now)) snapshot();
        } else if (message.type === 'leave') {
          dropPeer(message.from);
          snapshot();
        }
      }
      return;
    }
    if (message.type === 'snapshot' && validState(message.state, options.roomId) && message.state.hostId === message.from) {
      if (hostId && message.from !== hostId) return;
      if (hostSession === message.session && message.state.tick < lastHostTick) return;
      if (!message.state.players.some(player => player.id === options.playerId)) {
        joined = false;
        status('Dołączanie do pokoju…', false);
        join();
        return;
      }
      hostId = message.from;
      hostSession = message.session;
      lastHostTick = message.state.tick;
      lastHostSeen = now;
      joined = true;
      status('Połączono z pokojem', true);
      options.onState(message.state);
    } else if (message.type === 'reject' && message.target === options.playerId && (!hostId || hostId === message.from)) {
      status(typeof message.reason === 'string' ? message.reason.slice(0, 160) : 'Nie można dołączyć do pokoju.', false);
      stop(false);
    } else if (hostId && message.from === hostId && message.session === hostSession) {
      if (message.type === 'closed') {
        status('Gospodarz zamknął pokój. Poproś go o nowy link.', false);
        stop(false);
      } else if (message.type === 'host-offline') {
        joined = false;
        status('Utracono połączenie z gospodarzem. Czekamy na powrót…', false);
      }
    }
  }

  let incoming = Promise.resolve();
  let pendingMessages = 0;
  function receive(topic: string, payload: Uint8Array, retained: boolean): void {
    if (closed || retained || pendingMessages >= 64 || topic !== (options.host ? upstream : downstream) || payload.length > MAX_WIRE_BYTES) return;
    const encoded = payload.toString();
    pendingMessages++;
    incoming = incoming.catch(() => undefined).then(async () => {
      if (closed) return;
      const separator = encoded.indexOf(':');
      if (separator !== 16) return;
      try {
        const iv = fromBase64(encoded.slice(0, separator));
        const ciphertext = fromBase64(encoded.slice(separator + 1));
        if (iv.length !== 12 || ciphertext.length < 16) return;
        const decoded = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: textEncoder.encode(options.roomId) }, key, ciphertext);
        const message = JSON.parse(textDecoder.decode(decoded)) as WireMessage;
        if (!message || typeof message !== 'object') return;
        handleMessage(message);
      } catch { /* Unauthenticated and malformed traffic on the public broker is ignored. */ }
    }).finally(() => { pendingMessages--; });
  }

  function stop(announce: boolean): void {
    if (closed) return;
    closed = true;
    brokerReady = false;
    intervals.forEach(clearInterval);
    if (announce && client?.connected) {
      void send(options.host ? 'closed' : 'leave', {}, true).finally(() => client.end(false));
      setTimeout(() => client.end(true), 800);
    } else client?.end(true);
  }

  const configured = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_MQTT_URL;
  const broker = configured || DEFAULT_BROKER;
  if (!broker.startsWith('wss://')) throw new Error('Serwer multiplayer musi korzystać z bezpiecznego połączenia WSS.');
  const willPayload = options.host ? await encrypt(JSON.stringify(envelope('host-offline'))) : undefined;
  status('Łączenie z serwerem multiplayer…', false);
  client = mqtt.connect(broker, {
    clientId: `bs_${sessionId}`,
    clean: true,
    connectTimeout: 12_000,
    reconnectPeriod: 1_500,
    keepalive: 10,
    resubscribe: false,
    queueQoSZero: false,
    ...(willPayload ? { will: { topic: downstream, payload: willPayload, qos: 0 as const, retain: false } } : {})
  });
  client.on('message', (topic, payload, packet) => receive(topic, payload, !!packet.retain));

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      status('Nie udało się połączyć. Sprawdź internet lub spróbuj innej sieci.', false);
      stop(false);
      reject(new Error('Serwer multiplayer nie odpowiedział. Sprawdź internet, wyłącz blokadę WebSocket lub spróbuj ponownie.'));
    }, 18_000);
    client.on('connect', () => {
      if (closed) return;
      client.subscribe(options.host ? upstream : downstream, { qos: 0 }, error => {
        if (closed) return;
        if (error) {
          status('Nie można otworzyć pokoju na serwerze. Ponawianie…', false);
          return;
        }
        brokerReady = true;
        transportWasReady = true;
        waitingSince = Date.now();
        if (state) {
          if (reconnectAt) {
            const pausedFor = Date.now() - reconnectAt;
            if (state.phaseEndsAt > 0) state.phaseEndsAt += pausedFor;
            if (state.disasterStartedAt > 0) state.disasterStartedAt += pausedFor;
          }
          reconnectAt = 0;
          status('Pokój otwarty · jesteś gospodarzem', true);
          snapshot();
        } else {
          joined = false;
          status('Szukanie gospodarza pokoju…', false);
          join();
        }
        if (!settled) { settled = true; clearTimeout(timeout); resolve(); }
      });
    });
    const disconnected = (): void => {
      if (closed) return;
      brokerReady = false;
      joined = options.host;
      if (!reconnectAt) reconnectAt = Date.now();
      if (transportWasReady) status('Połączenie przerwane. Ponowne łączenie…', false);
    };
    client.on('offline', disconnected);
    client.on('close', disconnected);
    client.on('error', () => {
      if (closed) return;
      status(transportWasReady ? 'Błąd sieci. Ponowne łączenie…' : 'Serwer nie odpowiada. Ponawianie połączenia…', false);
    });
  });

  let lastStepAt = performance.now();
  if (state) {
    intervals.push(setInterval(() => {
      const current = performance.now();
      const dt = Math.min(0.08, (current - lastStepAt) / 1000);
      lastStepAt = current;
      if (!brokerReady || closed) return;
      const now = Date.now();
      inputs.set(options.playerId, input);
      for (const [id, seenAt] of peerSeen) {
        if (now - seenAt > PEER_TIMEOUT) dropPeer(id);
        else if (now - seenAt > 400) inputs.set(id, { ...ZERO });
      }
      step(state, inputs, dt, now);
      options.onState({ ...state, players: state.players.map(player => ({ ...player })) });
    }, 1000 / 30));
    intervals.push(setInterval(snapshot, 100));
  } else {
    intervals.push(setInterval(() => {
      if (brokerReady && joined && !closed) void send('input', { input });
    }, 50));
    intervals.push(setInterval(() => {
      if (!brokerReady || closed) return;
      const now = Date.now();
      if (lastHostSeen && now - lastHostSeen > HOST_TIMEOUT) {
        joined = false;
        status('Gospodarz nie odpowiada. Gra wstrzymana — czekamy na powrót…', false);
      } else if (!joined && now - waitingSince > 15_000) {
        status('Gospodarz jest niedostępny. Musi mieć otwartą kartę z tym pokojem.', false);
      }
      if (!joined) join();
    }, 1500));
  }

  return {
    sendInput(value) { input = cleanInput(value); },
    updateProfile(name, color) {
      options.name = name.slice(0, 18);
      options.color = color;
      if (state) {
        const player = state.players.find(candidate => candidate.id === options.playerId);
        if (player) { player.name = options.name; player.color = color; snapshot(); }
      } else join();
    },
    pressButton() {
      if (closed || !brokerReady || !joined) return;
      const now = Date.now();
      if (now - lastButtonPress < 500) return;
      lastButtonPress = now;
      if (state) { if (simulatePress(state, options.playerId, now)) snapshot(); }
      else void send('press');
    },
    close() { stop(true); }
  };
}
