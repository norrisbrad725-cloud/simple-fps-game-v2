import { randomUUID } from 'node:crypto';

export const matchConfig = {
  maxPlayers: 8,
  introMs: 3000,
  durationMs: 5 * 60 * 1000,
  scoreLimit: 25,
  teamScoreLimit: 50,
  respawnMs: 3000,
  snapshotHz: 15,
  tickHz: 30,
};

export const defaultProfile = {
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

export const weaponDefinitions = {
  ar: {
    id: 'ar',
    label: 'M4 Carbine',
    damage: 23,
    fireDelayMs: 115,
    range: 55,
    spread: 0.022,
    magSize: 30,
    reserveMags: 4,
    reloadMs: 1650,
    moveMultiplier: 1,
  },
  smg: {
    id: 'smg',
    label: 'MP5 SMG',
    damage: 16,
    fireDelayMs: 72,
    range: 32,
    spread: 0.043,
    magSize: 36,
    reserveMags: 4,
    reloadMs: 1350,
    moveMultiplier: 1.08,
  },
  mg: {
    id: 'mg',
    label: 'M249 LMG',
    damage: 26,
    fireDelayMs: 142,
    range: 62,
    spread: 0.034,
    magSize: 75,
    reserveMags: 3,
    reloadMs: 2500,
    moveMultiplier: 0.88,
  },
  sniper: {
    id: 'sniper',
    label: 'M24 Sniper',
    damage: 92,
    fireDelayMs: 950,
    range: 95,
    spread: 0.008,
    magSize: 5,
    reserveMags: 5,
    reloadMs: 2100,
    moveMultiplier: 0.95,
  },
};

export const arenaBounds = {
  x1: -46,
  x2: 46,
  z1: -34,
  z2: 34,
};

export const arenaColliders = [
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

export const spawnPoints = [
  [-38, 1.7, -20],
  [38, 1.7, 20],
  [-38, 1.7, 20],
  [38, 1.7, -20],
  [-12, 1.7, -30],
  [12, 1.7, 30],
  [-28, 1.7, 4],
  [28, 1.7, -4],
];

const validWeapons = new Set(Object.keys(weaponDefinitions));
const validTacticals = new Set(['quick_hands', 'lightweight', 'armor_plate']);
const validCamos = new Set(['matte_black', 'woodland', 'desert', 'urban', 'digital', 'tiger', 'matte_gold']);
const validOptics = new Set(['iron', 'red_dot', 'holo', 'compact_2x', 'sniper_scope']);
const opticCompatibility = {
  iron: new Set(['ar', 'smg', 'mg']),
  red_dot: new Set(['ar', 'smg', 'mg']),
  holo: new Set(['ar', 'smg', 'mg']),
  compact_2x: new Set(['ar', 'mg']),
  sniper_scope: new Set(['sniper']),
};
const validModes = new Set(['ffa', 'tdm']);
const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function getDefaultOpticForWeapon(weapon) {
  return weapon === 'sniper' ? 'sniper_scope' : 'iron';
}

export function canEquipOptic(optic, weapon) {
  return validOptics.has(optic) && opticCompatibility[optic]?.has(weapon) === true;
}

export function calculateRoundCredits({ kills = 0, won = false, hits = 0 } = {}) {
  return 50 + Math.max(0, Math.floor(Number(kills) || 0)) * 25 + (won ? 100 : 0) + Math.max(0, Math.floor(Number(hits) || 0)) * 10;
}

export function sanitizeProfile(profile = defaultProfile) {
  const input = typeof profile === 'object' && profile ? profile : defaultProfile;
  const loadout = typeof input.loadout === 'object' && input.loadout ? input.loadout : defaultProfile.loadout;
  const weapon = validWeapons.has(loadout.weapon) ? loadout.weapon : defaultProfile.loadout.weapon;
  const optic = canEquipOptic(loadout.opticId, weapon) ? loadout.opticId : getDefaultOpticForWeapon(weapon);
  return {
    name: sanitizeName(input.name),
    suitColor: sanitizeHex(input.suitColor, defaultProfile.suitColor),
    accentColor: sanitizeHex(input.accentColor, defaultProfile.accentColor),
    loadout: {
      weapon,
      tactical: validTacticals.has(loadout.tactical) ? loadout.tactical : defaultProfile.loadout.tactical,
      camoId: validCamos.has(loadout.camoId) ? loadout.camoId : defaultProfile.loadout.camoId,
      opticId: optic,
    },
  };
}

export function generateRoomCode(existingCodes = new Set()) {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    let code = '';
    for (let i = 0; i < 6; i += 1) {
      code += codeAlphabet[Math.floor(Math.random() * codeAlphabet.length)];
    }
    if (!existingCodes.has(code)) {
      return code;
    }
  }
  throw new Error('Could not generate a unique room code.');
}

export function createPlayer(profile = defaultProfile) {
  const safeProfile = sanitizeProfile(profile);
  const weapon = weaponDefinitions[safeProfile.loadout.weapon];
  return {
    id: randomUUID(),
    playerNumber: 0,
    team: 'alpha',
    profile: safeProfile,
    ready: false,
    input: createEmptyInput(),
    x: 0,
    y: 1.7,
    z: 0,
    yaw: 0,
    pitch: 0,
    health: getMaxHealth(safeProfile),
    maxHealth: getMaxHealth(safeProfile),
    alive: true,
    respawnAt: 0,
    ammo: weapon.magSize,
    reserve: weapon.magSize * weapon.reserveMags,
    reloadingUntil: 0,
    lastShotAt: 0,
    kills: 0,
    deaths: 0,
    socket: undefined,
  };
}

export function createRoom(code, hostPlayer) {
  hostPlayer.playerNumber = hostPlayer.playerNumber || 1;
  hostPlayer.team = hostPlayer.team || 'alpha';
  return {
    code,
    hostId: hostPlayer.id,
    mode: 'ffa',
    state: 'lobby',
    players: new Map([[hostPlayer.id, hostPlayer]]),
    nextPlayerNumber: 2,
    createdAt: Date.now(),
    emptySince: 0,
    startsAt: 0,
    endsAt: 0,
    lastSnapshotAt: 0,
    winnerId: undefined,
    winnerTeam: undefined,
    teamKills: { alpha: 0, bravo: 0 },
    endAnnounced: false,
  };
}

export function createEmptyInput() {
  return {
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
    crouch: false,
    slide: false,
    yaw: 0,
    pitch: 0,
    ads: false,
  };
}

export function sanitizeInput(input) {
  const value = typeof input === 'object' && input ? input : {};
  return {
    forward: value.forward === true,
    backward: value.backward === true,
    left: value.left === true,
    right: value.right === true,
    sprint: value.sprint === true,
    crouch: value.crouch === true,
    slide: value.slide === true,
    yaw: clampNumber(value.yaw, -Math.PI * 2, Math.PI * 2, 0),
    pitch: clampNumber(value.pitch, -1.35, 1.35, 0),
    ads: value.ads === true,
  };
}

export function startMatch(room, now = Date.now(), mode = 'ffa') {
  room.state = 'match';
  room.mode = sanitizeMode(mode);
  room.startsAt = now + matchConfig.introMs;
  room.endsAt = room.startsAt + matchConfig.durationMs;
  room.winnerId = undefined;
  room.winnerTeam = undefined;
  room.teamKills = { alpha: 0, bravo: 0 };
  room.endAnnounced = false;
  let index = 0;
  for (const player of room.players.values()) {
    player.team = room.mode === 'tdm' ? assignTeamByIndex(index) : player.team;
    player.kills = 0;
    player.deaths = 0;
    player.ready = false;
    spawnPlayer(player, getSpawnIndex(player, index, room.mode), room.startsAt);
    index += 1;
  }
}

export function spawnPlayer(player, index = 0, now = Date.now()) {
  const point = spawnPoints[index % spawnPoints.length];
  const weapon = weaponDefinitions[player.profile.loadout.weapon];
  player.x = point[0];
  player.y = point[1];
  player.z = point[2];
  player.yaw = Math.atan2(-point[0], -point[2]);
  player.pitch = 0;
  player.health = getMaxHealth(player.profile);
  player.maxHealth = getMaxHealth(player.profile);
  player.alive = true;
  player.respawnAt = 0;
  player.ammo = weapon.magSize;
  player.reserve = weapon.magSize * weapon.reserveMags;
  player.reloadingUntil = 0;
  player.lastShotAt = now - weapon.fireDelayMs;
  player.input = {
    ...createEmptyInput(),
    yaw: player.yaw,
  };
}

export function updateRoom(room, dtSeconds, now = Date.now()) {
  if (room.state !== 'match') {
    return [];
  }
  if (now < room.startsAt) {
    return [];
  }

  const events = [];
  let spawnIndex = 0;
  for (const player of room.players.values()) {
    if (!player.alive) {
      if (player.respawnAt > 0 && now >= player.respawnAt && now < room.endsAt) {
        spawnPlayer(player, getSpawnIndex(player, spawnIndex, room.mode), now);
        events.push({
          type: 'combat_event',
          kind: 'respawn',
          playerId: player.id,
          message: `${player.profile.name} respawned`,
        });
      }
      spawnIndex += 1;
      continue;
    }
    applyReloadIfComplete(player, now);
    updateMovement(player, dtSeconds);
    spawnIndex += 1;
  }

  const winner = getWinner(room);
  const winnerTeam = getWinnerTeam(room);
  if (winner || winnerTeam || now >= room.endsAt) {
    room.state = 'ended';
    room.winnerId = winner?.id;
    room.winnerTeam = winnerTeam;
  }

  return events;
}

export function updateMovement(player, dtSeconds) {
  const input = player.input;
  player.yaw = input.yaw;
  player.pitch = input.pitch;
  const weapon = weaponDefinitions[player.profile.loadout.weapon];
  const tacticalSpeed = player.profile.loadout.tactical === 'lightweight' ? 1.1 : 1;
  const sprintSpeed = input.sprint && !input.slide ? 1.34 : 1;
  const crouchSpeed = input.slide ? 1.24 : input.crouch ? 0.58 : 1;
  const adsSpeed = input.ads && !input.slide ? 0.76 : 1;
  const speed = 7.2 * weapon.moveMultiplier * tacticalSpeed * sprintSpeed * crouchSpeed * adsSpeed;
  const forwardX = -Math.sin(player.yaw);
  const forwardZ = -Math.cos(player.yaw);
  const rightX = Math.cos(player.yaw);
  const rightZ = -Math.sin(player.yaw);
  let moveX = 0;
  let moveZ = 0;

  if (input.forward) {
    moveX += forwardX;
    moveZ += forwardZ;
  }
  if (input.backward) {
    moveX -= forwardX;
    moveZ -= forwardZ;
  }
  if (input.right) {
    moveX += rightX;
    moveZ += rightZ;
  }
  if (input.left) {
    moveX -= rightX;
    moveZ -= rightZ;
  }

  const length = Math.hypot(moveX, moveZ);
  if (length === 0) {
    return;
  }

  moveX = (moveX / length) * speed * dtSeconds;
  moveZ = (moveZ / length) * speed * dtSeconds;
  const radius = input.crouch || input.slide ? 0.36 : 0.44;
  const nextX = player.x + moveX;
  const nextZ = player.z + moveZ;

  if (!isBlocked(nextX, player.z, radius)) {
    player.x = nextX;
  }
  if (!isBlocked(player.x, nextZ, radius)) {
    player.z = nextZ;
  }
  const resolved = resolvePosition(player.x, player.z, radius);
  player.x = resolved.x;
  player.z = resolved.z;
  player.y = input.slide ? 1.02 : input.crouch ? 1.18 : 1.7;
}

export function reload(player, now = Date.now(), room) {
  const weapon = weaponDefinitions[player.profile.loadout.weapon];
  if (room?.state === 'match' && now < room.startsAt) {
    return false;
  }
  if (!player.alive || player.reloadingUntil > now || player.ammo >= weapon.magSize || player.reserve <= 0) {
    return false;
  }
  const multiplier = player.profile.loadout.tactical === 'quick_hands' ? 0.75 : 1;
  player.reloadingUntil = now + Math.round(weapon.reloadMs * multiplier);
  return true;
}

export function fireWeapon(room, shooterId, now = Date.now()) {
  const shooter = room.players.get(shooterId);
  if (!shooter || room.state !== 'match' || !shooter.alive || now < room.startsAt) {
    return undefined;
  }
  applyReloadIfComplete(shooter, now);
  const weapon = weaponDefinitions[shooter.profile.loadout.weapon];
  if (shooter.reloadingUntil > now || shooter.ammo <= 0 || now - shooter.lastShotAt < weapon.fireDelayMs) {
    return undefined;
  }

  shooter.lastShotAt = now;
  shooter.ammo -= 1;
  const origin = [shooter.x, shooter.y - 0.12, shooter.z];
  const direction = getAimDirection(shooter.yaw, shooter.pitch);
  const target = pickHitTarget(shooter, [...room.players.values()], direction, weapon, room.mode);
  const end = target
    ? [target.player.x, target.player.y - 0.2, target.player.z]
    : [
        origin[0] + direction[0] * weapon.range,
        origin[1] + direction[1] * weapon.range,
        origin[2] + direction[2] * weapon.range,
      ];

  let damage = 0;
  let killed = false;
  let message = `${shooter.profile.name} fired ${weapon.label}`;
  if (target) {
    damage = target.damage;
    target.player.health = Math.max(0, target.player.health - damage);
    message = `${shooter.profile.name} hit ${target.player.profile.name} for ${damage}`;
    if (target.player.health <= 0) {
      killed = true;
      target.player.alive = false;
      target.player.respawnAt = now + matchConfig.respawnMs;
      target.player.deaths += 1;
      shooter.kills += 1;
      if (room.mode === 'tdm') {
        room.teamKills[shooter.team] += 1;
      }
      message = `${shooter.profile.name} eliminated ${target.player.profile.name}`;
    }
  }

  return {
    type: 'combat_event',
    kind: 'shot',
    shooterId: shooter.id,
    targetId: target?.player.id,
    weapon: weapon.id,
    damage,
    killed,
    from: origin,
    to: end,
    message,
  };
}

export function buildLobbyState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    maxPlayers: matchConfig.maxPlayers,
    mode: room.mode,
    state: room.state,
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      profile: player.profile,
      ready: player.ready,
      host: player.id === room.hostId,
      playerNumber: player.playerNumber,
      team: player.team,
    })),
  };
}

