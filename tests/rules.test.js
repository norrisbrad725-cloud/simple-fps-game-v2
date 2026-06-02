import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLobbyState,
  buildSnapshot,
  buildScoreboard,
  buildTeamScores,
  calculateRoundCredits,
  canEquipOptic,
  createPlayer,
  createRoom,
  fireWeapon,
  generateRoomCode,
  getDefaultOpticForWeapon,
  getWinnerTeam,
  reload,
  removePlayerFromRoom,
  resolvePosition,
  sanitizeProfile,
  sanitizeInput,
  startMatch,
  updateMovement,
  updateRoom,
} from '../server/rules.js';

test('room codes are six join-safe characters and avoid collisions', () => {
  const existing = new Set(['ABC123']);
  for (let i = 0; i < 50; i += 1) {
    const code = generateRoomCode(existing);
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
    assert.equal(existing.has(code), false);
    existing.add(code);
  }
});

test('profile sanitizer migrates cosmetics and blocks incompatible optics', () => {
  const oldProfile = sanitizeProfile({ name: 'Old', loadout: { weapon: 'ar', tactical: 'quick_hands' } });
  assert.equal(oldProfile.loadout.camoId, 'matte_black');
  assert.equal(oldProfile.loadout.opticId, 'iron');

  const invalidOptic = sanitizeProfile({
    name: 'Bad Scope',
    suitColor: '#222222',
    accentColor: '#dddddd',
    loadout: { weapon: 'smg', tactical: 'lightweight', camoId: 'urban', opticId: 'sniper_scope' },
  });
  assert.equal(invalidOptic.loadout.camoId, 'urban');
  assert.equal(invalidOptic.loadout.opticId, 'iron');
  assert.equal(canEquipOptic('compact_2x', 'smg'), false);
  assert.equal(getDefaultOpticForWeapon('sniper'), 'sniper_scope');
});

test('round credit rewards include base, kills, wins, and hit contribution', () => {
  assert.equal(calculateRoundCredits({ kills: 3, won: true, hits: 2 }), 245);
  assert.equal(calculateRoundCredits({ kills: -4, won: false, hits: -2 }), 50);
});

test('lobby state exposes host and transfers host when the host leaves', () => {
  const host = createPlayer({ name: 'Host', loadout: { weapon: 'ar', tactical: 'quick_hands' } });
  const guest = createPlayer({ name: 'Guest', loadout: { weapon: 'smg', tactical: 'lightweight' } });
  const room = createRoom('ROOM42', host);
  guest.playerNumber = room.nextPlayerNumber;
  guest.team = 'bravo';
  room.nextPlayerNumber += 1;
  room.players.set(guest.id, guest);

  let lobby = buildLobbyState(room);
  assert.equal(lobby.hostId, host.id);
  assert.equal(lobby.players.length, 2);
  assert.equal(lobby.players.find((player) => player.id === host.id)?.host, true);
  assert.equal(lobby.players.find((player) => player.id === host.id)?.playerNumber, 1);
  assert.equal(lobby.players.find((player) => player.id === guest.id)?.playerNumber, 2);
  assert.equal(lobby.players.find((player) => player.id === host.id)?.team, 'alpha');
  assert.equal(lobby.players.find((player) => player.id === guest.id)?.team, 'bravo');

  removePlayerFromRoom(room, host.id);
  lobby = buildLobbyState(room);
  assert.equal(lobby.hostId, guest.id);
  assert.equal(lobby.players[0].host, true);
  assert.equal(lobby.players[0].playerNumber, 2);
});

test('snapshots and scoreboard preserve player numbers', () => {
  const host = createPlayer({ name: 'Host', loadout: { weapon: 'ar', tactical: 'quick_hands' } });
  const guest = createPlayer({ name: 'Guest', loadout: { weapon: 'smg', tactical: 'lightweight' } });
  const room = createRoom('NUMBR1', host);
  guest.playerNumber = room.nextPlayerNumber;
  guest.team = 'bravo';
  room.nextPlayerNumber += 1;
  room.players.set(guest.id, guest);
  host.kills = 1;
  guest.kills = 2;

  const snapshot = buildSnapshot(room, host.id, 5000);
  assert.equal(snapshot.players.find((player) => player.id === host.id)?.playerNumber, 1);
  assert.equal(snapshot.players.find((player) => player.id === guest.id)?.playerNumber, 2);
  assert.equal(snapshot.scoreboard.find((entry) => entry.playerId === host.id)?.playerNumber, 1);
  assert.equal(snapshot.scoreboard.find((entry) => entry.playerId === guest.id)?.playerNumber, 2);
  assert.equal(snapshot.players.find((player) => player.id === host.id)?.team, 'alpha');
  assert.equal(snapshot.players.find((player) => player.id === guest.id)?.team, 'bravo');
});

