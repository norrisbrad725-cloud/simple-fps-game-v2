export type WeaponClass = 'ar' | 'smg' | 'mg' | 'sniper';

export type TacticalMod = 'quick_hands' | 'lightweight' | 'armor_plate';

export type CamoId = 'matte_black' | 'woodland' | 'desert' | 'urban' | 'digital' | 'tiger' | 'matte_gold';

export type OpticId = 'iron' | 'red_dot' | 'holo' | 'compact_2x' | 'sniper_scope';

export type GameMode = 'ffa' | 'tdm';

export type TeamId = 'alpha' | 'bravo';

export type BotDifficulty = 'normal' | 'hard';

export type QualityLevel = 'ultra' | 'high' | 'performance';

export interface Loadout {
  weapon: WeaponClass;
  tactical: TacticalMod;
  camoId: CamoId;
  opticId: OpticId;
}

export interface PlayerProfile {
  name: string;
  suitColor: string;
  accentColor: string;
  loadout: Loadout;
}

export interface LobbyPlayer {
  id: string;
  profile: PlayerProfile;
  ready: boolean;
  host: boolean;
  playerNumber: number;
  team: TeamId;
}

export interface LobbyState {
  code: string;
  hostId: string;
  mode: GameMode;
  players: LobbyPlayer[];
  maxPlayers: number;
  state: 'lobby' | 'match' | 'ended';
}

export interface ScoreEntry {
  playerId: string;
  name: string;
  kills: number;
  deaths: number;
  playerNumber: number;
  team: TeamId;
}

export interface TeamScore {
  team: TeamId;
  kills: number;
  deaths: number;
}

export interface UnlockDefinition {
  id: string;
  label: string;
  description: string;
  cost: number;
  unlockedByDefault: boolean;
}

export interface CamoDefinition extends UnlockDefinition {
  id: CamoId;
  pattern: 'solid' | 'woodland' | 'stripe' | 'digital' | 'metal';
  swatches: string[];
}

export interface OpticDefinition extends UnlockDefinition {
  id: OpticId;
  magnification: string;
  compatibleWeapons: WeaponClass[];
}

export interface ProgressionState {
  credits: number;
  unlockedCamos: CamoId[];
  unlockedOptics: OpticId[];
  totalKills: number;
  totalWins: number;
  roundsPlayed: number;
}

export interface RoundRewardInput {
  kills: number;
  won: boolean;
  hits?: number;
}

export interface RoundRewardResult {
  earned: number;
  base: number;
  killBonus: number;
  winBonus: number;
  hitBonus: number;
  progression: ProgressionState;
}

export interface PlayerSnapshot {
  id: string;
  profile: PlayerProfile;
  playerNumber: number;
  team: TeamId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  maxHealth: number;
  alive: boolean;
  respawnAt: number;
  ammo: number;
  reserve: number;
  reloading: boolean;
  ads: boolean;
  kills: number;
  deaths: number;
}

export interface MatchSnapshot {
  type: 'snapshot';
  serverTime: number;
  selfId: string;
  roomCode: string;
  mode: GameMode;
  timeRemaining: number;
  players: PlayerSnapshot[];
  scoreboard: ScoreEntry[];
  teamScores: TeamScore[];
}

export type CombatEvent =
  | {
      type: 'combat_event';
      kind: 'shot';
      shooterId: string;
      targetId?: string;
      weapon: WeaponClass;
      damage: number;
      killed: boolean;
      from: [number, number, number];
      to: [number, number, number];
      message: string;
    }
  | {
      type: 'combat_event';
      kind: 'respawn';
      playerId: string;
      message: string;
    }
  | {
      type: 'combat_event';
      kind: 'reload';
      playerId: string;
      weapon: WeaponClass;
      message: string;
    };

export interface InputPayload {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  crouch: boolean;
  slide: boolean;
  yaw: number;
  pitch: number;
  ads: boolean;
}

export type ClientMessage =
  | { type: 'create_lobby'; profile: PlayerProfile }
  | { type: 'join_lobby'; code: string; profile: PlayerProfile }
  | { type: 'update_profile'; profile: PlayerProfile }
  | { type: 'ready'; ready: boolean }
  | { type: 'start_match'; mode?: GameMode }
  | { type: 'input'; input: InputPayload }
  | { type: 'fire'; sequence: number }
  | { type: 'reload' }
  | { type: 'leave_lobby' };