export function buildSnapshot(room, selfId, now = Date.now()) {
  return {
    type: 'snapshot',
    serverTime: now,
    selfId,
    roomCode: room.code,
    mode: room.mode,
    timeRemaining: Math.max(0, Math.ceil((room.endsAt - Math.max(now, room.startsAt)) / 1000)),
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      profile: player.profile,
      playerNumber: player.playerNumber,
      team: player.team,
      x: round(player.x),
      y: round(player.y),
      z: round(player.z),
      yaw: round(player.yaw),
      pitch: round(player.pitch),
      health: Math.ceil(player.health),
      maxHealth: player.maxHealth,
      alive: player.alive,
      respawnAt: player.respawnAt,
      ammo: player.ammo,
      reserve: player.reserve,
      reloading: player.reloadingUntil > now,
      ads: player.input.ads,
      kills: player.kills,
      deaths: player.deaths,
    })),
    scoreboard: buildScoreboard(room),
    teamScores: buildTeamScores(room),
  };
}

export function buildScoreboard(room) {
  return [...room.players.values()]
    .map((player) => ({
      playerId: player.id,
      name: player.profile.name,
      kills: player.kills,
      deaths: player.deaths,
      playerNumber: player.playerNumber,
      team: player.team,
    }))
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name));
}

export function buildTeamScores(room) {
  const scores = {
    alpha: { team: 'alpha', kills: room.teamKills?.alpha ?? 0, deaths: 0 },
    bravo: { team: 'bravo', kills: room.teamKills?.bravo ?? 0, deaths: 0 },
  };
  for (const player of room.players.values()) {
    scores[player.team].deaths += player.deaths;
  }
  return [scores.alpha, scores.bravo];
}