test('weapon fire applies damage and awards kills', () => {
  const shooter = createPlayer({ name: 'Shooter', loadout: { weapon: 'sniper', tactical: 'quick_hands' } });
  const target = createPlayer({ name: 'Target', loadout: { weapon: 'ar', tactical: 'quick_hands' } });
  const room = createRoom('DAMAGE', shooter);
  room.players.set(target.id, target);
  startMatch(room, 1000);
  const start = room.startsAt;

  shooter.x = -10;
  shooter.z = 0;
  shooter.yaw = Math.PI / 2;
  shooter.input.yaw = Math.PI / 2;
  shooter.lastShotAt = 0;
  target.x = -18;
  target.z = 0;

  const firstShot = fireWeapon(room, shooter.id, start + 1000);
  assert.equal(firstShot?.targetId, target.id);
  assert.equal(firstShot?.damage, 92);
  assert.equal(firstShot?.killed, false);
  assert.equal(target.health, 8);

  const secondShot = fireWeapon(room, shooter.id, start + 2000);
  assert.equal(secondShot?.killed, true);
  assert.equal(target.alive, false);
  assert.equal(shooter.kills, 1);
  assert.equal(target.deaths, 1);
});

test('players respawn after the respawn timer', () => {
  const shooter = createPlayer({ name: 'Shooter', loadout: { weapon: 'sniper', tactical: 'quick_hands' } });
  const target = createPlayer({ name: 'Target', loadout: { weapon: 'ar', tactical: 'quick_hands' } });
  const room = createRoom('RESPWN', shooter);
  room.players.set(target.id, target);
  startMatch(room, 1000);
  const start = room.startsAt;

  shooter.x = -10;
  shooter.z = 0;
  shooter.yaw = Math.PI / 2;
  shooter.input.yaw = Math.PI / 2;
  shooter.lastShotAt = 0;
  target.x = -18;
  target.z = 0;

  fireWeapon(room, shooter.id, start + 1000);
  fireWeapon(room, shooter.id, start + 2000);
  assert.equal(target.alive, false);

  const events = updateRoom(room, 0.016, target.respawnAt + 1);
  assert.equal(target.alive, true);
  assert.equal(target.health, target.maxHealth);
  assert.equal(events.some((event) => event.kind === 'respawn' && event.playerId === target.id), true);
});

test('reload waits for its timer before refilling ammo', () => {
  const player = createPlayer({ name: 'Reloader', loadout: { weapon: 'ar', tactical: 'quick_hands' } });
  const room = createRoom('RELOAD', player);
  startMatch(room, 1000);
  player.ammo = 0;
  player.reserve = 30;

  assert.equal(reload(player, room.startsAt + 500, room), true);
  updateRoom(room, 0.016, room.startsAt + 800);
  assert.equal(player.ammo, 0);
  updateRoom(room, 0.016, player.reloadingUntil + 1);
  assert.equal(player.ammo, 30);
  assert.equal(player.reserve, 0);
});

test('match intro delays start and extends match end', () => {
  const player = createPlayer({ name: 'Intro', loadout: { weapon: 'ar', tactical: 'quick_hands' } });
  const room = createRoom('INTRO1', player);
  startMatch(room, 1000);

  assert.equal(room.startsAt, 1000 + 3000);
  assert.equal(room.endsAt, room.startsAt + 5 * 60 * 1000);
  assert.equal(buildSnapshot(room, player.id, 1200).timeRemaining, 300);
});

test('players cannot move, fire, or reload during match intro', () => {
  const shooter = createPlayer({ name: 'Shooter', loadout: { weapon: 'ar', tactical: 'quick_hands' } });
  const target = createPlayer({ name: 'Target', loadout: { weapon: 'ar', tactical: 'quick_hands' } });
  const room = createRoom('LOCKED', shooter);
  room.players.set(target.id, target);
  startMatch(room, 1000);

  const startX = shooter.x;
  shooter.input.forward = true;
  updateRoom(room, 1, room.startsAt - 100);

  assert.equal(shooter.x, startX);
  assert.equal(fireWeapon(room, shooter.id, room.startsAt - 50), undefined);
  shooter.ammo = 0;
  shooter.reserve = 30;
  assert.equal(reload(shooter, room.startsAt - 50, room), false);
  assert.equal(reload(shooter, room.startsAt + 1, room), true);
});