export type ServerMessage =
  | { type: 'lobby_created'; code: string; playerId: string }
  | { type: 'lobby_state'; lobby: LobbyState; selfId: string }
  | { type: 'join_error'; message: string }
  | { type: 'match_start'; roomCode: string; selfId: string; startsAt: number; endsAt: number; mode: GameMode }
  | MatchSnapshot
  | CombatEvent
  | { type: 'match_end'; roomCode: string; mode: GameMode; winnerId?: string; winnerTeam?: TeamId; scoreboard: ScoreEntry[]; teamScores: TeamScore[] }
  | { type: 'server_error'; message: string };

export interface WeaponDefinition {
  id: WeaponClass;
  label: string;
  shortLabel: string;
  damage: number;
  fireDelayMs: number;
  range: number;
  spread: number;
  magSize: number;
  reserveMags: number;
  reloadMs: number;
  moveMultiplier: number;
  adsFov: number;
  recoil: number;
}

export interface TacticalDefinition {
  id: TacticalMod;
  label: string;
  description: string;
}

export const matchConfig = {
  maxPlayers: 8,
  introMs: 3000,
  durationMs: 5 * 60 * 1000,
  scoreLimit: 25,
  teamScoreLimit: 50,
  respawnMs: 3000,
  snapshotHz: 15,
  inputHz: 20,
};

export const defaultProfile: PlayerProfile = {
  name: 'Runner',
  suitColor: '#2d342f',
  accentColor: '#d6a24a',
  loadout: {
    weapon: 'ar',
    tactical: 'quick_hands',
    camoId: 'matte_black',
    opticId: 'iron',
  },
};

export const camoDefinitions: Record<CamoId, CamoDefinition> = {
  matte_black: {
    id: 'matte_black',
    label: 'Matte Black',
    description: 'Factory black polymer and parkerized steel.',
    cost: 0,
    unlockedByDefault: true,
    pattern: 'solid',
    swatches: ['#111315', '#24272a', '#0a0b0c'],
  },
  woodland: {
    id: 'woodland',
    label: 'Woodland',
    description: 'Muted green and brown field pattern.',
    cost: 250,
    unlockedByDefault: false,
    pattern: 'woodland',
    swatches: ['#273526', '#4c5633', '#1b2019', '#6c5736'],
  },
  desert: {
    id: 'desert',
    label: 'Desert',
    description: 'Dry tan finish with low-contrast blocks.',
    cost: 300,
    unlockedByDefault: false,
    pattern: 'digital',
    swatches: ['#8d7a58', '#b09a69', '#5d533f', '#d0bf90'],
  },
  urban: {
    id: 'urban',
    label: 'Urban',
    description: 'Gray shipyard camouflage for concrete lanes.',
    cost: 375,
    unlockedByDefault: false,
    pattern: 'digital',
    swatches: ['#2e3438', '#59636a', '#171b1d', '#858a86'],
  },
  digital: {
    id: 'digital',
    label: 'Digital',
    description: 'Compact square pattern in olive and slate.',
    cost: 450,
    unlockedByDefault: false,
    pattern: 'digital',
    swatches: ['#2c3328', '#59624d', '#1b1f20', '#77806a'],
  },
  tiger: {
    id: 'tiger',
    label: 'Tiger Stripe',
    description: 'Classic high-contrast field striping.',
    cost: 575,
    unlockedByDefault: false,
    pattern: 'stripe',
    swatches: ['#1b1d14', '#4b5a2e', '#9a8d55', '#10110d'],
  },
  matte_gold: {
    id: 'matte_gold',
    label: 'Matte Gold',
    description: 'Hard-earned brushed gold hardware finish.',
    cost: 900,
    unlockedByDefault: false,
    pattern: 'metal',
    swatches: ['#b7903f', '#6d5525', '#e2c46f', '#2b2515'],
  },
};