export function getWinner(room) {
  if (room.mode === 'tdm') {
    return undefined;
  }
  let winner;
  for (const player of room.players.values()) {
    if (player.kills >= matchConfig.scoreLimit && (!winner || player.kills > winner.kills)) {
      winner = player;
    }
  }
  return winner;
}

export function getWinnerTeam(room) {
  if (room.mode !== 'tdm') {
    return undefined;
  }
  if ((room.teamKills?.alpha ?? 0) >= matchConfig.teamScoreLimit) {
    return 'alpha';
  }
  if ((room.teamKills?.bravo ?? 0) >= matchConfig.teamScoreLimit) {
    return 'bravo';
  }
  return undefined;
}

export function removePlayerFromRoom(room, playerId) {
  const removed = room.players.delete(playerId);
  if (!removed) {
    return false;
  }
  if (room.hostId === playerId) {
    room.hostId = room.players.values().next().value?.id ?? '';
  }
  if (room.players.size === 0) {
    room.emptySince = Date.now();
  }
  return true;
}

export function applyReloadIfComplete(player, now = Date.now()) {
  const weapon = weaponDefinitions[player.profile.loadout.weapon];
  if (player.reloadingUntil === 0 || player.reloadingUntil > now) {
    return;
  }
  const needed = weapon.magSize - player.ammo;
  const used = Math.min(needed, player.reserve);
  player.ammo += used;
  player.reserve -= used;
  player.reloadingUntil = 0;
}