test('slide input lowers stance and moves faster without ads sprint stacking', () => {
  const walker = createPlayer({ name: 'Walker', loadout: { weapon: 'ar', tactical: 'quick_hands' } });
  const slider = createPlayer({ name: 'Slider', loadout: { weapon: 'ar', tactical: 'quick_hands' } });
  walker.x = -20;
  walker.z = -10;
  slider.x = -20;
  slider.z = -10;
  walker.input = sanitizeInput({ forward: true, yaw: 0, ads: true });
  slider.input = sanitizeInput({ forward: true, sprint: true, crouch: true, slide: true, yaw: 0, ads: true });

  updateMovement(walker, 0.25);
  updateMovement(slider, 0.25);

  assert.equal(slider.y, 1.02);
  assert.equal(slider.input.ads, true);
  assert.ok(Math.abs(slider.z) > Math.abs(walker.z));
});

test('collision resolver pushes players out of blocker volumes', () => {
  const resolved = resolvePosition(0, 0, 0.44);

  assert.equal(
    resolved.x < -6 || resolved.x > 6 || resolved.z < -5 || resolved.z > 5,
    true,
  );
});

test('scoreboard sorts by kills, then fewer deaths', () => {
  const alpha = createPlayer({ name: 'Alpha', loadout: { weapon: 'ar', tactical: 'quick_hands' } });
  const beta = createPlayer({ name: 'Beta', loadout: { weapon: 'smg', tactical: 'lightweight' } });
  const gamma = createPlayer({ name: 'Gamma', loadout: { weapon: 'mg', tactical: 'armor_plate' } });
  const room = createRoom('SCORE1', alpha);
  room.players.set(beta.id, beta);
  room.players.set(gamma.id, gamma);
  alpha.kills = 4;
  alpha.deaths = 2;
  beta.kills = 6;
  beta.deaths = 5;
  gamma.kills = 6;
  gamma.deaths = 1;

  const scoreboard = buildScoreboard(room);
  assert.deepEqual(
    scoreboard.map((entry) => entry.name),
    ['Gamma', 'Beta', 'Alpha'],
  );
});

test('team deathmatch assigns teams and scores team kills', () => {
  const alpha = createPlayer({ name: 'Alpha', loadout: { weapon: 'sniper', tactical: 'quick_hands' } });
  const bravo = createPlayer({ name: 'Bravo', loadout: { weapon: 'ar', tactical: 'quick_hands' } });
  const room = createRoom('TEAM01', alpha);
  bravo.playerNumber = room.nextPlayerNumber;
  room.nextPlayerNumber += 1;
  room.players.set(bravo.id, bravo);
  startMatch(room, 1000, 'tdm');

  assert.equal(alpha.team, 'alpha');
  assert.equal(bravo.team, 'bravo');
  alpha.x = -10;
  alpha.z = 0;
  alpha.yaw = Math.PI / 2;
  alpha.input.yaw = Math.PI / 2;
  alpha.lastShotAt = 0;
  bravo.x = -18;
  bravo.z = 0;

  fireWeapon(room, alpha.id, room.startsAt + 1000);
  const event = fireWeapon(room, alpha.id, room.startsAt + 2000);

  assert.equal(event?.killed, true);
  assert.equal(room.teamKills.alpha, 1);
  assert.equal(buildTeamScores(room).find((entry) => entry.team === 'alpha')?.kills, 1);
});

test('team deathmatch blocks friendly fire scoring and detects team winner', () => {
  const alpha = createPlayer({ name: 'Alpha', loadout: { weapon: 'sniper', tactical: 'quick_hands' } });
  const teammate = createPlayer({ name: 'Teammate', loadout: { weapon: 'ar', tactical: 'quick_hands' } });
  const room = createRoom('TEAM02', alpha);
  teammate.playerNumber = room.nextPlayerNumber;
  room.nextPlayerNumber += 1;
  room.players.set(teammate.id, teammate);
  startMatch(room, 1000, 'tdm');
  teammate.team = alpha.team;

  alpha.x = -10;
  alpha.z = 0;
  alpha.yaw = Math.PI / 2;
  alpha.input.yaw = Math.PI / 2;
  alpha.lastShotAt = 0;
  teammate.x = -18;
  teammate.z = 0;

  const event = fireWeapon(room, alpha.id, room.startsAt + 1000);
  assert.equal(event?.targetId, undefined);
  assert.equal(teammate.health, teammate.maxHealth);
  assert.equal(room.teamKills.alpha, 0);

  room.teamKills.alpha = 50;
  assert.equal(getWinnerTeam(room), 'alpha');
});