export const opticDefinitions: Record<OpticId, OpticDefinition> = {
  iron: {
    id: 'iron',
    label: 'Iron Sights',
    description: 'Fast factory sights with no added housing.',
    cost: 0,
    unlockedByDefault: true,
    magnification: '1x',
    compatibleWeapons: ['ar', 'smg', 'mg'],
  },
  red_dot: {
    id: 'red_dot',
    label: 'Red Dot',
    description: 'Compact reflex optic for close fights.',
    cost: 300,
    unlockedByDefault: false,
    magnification: '1x',
    compatibleWeapons: ['ar', 'smg', 'mg'],
  },
  holo: {
    id: 'holo',
    label: 'Holo Sight',
    description: 'Boxed sight picture with a sturdy hood.',
    cost: 425,
    unlockedByDefault: false,
    magnification: '1x',
    compatibleWeapons: ['ar', 'smg', 'mg'],
  },
  compact_2x: {
    id: 'compact_2x',
    label: '2x Compact',
    description: 'Short tube optic for mid-range control.',
    cost: 550,
    unlockedByDefault: false,
    magnification: '2x',
    compatibleWeapons: ['ar', 'mg'],
  },
  sniper_scope: {
    id: 'sniper_scope',
    label: 'Sniper Scope',
    description: 'Factory long-range glass for the M24.',
    cost: 0,
    unlockedByDefault: true,
    magnification: '8x',
    compatibleWeapons: ['sniper'],
  },
};

export const defaultProgression: ProgressionState = {
  credits: 0,
  unlockedCamos: ['matte_black'],
  unlockedOptics: ['iron', 'sniper_scope'],
  totalKills: 0,
  totalWins: 0,
  roundsPlayed: 0,
};

export const weaponDefinitions: Record<WeaponClass, WeaponDefinition> = {
  ar: {
    id: 'ar',
    label: 'M4 Carbine',
    shortLabel: 'AR',
    damage: 23,
    fireDelayMs: 115,
    range: 55,
    spread: 0.022,
    magSize: 30,
    reserveMags: 4,
    reloadMs: 1650,
    moveMultiplier: 1,
    adsFov: 56,
    recoil: 0.35,
  },
  smg: {
    id: 'smg',
    label: 'MP5 SMG',
    shortLabel: 'SMG',
    damage: 16,
    fireDelayMs: 72,
    range: 32,
    spread: 0.043,
    magSize: 36,
    reserveMags: 4,
    reloadMs: 1350,
    moveMultiplier: 1.08,
    adsFov: 60,
    recoil: 0.24,
  },
  mg: {
    id: 'mg',
    label: 'M249 LMG',
    shortLabel: 'MG',
    damage: 26,
    fireDelayMs: 142,
    range: 62,
    spread: 0.034,
    magSize: 75,
    reserveMags: 3,
    reloadMs: 2500,
    moveMultiplier: 0.88,
    adsFov: 54,
    recoil: 0.48,
  },
  sniper: {
    id: 'sniper',
    label: 'M24 Sniper',
    shortLabel: 'SNP',
    damage: 92,
    fireDelayMs: 950,
    range: 95,
    spread: 0.008,
    magSize: 5,
    reserveMags: 5,
    reloadMs: 2100,
    moveMultiplier: 0.95,
    adsFov: 34,
    recoil: 0.88,
  },
};

export const tacticalDefinitions: Record<TacticalMod, TacticalDefinition> = {
  quick_hands: {
    id: 'quick_hands',
    label: 'Quick Hands',
    description: 'Reload 25% faster.',
  },
  lightweight: {
    id: 'lightweight',
    label: 'Lightweight',
    description: 'Move 10% faster.',
  },
  armor_plate: {
    id: 'armor_plate',
    label: 'Armor Plate',
    description: 'Spawn with 25 bonus health.',
  },
};

export function getDefaultOpticForWeapon(weapon: WeaponClass): OpticId {
  return weapon === 'sniper' ? 'sniper_scope' : 'iron';
}

export function normalizeProgression(value: unknown): ProgressionState {
  const input = typeof value === 'object' && value ? (value as Partial<ProgressionState>) : {};
  const camos = new Set<CamoId>(defaultProgression.unlockedCamos);
  const optics = new Set<OpticId>(defaultProgression.unlockedOptics);
  for (const id of Array.isArray(input.unlockedCamos) ? input.unlockedCamos : []) {
    if (id in camoDefinitions) {
      camos.add(id as CamoId);
    }
  }
  for (const id of Array.isArray(input.unlockedOptics) ? input.unlockedOptics : []) {
    if (id in opticDefinitions) {
      optics.add(id as OpticId);
    }
  }
  return {
    credits: Math.max(0, Math.floor(Number(input.credits) || 0)),
    unlockedCamos: [...camos],
    unlockedOptics: [...optics],
    totalKills: Math.max(0, Math.floor(Number(input.totalKills) || 0)),
    totalWins: Math.max(0, Math.floor(Number(input.totalWins) || 0)),
    roundsPlayed: Math.max(0, Math.floor(Number(input.roundsPlayed) || 0)),
  };
}