export function isBlocked(x, z, radius = 0.44) {
  if (
    x - radius < arenaBounds.x1 ||
    x + radius > arenaBounds.x2 ||
    z - radius < arenaBounds.z1 ||
    z + radius > arenaBounds.z2
  ) {
    return true;
  }

  return arenaColliders.some(
    (rect) => x + radius > rect.x1 && x - radius < rect.x2 && z + radius > rect.z1 && z - radius < rect.z2,
  );
}

export function resolvePosition(x, z, radius = 0.44) {
  let resolvedX = clampNumber(x, arenaBounds.x1 + radius, arenaBounds.x2 - radius, 0);
  let resolvedZ = clampNumber(z, arenaBounds.z1 + radius, arenaBounds.z2 - radius, 0);
  for (let pass = 0; pass < 3; pass += 1) {
    for (const rect of arenaColliders) {
      const overlapX = Math.min(resolvedX + radius - rect.x1, rect.x2 - (resolvedX - radius));
      const overlapZ = Math.min(resolvedZ + radius - rect.z1, rect.z2 - (resolvedZ - radius));
      if (overlapX <= 0 || overlapZ <= 0) {
        continue;
      }
      if (overlapX < overlapZ) {
        resolvedX += resolvedX < (rect.x1 + rect.x2) / 2 ? -overlapX : overlapX;
      } else {
        resolvedZ += resolvedZ < (rect.z1 + rect.z2) / 2 ? -overlapZ : overlapZ;
      }
      resolvedX = clampNumber(resolvedX, arenaBounds.x1 + radius, arenaBounds.x2 - radius, resolvedX);
      resolvedZ = clampNumber(resolvedZ, arenaBounds.z1 + radius, arenaBounds.z2 - radius, resolvedZ);
    }
  }
  return { x: round(resolvedX), z: round(resolvedZ) };
}

