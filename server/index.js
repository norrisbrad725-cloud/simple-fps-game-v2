import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  buildLobbyState,
  buildScoreboard,
  buildTeamScores,
  buildSnapshot,
  createPlayer,
  createRoom,
  fireWeapon,
  generateRoomCode,
  getWinner,
  getWinnerTeam,
  matchConfig,
  reload,
  removePlayerFromRoom,
  sanitizeInput,
  sanitizeProfile,
  startMatch,
  updateRoom,
} from './rules.js';

const moduleDir = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(moduleDir, '..');
const distDir = join(projectRoot, 'dist');
const port = Number.parseInt(process.env.PORT ?? '8787', 10);

export function createYardlineServer() {
  const rooms = new Map();
  const socketIndex = new Map();
  const httpServer = createServer((request, response) => {
    serveStatic(request, response);
  });
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        send(socket, { type: 'server_error', message: 'Invalid JSON message.' });
        return;
      }
      handleMessage(socket, message);
    });

    socket.on('close', () => {
      leaveCurrentRoom(socket);
    });

  });

  function handleMessage(socket, message) {
    switch (message?.type) {
      case 'create_lobby':
        createLobby(socket, message.profile);
        break;
      case 'join_lobby':
        joinLobby(socket, message.code, message.profile);
        break;
      case 'update_profile':
        updateProfile(socket, message.profile);
        break;
      case 'ready':
        setReady(socket, message.ready === true);
        break;
      case 'start_match':
        startRoomMatch(socket, message.mode);
        break;
      case 'input':
        updateInput(socket, message.input);
        break;
      case 'fire':
        handleFire(socket);
        break;
      case 'reload':
        handleReload(socket);
        break;
      case 'leave_lobby':
        leaveCurrentRoom(socket);
        break;
      default:
        send(socket, { type: 'server_error', message: 'Unknown message type.' });
    }
  }

  function createLobby(socket, profile) {
    leaveCurrentRoom(socket);
    const player = createPlayer(profile);
    const code = generateRoomCode(new Set(rooms.keys()));
    const room = createRoom(code, player);
    player.socket = socket;
    rooms.set(code, room);
    socketIndex.set(socket, { roomCode: code, playerId: player.id });
    send(socket, { type: 'lobby_created', code, playerId: player.id });
    broadcastLobby(room);
  }

  function joinLobby(socket, codeInput, profile) {
    const code = typeof codeInput === 'string' ? codeInput.trim().toUpperCase() : '';
    const room = rooms.get(code);
    if (!room || room.players.size === 0) {
      send(socket, { type: 'join_error', message: 'No lobby found for that code.' });
      return;
    }
    if (room.state !== 'lobby') {
      send(socket, { type: 'join_error', message: 'That match has already started.' });
      return;
    }
    if (room.players.size >= matchConfig.maxPlayers) {
      send(socket, { type: 'join_error', message: 'That lobby is full.' });
      return;
    }

    leaveCurrentRoom(socket);
    const player = createPlayer(profile);
    player.socket = socket;
    player.playerNumber = room.nextPlayerNumber;
    player.team = assignBalancedTeam(room);
    room.nextPlayerNumber += 1;
    room.players.set(player.id, player);
    room.emptySince = 0;
    socketIndex.set(socket, { roomCode: room.code, playerId: player.id });
    broadcastLobby(room);
  }

  function updateProfile(socket, profile) {
    const context = socketIndex.get(socket);
    if (!context) {
      send(socket, { type: 'server_error', message: 'Join or create a lobby first.' });
      return;
    }
    const room = rooms.get(context.roomCode);
    const player = room?.players.get(context.playerId);
    if (!room || !player) {
      return;
    }
    player.profile = sanitizeProfile(profile);
    player.ready = false;
    broadcastLobby(room);
  }

  function setReady(socket, ready) {
    const context = socketIndex.get(socket);
    const room = context ? rooms.get(context.roomCode) : undefined;
    const player = room?.players.get(context?.playerId ?? '');
    if (!room || !player || room.state !== 'lobby') {
      return;
    }
    player.ready = ready;
    broadcastLobby(room);
  }

  function startRoomMatch(socket, mode) {
    const context = socketIndex.get(socket);
    const room = context ? rooms.get(context.roomCode) : undefined;
    if (!room || context?.playerId !== room.hostId || room.state !== 'lobby') {
      send(socket, { type: 'server_error', message: 'Only the host can start the lobby.' });
      return;
    }
    const now = Date.now();
    startMatch(room, now, mode);
    broadcast(room, { type: 'match_start', roomCode: room.code, selfId: '', startsAt: room.startsAt, endsAt: room.endsAt, mode: room.mode }, true);
    sendSnapshots(room, now);
  }

  function updateInput(socket, input) {
    const context = socketIndex.get(socket);
    const room = context ? rooms.get(context.roomCode) : undefined;
    const player = room?.players.get(context?.playerId ?? '');
    if (!room || !player || room.state !== 'match') {
      return;
    }
    player.input = sanitizeInput(input);
  }

  function handleFire(socket) {
    const context = socketIndex.get(socket);
    const room = context ? rooms.get(context.roomCode) : undefined;
    if (!room || room.state !== 'match') {
      return;
    }
    const event = fireWeapon(room, context.playerId, Date.now());
    if (event) {
      broadcast(room, event);
      const winner = getWinner(room);
      const winnerTeam = getWinnerTeam(room);
      if (winner || winnerTeam) {
        room.state = 'ended';
        room.winnerId = winner?.id;
        room.winnerTeam = winnerTeam;
        room.endAnnounced = true;
        broadcastMatchEnd(room);
      }
    }
  }

  function handleReload(socket) {
    const context = socketIndex.get(socket);
    const room = context ? rooms.get(context.roomCode) : undefined;
    const player = room?.players.get(context?.playerId ?? '');
    if (player && room && reload(player, Date.now(), room)) {
      broadcast(room, {
        type: 'combat_event',
        kind: 'reload',
        playerId: player.id,
        weapon: player.profile.loadout.weapon,
        message: `${player.profile.name} reloading`,
      });
    }
  }

  function leaveCurrentRoom(socket) {
    const context = socketIndex.get(socket);
    if (!context) {
      return;
    }
    socketIndex.delete(socket);
    const room = rooms.get(context.roomCode);
    if (!room) {
      return;
    }
    removePlayerFromRoom(room, context.playerId);
    if (room.players.size > 0) {
      broadcastLobby(room);
    }
  }

  function broadcastLobby(room) {
    const lobby = buildLobbyState(room);
    for (const player of room.players.values()) {
      send(player.socket, { type: 'lobby_state', lobby, selfId: player.id });
    }
  }

  function broadcast(room, message, personalizeMatchStart = false) {
    for (const player of room.players.values()) {
      const output =
        personalizeMatchStart && message.type === 'match_start'
          ? { ...message, selfId: player.id }
          : message;
      send(player.socket, output);
    }
  }

  function sendSnapshots(room, now = Date.now()) {
    for (const player of room.players.values()) {
      send(player.socket, buildSnapshot(room, player.id, now));
    }
  }

  function broadcastMatchEnd(room) {
    const scoreboard = buildScoreboard(room);
    const teamScores = buildTeamScores(room);
    broadcast(room, {
      type: 'match_end',
      roomCode: room.code,
      mode: room.mode,
      winnerId: room.winnerId,
      winnerTeam: room.winnerTeam,
      scoreboard,
      teamScores,
    });
  }

  let lastTick = Date.now();
  const tickTimer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.08, (now - lastTick) / 1000);
    lastTick = now;

    for (const room of rooms.values()) {
      const events = updateRoom(room, dt, now);
      events.forEach((event) => broadcast(room, event));
      if (room.state === 'match' && now - room.lastSnapshotAt >= 1000 / matchConfig.snapshotHz) {
        room.lastSnapshotAt = now;
        sendSnapshots(room, now);
      }
      if (room.state === 'ended' && !room.endAnnounced) {
        broadcastMatchEnd(room);
        room.endAnnounced = true;
      }
    }
  }, 1000 / matchConfig.tickHz);

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms.entries()) {
      if (room.players.size === 0 && room.emptySince > 0 && now - room.emptySince > 120000) {
        rooms.delete(code);
      }
      if (room.state === 'ended' && room.players.size === 0) {
        rooms.delete(code);
      }
    }
  }, 15000);

  function close() {
    clearInterval(tickTimer);
    clearInterval(cleanupTimer);
    for (const socket of socketIndex.keys()) {
      socket.close();
    }
    wss.close();
    httpServer.close();
  }

  return { httpServer, wss, rooms, close };
}