export function canEquipCamo(progression: ProgressionState, camoId: CamoId): boolean {
  return progression.unlockedCamos.includes(camoId);
}

export function canEquipOptic(progression: ProgressionState, opticId: OpticId, weapon: WeaponClass): boolean {
  const optic = opticDefinitions[opticId];
  return progression.unlockedOptics.includes(opticId) && optic.compatibleWeapons.includes(weapon);
}

export function normalizeLoadout(loadout: Partial<Loadout> | undefined, progression = defaultProgression): Loadout {
  const weapon = loadout?.weapon && loadout.weapon in weaponDefinitions ? loadout.weapon : defaultProfile.loadout.weapon;
  const tactical =
    loadout?.tactical && loadout.tactical in tacticalDefinitions ? loadout.tactical : defaultProfile.loadout.tactical;
  const camoCandidate = loadout?.camoId && loadout.camoId in camoDefinitions ? loadout.camoId : defaultProfile.loadout.camoId;
  const opticCandidate = loadout?.opticId && loadout.opticId in opticDefinitions ? loadout.opticId : getDefaultOpticForWeapon(weapon);
  return {
    weapon,
    tactical,
    camoId: canEquipCamo(progression, camoCandidate) ? camoCandidate : defaultProfile.loadout.camoId,
    opticId: canEquipOptic(progression, opticCandidate, weapon) ? opticCandidate : getDefaultOpticForWeapon(weapon),
  };
}

export function calculateRoundCredits(input: RoundRewardInput): number {
  const kills = Math.max(0, Math.floor(Number(input.kills) || 0));
  const hits = Math.max(0, Math.floor(Number(input.hits) || 0));
  return 50 + kills * 25 + (input.won ? 100 : 0) + hits * 10;
}

export function awardRoundCredits(progression: ProgressionState, input: RoundRewardInput): RoundRewardResult {
  const kills = Math.max(0, Math.floor(Number(input.kills) || 0));
  const hits = Math.max(0, Math.floor(Number(input.hits) || 0));
  const base = 50;
  const killBonus = kills * 25;
  const winBonus = input.won ? 100 : 0;
  const hitBonus = hits * 10;
  const earned = base + killBonus + winBonus + hitBonus;
  return {
    earned,
    base,
    killBonus,
    winBonus,
    hitBonus,
    progression: normalizeProgression({
      ...progression,
      credits: progression.credits + earned,
      totalKills: progression.totalKills + kills,
      totalWins: progression.totalWins + (input.won ? 1 : 0),
      roundsPlayed: progression.roundsPlayed + 1,
    }),
  };
}

export const arenaBounds = {
  x1: -46,
  x2: 46,
  z1: -34,
  z2: 34,
};

export interface RectCollider {
  x1: number;
  x2: number;
  z1: number;
  z2: number;
}

export const arenaColliders: RectCollider[] = [
  { x1: -6, x2: 6, z1: -5, z2: 5 },
  { x1: -43, x2: -31, z1: -29, z2: -25 },
  { x1: -43, x2: -31, z1: -11, z2: -7 },
  { x1: -43, x2: -31, z1: 9, z2: 13 },
  { x1: -43, x2: -31, z1: 25, z2: 29 },
  { x1: 31, x2: 43, z1: -29, z2: -25 },
  { x1: 31, x2: 43, z1: -13, z2: -9 },
  { x1: 31, x2: 43, z1: 7, z2: 11 },
  { x1: 31, x2: 43, z1: 25, z2: 29 },
  { x1: -24, x2: -12, z1: -22, z2: -18 },
  { x1: -18, x2: -6, z1: 17, z2: 21 },
  { x1: 8, x2: 20, z1: -24, z2: -20 },
  { x1: 14, x2: 26, z1: 16, z2: 20 },
  { x1: -31, x2: -25, z1: 0, z2: 8 },
  { x1: 25, x2: 31, z1: -8, z2: 0 },
  { x1: -4, x2: 4, z1: -29, z2: -23 },
  { x1: -4, x2: 4, z1: 23, z2: 29 },
];

export const spawnPoints: Array<[number, number, number]> = [
  [-38, 1.7, -20],
  [38, 1.7, 20],
  [-38, 1.7, 20],
  [38, 1.7, -20],
  [-12, 1.7, -30],
  [12, 1.7, 30],
  [-28, 1.7, 4],
  [28, 1.7, -4],
];