export function hasLineOfSight(from, to) {
  return !arenaColliders.some((rect) => segmentIntersectsRect(from[0], from[2], to[0], to[2], rect));
}

function pickHitTarget(shooter, players, direction, weapon, mode = 'ffa') {
  const origin = [shooter.x, shooter.y - 0.12, shooter.z];
  let best;
  for (const target of players) {
    if (target.id === shooter.id || !target.alive || (mode === 'tdm' && target.team === shooter.team)) {
      continue;
    }
    const center = [target.x, target.y - 0.2, target.z];
    const toTarget = [center[0] - origin[0], center[1] - origin[1], center[2] - origin[2]];
    const projection = dot3(toTarget, direction);
    if (projection < 0.5 || projection > weapon.range) {
      continue;
    }
    const closest = [
      origin[0] + direction[0] * projection,
      origin[1] + direction[1] * projection,
      origin[2] + direction[2] * projection,
    ];
    const distanceFromRay = distance3(center, closest);
    const aimBonus = shooter.input.ads ? 0.55 : 1;
    const allowedRadius = 0.62 + weapon.spread * projection * aimBonus;
    if (distanceFromRay > allowedRadius || !hasLineOfSight(origin, center)) {
      continue;
    }
    const falloff = weapon.id === 'sniper' ? 1 : Math.max(0.72, 1 - projection / weapon.range * 0.24);
    const damage = Math.max(1, Math.round(weapon.damage * falloff));
    if (!best || projection < best.distance) {
      best = { player: target, distance: projection, damage };
    }
  }
  return best;
}