function assignBalancedTeam(room) {
  let alpha = 0;
  let bravo = 0;
  for (const player of room.players.values()) {
    if (player.team === 'bravo') {
      bravo += 1;
    } else {
      alpha += 1;
    }
  }
  return alpha <= bravo ? 'alpha' : 'bravo';
}

function serveStatic(request, response) {
  if (!existsSync(distDir)) {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Yardline Ops server online. Run npm run dev:client for the browser client.');
    return;
  }

  const requestUrl = new URL(request.url ?? '/', 'http://localhost');
  const pathname = decodeURIComponent(requestUrl.pathname);
  const safePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let filePath = resolve(distDir, safePath);
  if (!filePath.startsWith(distDir)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(distDir, 'index.html');
  }
  const stream = createReadStream(filePath);
  stream.on('error', () => {
    response.writeHead(500);
    response.end('Could not read file.');
  });
  response.writeHead(200, { 'content-type': getMime(filePath) });
  stream.pipe(response);
}

function getMime(filePath) {
  switch (extname(filePath)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.glb':
      return 'model/gltf-binary';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

function send(socket, message) {
  if (socket?.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}

const { httpServer } = createYardlineServer();
httpServer.listen(port, () => {
  console.log(`Yardline Ops server listening on http://localhost:${port}`);
});
