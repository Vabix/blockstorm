export type Disaster = 'tornado' | 'earthquake' | 'tsunami' | 'meteors';
export type Phase = 'waiting' | 'warning' | 'disaster' | 'results';
export interface PlayerState { id: string; name: string; color: string; x: number; y: number; z: number; rotation: number; alive: boolean; score: number; grounded: boolean; }
export interface GameState { roomId: string; hostId: string; players: PlayerState[]; phase: Phase; disaster: Disaster; round: number; phaseEndsAt: number; disasterStartedAt: number; seed: number; tick: number; }
export interface PlayerInput { x: number; z: number; jump: boolean; }
export interface SessionOptions { roomId: string; secret: string; playerId: string; name: string; color: string; host: boolean; onState: (state: GameState) => void; onStatus: (status: string, connected: boolean) => void; }
export interface GameSession { sendInput(input: PlayerInput): void; pressButton(): void; updateProfile(name: string, color: string): void; close(): void; }
export interface SceneOptions { onInput: (input: PlayerInput) => void; onPress: () => void; onReady?: () => void; preview?: boolean; }
export interface GameScene { setState(state: GameState, localId: string): void; dispose(): void; setMuted(muted: boolean): void; }
export const DISASTERS: Record<Disaster, {name: string; instruction: string; color: string; duration: number}> = {
 tornado: {name:'TORNADO',instruction:'Trzymaj się z daleka od wiru. Cały czas się poruszaj!',color:'#c5afff',duration:26000},
 earthquake: {name:'TRZĘSIENIE ZIEMI',instruction:'Unikaj czerwonych szczelin. Wskocz na bezpieczną platformę!',color:'#ffbd68',duration:24000},
 tsunami: {name:'TSUNAMI',instruction:'Uciekaj na szczyt wieży! Nadchodzi wielka fala.',color:'#6bdcff',duration:26000},
 meteors: {name:'DESZCZ METEORÓW',instruction:'Czerwone okręgi oznaczają uderzenie. Uciekaj z ich zasięgu!',color:'#ff8872',duration:24000}
};