function getMaxHealth(profile) {
  return profile.loadout.tactical === 'armor_plate' ? 125 : 100;
}

function sanitizeMode(mode) {
  return validModes.has(mode) ? mode : 'ffa';
}

function assignTeamByIndex(index) {
  return index % 2 === 0 ? 'alpha' : 'bravo';
}

function getSpawnIndex(player, index, mode) {
  if (mode !== 'tdm') {
    return index;
  }
  const alphaSpawns = [0, 2, 4, 6];
  const bravoSpawns = [1, 3, 5, 7];
  const pool = player.team === 'alpha' ? alphaSpawns : bravoSpawns;
  return pool[index % pool.length];
}

function getAimDirection(yaw, pitch) {
  const cosPitch = Math.cos(pitch);
  return [-Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch];
}

function segmentIntersectsRect(x1, z1, x2, z2, rect) {
  if ((x1 > rect.x1 && x1 < rect.x2 && z1 > rect.z1 && z1 < rect.z2) || (x2 > rect.x1 && x2 < rect.x2 && z2 > rect.z1 && z2 < rect.z2)) {
    return true;
  }
  const edges = [
    [rect.x1, rect.z1, rect.x2, rect.z1],
    [rect.x2, rect.z1, rect.x2, rect.z2],
    [rect.x2, rect.z2, rect.x1, rect.z2],
    [rect.x1, rect.z2, rect.x1, rect.z1],
  ];
  return edges.some((edge) => segmentsIntersect(x1, z1, x2, z2, edge[0], edge[1], edge[2], edge[3]));
}

function segmentsIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const denominator = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
  if (Math.abs(denominator) < 0.0001) {
    return false;
  }
  const ua = ((dx - cx) * (az - cz) - (dz - cz) * (ax - cx)) / denominator;
  const ub = ((bx - ax) * (az - cz) - (bz - az) * (ax - cx)) / denominator;
  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}

function sanitizeName(value) {
  if (typeof value !== 'string') {
    return defaultProfile.name;
  }
  const cleaned = value.replace(/[^\w -]/g, '').trim().slice(0, 18);
  return cleaned || defaultProfile.name;
}

function sanitizeHex(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function clampNumber(value, min, max, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function distance3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
