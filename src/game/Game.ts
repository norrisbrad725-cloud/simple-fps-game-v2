import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AudioManager } from './AudioManager';
import { ContainerYard, type YardTimeOfDay, type YardWeather } from './ContainerYard';
import { NetworkClient } from './NetworkClient';
import { PlayerController } from './PlayerController';
import {
  arenaColliders,
  awardRoundCredits,
  camoDefinitions,
  canEquipCamo,
  canEquipOptic,
  defaultProgression,
  defaultProfile,
  getDefaultOpticForWeapon,
  matchConfig,
  normalizeLoadout,
  normalizeProgression,
  opticDefinitions,
  spawnPoints,
  tacticalDefinitions,
  weaponDefinitions,
  type BotDifficulty,
  type CamoDefinition,
  type CamoId,
  type CombatEvent,
  type GameMode,
  type LobbyState,
  type MatchSnapshot,
  type OpticId,
  type PlayerProfile,
  type PlayerSnapshot,
  type ProgressionState,
  type RoundRewardResult,
  type ScoreEntry,
  type ServerMessage,
  type TacticalMod,
  type TeamScore,
  type TeamId,
  type WeaponClass,
  type QualityLevel,
} from '../shared/protocol';

type Screen = 'menu' | 'customize' | 'lobby' | 'match' | 'end';
type NetworkStatus = 'offline' | 'connecting' | 'online';

interface LocalActorState {
  id: string;
  playerNumber: number;
  profile: PlayerProfile;
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
  reloadingUntil: number;
  lastShotAt: number;
  kills: number;
  deaths: number;
  ads: boolean;
  team: TeamId;
  bot: boolean;
  moveTimer?: number;
  strafe?: number;
  coverX?: number;
  coverZ?: number;
  thinkAt?: number;
}

interface RemoteActor {
  group: THREE.Group;
  profileKey: string;
  targetX: number;
  targetZ: number;
  targetYaw: number;
}

interface BurstEffect {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  maxScale: number;
}

interface RemoteFootstepState {
  x: number;
  z: number;
  lastStepAt: number;
}

interface LocalSettings {
  mode: GameMode;
  botCount: number;
  botDifficulty: BotDifficulty;
  quality: QualityLevel;
  timeOfDay: YardTimeOfDay;
  weather: YardWeather;
}

export class Game {
  private root: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private arena: ContainerYard;
  private controller: PlayerController;
  private network: NetworkClient;
  private audio: AudioManager;
  private overlay: HTMLDivElement;
  private hud: HTMLDivElement;
  private actors = new Map<string, RemoteActor>();
  private bursts: BurstEffect[] = [];
  private weaponView = new THREE.Group();
  private profile: PlayerProfile;
  private progression: ProgressionState;
  private screen: Screen = 'menu';
  private networkStatus: NetworkStatus = 'offline';
  private lobby?: LobbyState;
  private snapshot?: MatchSnapshot;
  private selfId = '';
  private localMode = false;
  private localSelf?: LocalActorState;
  private localBots: LocalActorState[] = [];
  private localGameMode: GameMode = 'ffa';
  private localBotCount = 1;
  private localBotDifficulty: BotDifficulty = 'normal';
  private onlineMode: GameMode = 'ffa';
  private qualityLevel: QualityLevel = 'ultra';
  private timeOfDay: YardTimeOfDay = 'day';
  private weather: YardWeather = 'clear';
  private matchStartsAt = 0;
  private localEndsAt = 0;
  private localMatchOver = false;
  private lastFrame = performance.now();
  private inputTimer = 0;
  private shotSequence = 0;
  private lastFireRequestAt = 0;
  private lastReloadRequestAt = 0;
  private killFeed: string[] = [];
  private lastWeaponKey = '';
  private footstepTimer = 0;
  private previousReloading = false;
  private leadPrimed = false;
  private lastLeaderNumber?: number;
  private weaponKick = 0;
  private headBobPhase = 0;
  private headBobStrength = 0;
  private hitmarkerTimer = 0;
  private introAnnounced = false;
  private introBannerUntil = 0;
  private remoteFootsteps = new Map<string, RemoteFootstepState>();
  private lastShotAudioAt = new Map<string, number>();
  private lastReloadAudioAt = new Map<string, number>();
  private reloadVisual = 0;
  private rewardIssued = false;
  private lastRoundReward?: RoundRewardResult;
  private camoMaterials = new Map<CamoId, THREE.MeshStandardMaterial>();

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.className = 'game-root';
    this.root.innerHTML = '';
    this.progression = loadProgression();
    this.profile = loadProfile(this.progression);
    const localSettings = loadLocalSettings();
    this.localGameMode = localSettings.mode;
    this.localBotCount = localSettings.botCount;
    this.localBotDifficulty = localSettings.botDifficulty;
    this.onlineMode = localSettings.mode;
    this.qualityLevel = localSettings.quality;
    this.timeOfDay = localSettings.timeOfDay;
    this.weather = localSettings.weather;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.shadowMap.enabled = true;
    this.applyQualitySettings();
    this.root.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 140);
    this.composer = this.createComposer();
    this.arena = new ContainerYard(this.scene, this.getYardEnvironment());
    this.arena.build(this.getYardEnvironment());
    this.scene.add(this.camera);
    this.camera.add(this.weaponView);
    this.controller = new PlayerController(this.camera, this.renderer.domElement, this.arena);
    this.network = new NetworkClient();
    this.audio = new AudioManager();
    this.audio.preload();
    this.overlay = document.createElement('div');
    this.overlay.className = 'menu-shell';
    this.hud = this.createHud();
    this.root.append(this.overlay, this.hud);
    this.bindEvents();
  }

  start(): void {
    this.renderMenu();
    this.animate();
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => this.resize());
    this.network.onStatus((status) => {
      this.networkStatus = status;
      if (this.screen === 'menu') this.renderMenu();
      if (this.screen === 'lobby') this.renderLobby();
    });
    this.network.onMessage((message) => this.handleServerMessage(message));
  }

  private handleServerMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'lobby_created':
        this.selfId = message.playerId;
        break;
      case 'lobby_state':
        this.lobby = message.lobby;
        this.selfId = message.selfId;
        if (this.screen !== 'match') {
          this.renderLobby();
        }
        break;
      case 'join_error':
      case 'server_error':
        this.showToast(message.message);
        break;
      case 'match_start':
        this.selfId = message.selfId;
        this.matchStartsAt = performance.now() + Math.max(0, message.startsAt - Date.now());
        this.enterMatch();
        break;
      case 'snapshot':
        this.snapshot = message;
        this.syncFromSnapshot(message);
        break;
      case 'combat_event':
        this.handleCombatEvent(message);
        break;
      case 'match_end':
        this.renderEnd(message.scoreboard, message.winnerId, message.mode, message.winnerTeam, message.teamScores);
        break;
    }
  }

  private renderMenu(): void {
    this.screen = 'menu';
    this.hud.classList.add('hidden');
    this.overlay.classList.remove('hidden');
    const camo = camoDefinitions[this.profile.loadout.camoId];
    const optic = opticDefinitions[this.profile.loadout.opticId];
    this.overlay.innerHTML = `
      <section class="menu-card menu-card--wide">
        <div class="brand-line">
          <span class="brand-mark"></span>
          <span>Yardline Ops</span>
          <strong>${this.progression.credits} CR</strong>
        </div>
        <h1>Container Yard</h1>
        <p class="lead">Build a grounded loadout, run private online rooms, or grind credits against bots in a close-quarters shipping yard.</p>
        <div class="profile-strip">
          <span style="--swatch:${this.profile.suitColor}"></span>
          <span style="--swatch:${this.profile.accentColor}"></span>
          <strong>${escapeHtml(this.profile.name)}</strong>
          <em>${weaponDefinitions[this.profile.loadout.weapon].shortLabel} / ${optic.label} / ${camo.label}</em>
        </div>
        <div class="progress-strip">
          <div><span>Credits</span><strong>${this.progression.credits}</strong></div>
          <div><span>Total Kills</span><strong>${this.progression.totalKills}</strong></div>
          <div><span>Wins</span><strong>${this.progression.totalWins}</strong></div>
          <div><span>Rounds</span><strong>${this.progression.roundsPlayed}</strong></div>
        </div>
        <div class="quick-settings">
          <label>
            <span>Mode</span>
            <select name="mode">
              <option value="ffa" ${this.localGameMode === 'ffa' ? 'selected' : ''}>Free-for-All</option>
              <option value="tdm" ${this.localGameMode === 'tdm' ? 'selected' : ''}>Team Deathmatch</option>
            </select>
          </label>
          <label>
            <span>Bots</span>
            <input name="botCount" type="range" min="1" max="7" step="1" value="${this.localBotCount}" />
            <strong data-bot-count>${this.localBotCount}</strong>
          </label>
          <label>
            <span>Bot Skill</span>
            <select name="botDifficulty">
              <option value="normal" ${this.localBotDifficulty === 'normal' ? 'selected' : ''}>Normal</option>
              <option value="hard" ${this.localBotDifficulty === 'hard' ? 'selected' : ''}>Hard</option>
            </select>
          </label>
          <label>
            <span>Graphics</span>
            <select name="quality">
              <option value="ultra" ${this.qualityLevel === 'ultra' ? 'selected' : ''}>Ultra</option>
              <option value="high" ${this.qualityLevel === 'high' ? 'selected' : ''}>High</option>
              <option value="performance" ${this.qualityLevel === 'performance' ? 'selected' : ''}>Performance</option>
            </select>
          </label>
          <label>
            <span>Time</span>
            <select name="timeOfDay">
              <option value="day" ${this.timeOfDay === 'day' ? 'selected' : ''}>Day</option>
              <option value="night" ${this.timeOfDay === 'night' ? 'selected' : ''}>Night</option>
            </select>
          </label>
          <label>
            <span>Weather</span>
            <select name="weather">
              <option value="clear" ${this.weather === 'clear' ? 'selected' : ''}>Clear</option>
              <option value="rain" ${this.weather === 'rain' ? 'selected' : ''}>Rain</option>
            </select>
          </label>
        </div>
        <div class="menu-actions">
          <button class="primary-action" type="button" data-action="create">Create Lobby</button>
          <button class="secondary-action" type="button" data-action="singleplayer">Start Singleplayer</button>
          <button class="ghost-action" type="button" data-action="customize">Customize</button>
        </div>
        <form class="join-form">
          <input name="code" maxlength="6" autocomplete="off" placeholder="JOIN CODE" />
          <button class="ghost-action" type="submit">Join</button>
        </form>
        <div class="server-state">${this.getStatusLabel()}</div>
      </section>
    `;

    this.mustFind<HTMLButtonElement>('[data-action="create"]').addEventListener('click', () => this.createLobby());
    this.mustFind<HTMLButtonElement>('[data-action="singleplayer"]').addEventListener('click', () => this.startSingleplayer());
    this.mustFind<HTMLButtonElement>('[data-action="customize"]').addEventListener('click', () => this.renderCustomize('menu'));
    this.bindQuickSettings();
    this.mustFind<HTMLFormElement>('.join-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget as HTMLFormElement);
      const code = String(form.get('code') ?? '').trim().toUpperCase();
      if (code.length < 4) {
        this.showToast('Enter the room code first.');
        return;
      }
      this.joinLobby(code);
    });
  }

  private renderCustomize(backTo: 'menu' | 'lobby'): void {
    this.screen = 'customize';
    this.overlay.classList.remove('hidden');
    const selectedWeapon = this.profile.loadout.weapon;
    const weapons = Object.values(weaponDefinitions)
      .map(
        (weapon) => `
          <label class="option-tile">
            <input type="radio" name="weapon" value="${weapon.id}" ${this.profile.loadout.weapon === weapon.id ? 'checked' : ''} />
            <strong>${weapon.label}</strong>
            <span>${weapon.shortLabel} / ${weapon.magSize} rounds / ${weapon.damage} dmg</span>
          </label>
        `,
      )
      .join('');
    const tacticals = Object.values(tacticalDefinitions)
      .map(
        (mod) => `
          <label class="option-tile">
            <input type="radio" name="tactical" value="${mod.id}" ${this.profile.loadout.tactical === mod.id ? 'checked' : ''} />
            <strong>${mod.label}</strong>
            <span>${mod.description}</span>
          </label>
        `,
      )
      .join('');
    const camos = Object.values(camoDefinitions)
      .map((camo) => {
        const unlocked = canEquipCamo(this.progression, camo.id);
        const selected = this.profile.loadout.camoId === camo.id;
        return `
          <label class="unlock-tile ${unlocked ? '' : 'unlock-tile--locked'}">
            <input type="radio" name="camoId" value="${camo.id}" ${selected ? 'checked' : ''} ${unlocked ? '' : 'disabled'} />
            <span class="camo-swatches">${camo.swatches.map((swatch) => `<i style="--swatch:${swatch}"></i>`).join('')}</span>
            <strong>${camo.label}</strong>
            <small>${camo.description}</small>
            ${
              unlocked
                ? '<em>Owned</em>'
                : `<button type="button" data-unlock-camo="${camo.id}" ${this.progression.credits >= camo.cost ? '' : 'disabled'}>${camo.cost} CR</button>`
            }
          </label>
        `;
      })
      .join('');
    const optics = Object.values(opticDefinitions)
      .map((optic) => {
        const compatible = optic.compatibleWeapons.includes(selectedWeapon);
        const unlocked = this.progression.unlockedOptics.includes(optic.id);
        const selected = this.profile.loadout.opticId === optic.id;
        const disabled = !unlocked || !compatible;
        const state = compatible ? (unlocked ? 'Owned' : `${optic.cost} CR`) : 'Not for this weapon';
        return `
          <label class="unlock-tile ${disabled ? 'unlock-tile--locked' : ''}">
            <input type="radio" name="opticId" value="${optic.id}" ${selected ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
            <span class="optic-mark" data-optic="${optic.id}">${optic.magnification}</span>
            <strong>${optic.label}</strong>
            <small>${optic.description}</small>
            ${
              unlocked || !compatible
                ? `<em>${state}</em>`
                : `<button type="button" data-unlock-optic="${optic.id}" ${this.progression.credits >= optic.cost ? '' : 'disabled'}>${state}</button>`
            }
          </label>
        `;
      })
      .join('');

    this.overlay.innerHTML = `
      <form class="menu-card menu-card--wide customize-form armory-form">
        <div class="card-header">
          <div>
            <span class="eyebrow">Armory</span>
            <h2>Loadout Workshop</h2>
          </div>
          <div class="armory-wallet"><span>Credits</span><strong>${this.progression.credits}</strong></div>
          <button class="icon-action" type="button" data-action="back" aria-label="Back">X</button>
        </div>
        <div class="armory-layout">
          <div class="armory-column">
            <span class="eyebrow">Operator</span>
            <label class="field-label">
              <span>Name</span>
              <input name="name" maxlength="18" autocomplete="off" value="${escapeHtml(this.profile.name)}" />
            </label>
            <div class="color-row">
              <label class="field-label"><span>Uniform</span><input type="color" name="suitColor" value="${this.profile.suitColor}" /></label>
              <label class="field-label"><span>Patch</span><input type="color" name="accentColor" value="${this.profile.accentColor}" /></label>
            </div>
            <span class="eyebrow">Weapon Class</span>
            <div class="option-grid">${weapons}</div>
            <span class="eyebrow">Tactical Mod</span>
            <div class="option-grid option-grid--mods">${tacticals}</div>
          </div>
          <div class="armory-column">
            <span class="eyebrow">Camos</span>
            <div class="unlock-grid">${camos}</div>
            <span class="eyebrow">Optics</span>
            <div class="unlock-grid unlock-grid--optics">${optics}</div>
          </div>
        </div>
        <span class="eyebrow">Connection</span>
        <label class="field-label">
          <span>Custom WebSocket Server URL</span>
          <input name="customWsUrl" placeholder="Auto-detect (wss://...)" value="${escapeHtml(localStorage.getItem('yardline-custom-ws-url') ?? '')}" />
        </label>
        <div class="menu-actions">
          <button class="primary-action" type="submit">Save Loadout</button>
          <button class="ghost-action" type="button" data-action="cancel">Cancel</button>
        </div>
      </form>
    `;

    this.mustFind<HTMLButtonElement>('[data-action="back"]').addEventListener('click', () => this.goBackFromCustomize(backTo));
    this.mustFind<HTMLButtonElement>('[data-action="cancel"]').addEventListener('click', () => this.goBackFromCustomize(backTo));
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-unlock-camo]').forEach((button) => {
      button.addEventListener('click', () => this.unlockCamo(button.dataset.unlockCamo as CamoId, backTo));
    });
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-unlock-optic]').forEach((button) => {
      button.addEventListener('click', () => this.unlockOptic(button.dataset.unlockOptic as OpticId, backTo));
    });
    this.mustFind<HTMLFormElement>('.customize-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget as HTMLFormElement);
      const weapon = String(form.get('weapon') ?? defaultProfile.loadout.weapon) as WeaponClass;
      this.profile = {
        name: cleanName(String(form.get('name') ?? defaultProfile.name)),
        suitColor: String(form.get('suitColor') ?? defaultProfile.suitColor),
        accentColor: String(form.get('accentColor') ?? defaultProfile.accentColor),
        loadout: normalizeLoadout(
          {
            weapon,
          tactical: String(form.get('tactical') ?? defaultProfile.loadout.tactical) as TacticalMod,
            camoId: String(form.get('camoId') ?? defaultProfile.loadout.camoId) as CamoId,
            opticId: String(form.get('opticId') ?? getDefaultOpticForWeapon(weapon)) as OpticId,
          },
          this.progression,
        ),
      };
      this.saveProfile(true);
      const customWsUrl = String(form.get('customWsUrl') ?? '').trim();
      if (customWsUrl) {
        localStorage.setItem('yardline-custom-ws-url', customWsUrl);
      } else {
        localStorage.removeItem('yardline-custom-ws-url');
      }
      this.goBackFromCustomize(backTo);
    });
  }

  private unlockCamo(camoId: CamoId, backTo: 'menu' | 'lobby'): void {
    const camo = camoDefinitions[camoId];
    if (!camo || this.progression.unlockedCamos.includes(camoId)) {
      return;
    }
    if (this.progression.credits < camo.cost) {
      this.showToast('Not enough credits for that camo.');
      return;
    }
    this.progression = normalizeProgression({
      ...this.progression,
      credits: this.progression.credits - camo.cost,
      unlockedCamos: [...this.progression.unlockedCamos, camoId],
    });
    this.profile = { ...this.profile, loadout: { ...this.profile.loadout, camoId } };
    this.saveProgression();
    this.saveProfile(true);
    this.renderCustomize(backTo);
  }

  private unlockOptic(opticId: OpticId, backTo: 'menu' | 'lobby'): void {
    const optic = opticDefinitions[opticId];
    if (!optic || this.progression.unlockedOptics.includes(opticId)) {
      return;
    }
    if (this.progression.credits < optic.cost) {
      this.showToast('Not enough credits for that optic.');
      return;
    }
    this.progression = normalizeProgression({
      ...this.progression,
      credits: this.progression.credits - optic.cost,
      unlockedOptics: [...this.progression.unlockedOptics, opticId],
    });
    if (canEquipOptic(this.progression, opticId, this.profile.loadout.weapon)) {
      this.profile = { ...this.profile, loadout: { ...this.profile.loadout, opticId } };
    }
    this.saveProgression();
    this.saveProfile(true);
    this.renderCustomize(backTo);
  }

  private saveProfile(notifyLobby = false): void {
    this.profile = { ...this.profile, loadout: normalizeLoadout(this.profile.loadout, this.progression) };
    localStorage.setItem('matrix-fps-profile', JSON.stringify(this.profile));
    if (notifyLobby && this.lobby && this.screen !== 'match') {
      this.network.send({ type: 'update_profile', profile: this.profile });
    }
  }

  private saveProgression(): void {
    localStorage.setItem('yardline-progression', JSON.stringify(this.progression));
  }

  private renderLobby(): void {
    this.screen = 'lobby';
    this.hud.classList.add('hidden');
    this.overlay.classList.remove('hidden');
    const lobby = this.lobby;
    if (!lobby) {
      this.overlay.innerHTML = `
        <section class="menu-card">
          <span class="eyebrow">Lobby</span>
          <h2>Connecting</h2>
          <p class="lead">Opening a path to the multiplayer server.</p>
          <div class="server-state">${this.getStatusLabel()}</div>
        </section>
      `;
      return;
    }
    const self = lobby.players.find((player) => player.id === this.selfId);
    const isHost = self?.host === true;
    const playerRows = lobby.players
      .map(
        (player) => `
          <div class="lobby-player">
            <span class="player-swatch" style="--suit:${player.profile.suitColor};--accent:${player.profile.accentColor}"></span>
            <strong>${escapeHtml(player.profile.name)}</strong>
            <span>${weaponDefinitions[player.profile.loadout.weapon].shortLabel} / ${
              opticDefinitions[player.profile.loadout.opticId]?.label ?? opticDefinitions[getDefaultOpticForWeapon(player.profile.loadout.weapon)].label
            } / ${player.team.toUpperCase()}</span>
            <em>${player.host ? 'HOST' : player.ready ? 'READY' : 'WAITING'}</em>
          </div>
        `,
      )
      .join('');

    this.overlay.innerHTML = `
      <section class="menu-card menu-card--wide lobby-card">
        <div class="card-header">
          <div>
            <span class="eyebrow">Private Lobby</span>
            <h2>${lobby.code}</h2>
          </div>
          <div class="server-state">${this.getStatusLabel()}</div>
        </div>
        <div class="lobby-code">
          <span>Join Code</span>
          <strong>${lobby.code}</strong>
        </div>
        ${
          isHost
            ? `<label class="lobby-mode">
                <span>Mode</span>
                <select name="onlineMode">
                  <option value="ffa" ${this.onlineMode === 'ffa' ? 'selected' : ''}>Free-for-All</option>
                  <option value="tdm" ${this.onlineMode === 'tdm' ? 'selected' : ''}>Team Deathmatch</option>
                </select>
              </label>`
            : `<div class="lobby-mode"><span>Mode</span><strong>${lobby.mode === 'tdm' ? 'Team Deathmatch' : 'Free-for-All'}</strong></div>`
        }
        <div class="lobby-list">${playerRows}</div>
        <div class="menu-actions">
          <button class="primary-action" type="button" data-action="start" ${isHost ? '' : 'disabled'}>Start Match</button>
          <button class="ghost-action" type="button" data-action="ready">${self?.ready ? 'Unready' : 'Ready'}</button>
          <button class="ghost-action" type="button" data-action="customize">Customize</button>
          <button class="ghost-action" type="button" data-action="leave">Leave</button>
        </div>
        <p class="fine-print">Share the code with players on any internet-reachable deployment of this server.</p>
      </section>
    `;

    this.mustFind<HTMLButtonElement>('[data-action="start"]').addEventListener('click', () => {
      if (isHost) {
        const mode = this.overlay.querySelector<HTMLSelectElement>('select[name="onlineMode"]')?.value as GameMode | undefined;
        this.onlineMode = mode === 'tdm' ? 'tdm' : 'ffa';
        this.saveLocalSettings();
        this.network.send({ type: 'start_match', mode: this.onlineMode });
      }
    });
    this.mustFind<HTMLButtonElement>('[data-action="ready"]').addEventListener('click', () => {
      this.network.send({ type: 'ready', ready: self?.ready !== true });
    });
    this.mustFind<HTMLButtonElement>('[data-action="customize"]').addEventListener('click', () => this.renderCustomize('lobby'));
    this.mustFind<HTMLButtonElement>('[data-action="leave"]').addEventListener('click', () => {
      this.network.send({ type: 'leave_lobby' });
      this.lobby = undefined;
      this.selfId = '';
      this.renderMenu();
    });
  }

  private bindQuickSettings(): void {
    const mode = this.overlay.querySelector<HTMLSelectElement>('select[name="mode"]');
    const botCount = this.overlay.querySelector<HTMLInputElement>('input[name="botCount"]');
    const botCountLabel = this.overlay.querySelector<HTMLElement>('[data-bot-count]');
    const botDifficulty = this.overlay.querySelector<HTMLSelectElement>('select[name="botDifficulty"]');
    const quality = this.overlay.querySelector<HTMLSelectElement>('select[name="quality"]');
    const timeOfDay = this.overlay.querySelector<HTMLSelectElement>('select[name="timeOfDay"]');
    const weather = this.overlay.querySelector<HTMLSelectElement>('select[name="weather"]');
    const sync = () => {
      if (botCountLabel && botCount) {
        botCountLabel.textContent = botCount.value;
      }
      this.readQuickSettings();
    };
    mode?.addEventListener('change', sync);
    botCount?.addEventListener('input', sync);
    botDifficulty?.addEventListener('change', sync);
    quality?.addEventListener('change', sync);
    timeOfDay?.addEventListener('change', sync);
    weather?.addEventListener('change', sync);
  }

  private readQuickSettings(): void {
    const modeValue = this.overlay.querySelector<HTMLSelectElement>('select[name="mode"]')?.value;
    const botCountValue = Number(this.overlay.querySelector<HTMLInputElement>('input[name="botCount"]')?.value);
    const botDifficultyValue = this.overlay.querySelector<HTMLSelectElement>('select[name="botDifficulty"]')?.value;
    const qualityValue = this.overlay.querySelector<HTMLSelectElement>('select[name="quality"]')?.value;
    const timeOfDayValue = this.overlay.querySelector<HTMLSelectElement>('select[name="timeOfDay"]')?.value;
    const weatherValue = this.overlay.querySelector<HTMLSelectElement>('select[name="weather"]')?.value;
    this.localGameMode = modeValue === 'tdm' ? 'tdm' : 'ffa';
    this.onlineMode = this.localGameMode;
    this.localBotCount = Number.isFinite(botCountValue) ? THREE.MathUtils.clamp(Math.round(botCountValue), 1, 7) : 1;
    this.localBotDifficulty = botDifficultyValue === 'hard' ? 'hard' : 'normal';
    this.qualityLevel = qualityValue === 'performance' ? 'performance' : qualityValue === 'high' ? 'high' : 'ultra';
    this.timeOfDay = timeOfDayValue === 'night' ? 'night' : 'day';
    this.weather = weatherValue === 'rain' ? 'rain' : 'clear';
    this.applyQualitySettings();
    this.saveLocalSettings();
  }

  private saveLocalSettings(): void {
    const settings: LocalSettings = {
      mode: this.localGameMode,
      botCount: this.localBotCount,
      botDifficulty: this.localBotDifficulty,
      quality: this.qualityLevel,
      timeOfDay: this.timeOfDay,
      weather: this.weather,
    };
    localStorage.setItem('yardline-local-settings', JSON.stringify(settings));
  }

  private applyQualitySettings(): void {
    const cap = this.qualityLevel === 'ultra' ? 1.75 : this.qualityLevel === 'high' ? 1.35 : 1;
    const ratio = Math.min(window.devicePixelRatio, cap);
    this.renderer.setPixelRatio(ratio);
    this.renderer.shadowMap.enabled = this.qualityLevel !== 'performance';
    this.renderer.shadowMap.type = this.qualityLevel === 'ultra' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.toneMappingExposure = this.qualityLevel === 'performance' ? 0.98 : this.qualityLevel === 'high' ? 1.02 : 1.08;
    this.composer?.setPixelRatio(ratio);
    this.composer?.setSize(window.innerWidth, window.innerHeight);
    this.arena?.setEnvironment(this.getYardEnvironment());
  }

  private getYardEnvironment() {
    return {
      timeOfDay: this.timeOfDay,
      weather: this.weather,
      quality: this.qualityLevel,
    };
  }

  private renderEnd(
    scoreboard: ScoreEntry[],
    winnerId?: string,
    mode: GameMode = this.localGameMode,
    winnerTeam?: TeamId,
    teamScores: TeamScore[] = this.buildLocalTeamScores(),
  ): void {
    this.screen = 'end';
    document.exitPointerLock();
    this.hud.classList.add('hidden');
    this.overlay.classList.remove('hidden');
    const winner = scoreboard.find((entry) => entry.playerId === winnerId) ?? scoreboard[0];
    const winnerLabel =
      mode === 'tdm'
        ? `${formatTeamName(winnerTeam ?? teamScores.sort((a, b) => b.kills - a.kills)[0]?.team ?? 'alpha')} wins`
        : winner
          ? `${escapeHtml(winner.name)} wins`
          : 'No winner';
    const rows = scoreboard
      .map(
        (entry, index) => `
          <div class="score-row">
            <span>${index + 1}</span>
            <strong>${escapeHtml(entry.name)}</strong>
            <small>${formatTeamName(entry.team)}</small>
            <em>${entry.kills} / ${entry.deaths}</em>
          </div>
        `,
      )
      .join('');
    const reward = this.awardMatchCredits(scoreboard, winnerId, mode, winnerTeam);
    const rewardHtml = reward
      ? `
        <div class="reward-panel">
          <span>Credits Earned</span>
          <strong>+${reward.earned} CR</strong>
          <em>Base ${reward.base} / Kills ${reward.killBonus} / Win ${reward.winBonus}</em>
          <small>Balance ${reward.progression.credits} CR</small>
        </div>
      `
      : '';

    this.overlay.innerHTML = `
      <section class="menu-card end-card">
        <span class="eyebrow">Match Complete</span>
        <h2>${winnerLabel}</h2>
        ${rewardHtml}
        <div class="score-list">${rows}</div>
        <div class="menu-actions">
          <button class="primary-action" type="button" data-action="menu">Main Menu</button>
          <button class="ghost-action" type="button" data-action="armory">Armory</button>
        </div>
      </section>
    `;
    this.mustFind<HTMLButtonElement>('[data-action="menu"]').addEventListener('click', () => {
      if (!this.localMode) {
        this.network.send({ type: 'leave_lobby' });
      }
      this.localMode = false;
      this.localSelf = undefined;
      this.localBots = [];
      this.lobby = undefined;
      this.snapshot = undefined;
      this.selfId = '';
      this.renderMenu();
    });
    this.mustFind<HTMLButtonElement>('[data-action="armory"]').addEventListener('click', () => {
      this.localMode = false;
      this.localSelf = undefined;
      this.localBots = [];
      this.lobby = undefined;
      this.snapshot = undefined;
      this.selfId = '';
      this.renderCustomize('menu');
    });
  }

  private awardMatchCredits(
    scoreboard: ScoreEntry[],
    winnerId?: string,
    mode: GameMode = this.localGameMode,
    winnerTeam?: TeamId,
  ): RoundRewardResult | undefined {
    if (this.rewardIssued) {
      return this.lastRoundReward;
    }
    const selfEntry = scoreboard.find((entry) => entry.playerId === this.selfId);
    if (!selfEntry) {
      return undefined;
    }
    const won = mode === 'tdm' ? selfEntry.team === winnerTeam : selfEntry.playerId === winnerId;
    const reward = awardRoundCredits(this.progression, { kills: selfEntry.kills, won });
    this.progression = reward.progression;
    this.rewardIssued = true;
    this.lastRoundReward = reward;
    this.saveProgression();
    return reward;
  }

  private startSingleplayer(): void {
    this.readQuickSettings();
    const now = performance.now();
    this.localMode = true;
    this.localMatchOver = false;
    this.matchStartsAt = now + matchConfig.introMs;
    this.localEndsAt = this.matchStartsAt + matchConfig.durationMs;
    this.selfId = 'local-player';
    this.lobby = undefined;
    this.killFeed = [];
    this.localSelf = this.createLocalActor('local-player', 1, this.profile, 'alpha', false, 0, this.matchStartsAt);
    this.localBots = Array.from({ length: this.localBotCount }, (_, index) => {
      const team = this.localGameMode === 'tdm' ? (index % 2 === 0 ? 'bravo' : 'alpha') : 'bravo';
      return this.createLocalActor(
        `bot-${index + 1}`,
        index + 2,
        createBotProfile(index),
        team,
        true,
        index + 1,
        this.matchStartsAt,
      );
    });
    this.controller.setPose(this.localSelf.x, this.localSelf.y, this.localSelf.z, this.localSelf.yaw, this.localSelf.pitch);
    this.snapshot = this.buildLocalSnapshot(now);
    this.enterMatch();
    this.syncFromSnapshot(this.snapshot);
  }

  private async createLobby(): Promise<void> {
    try {
      this.localMode = false;
      await this.network.connect();
      this.network.send({ type: 'create_lobby', profile: this.profile });
      this.renderLobby();
    } catch {
      let errorMsg = 'Could not reach the multiplayer server.';
      const isStaticHost = window.location.hostname.endsWith('netlify.app') || window.location.hostname.endsWith('github.io');
      const hasCustomUrl = !!localStorage.getItem('yardline-custom-ws-url');
      if (isStaticHost && !hasCustomUrl) {
        errorMsg = 'Could not reach server. Static hosts like Netlify require a configured custom WebSocket Server URL in Customize.';
      }
      this.showToast(errorMsg);
    }
  }

  private async joinLobby(code: string): Promise<void> {
    try {
      this.localMode = false;
      await this.network.connect();
      this.network.send({ type: 'join_lobby', code, profile: this.profile });
      this.renderLobby();
    } catch {
      let errorMsg = 'Could not reach the multiplayer server.';
      const isStaticHost = window.location.hostname.endsWith('netlify.app') || window.location.hostname.endsWith('github.io');
      const hasCustomUrl = !!localStorage.getItem('yardline-custom-ws-url');
      if (isStaticHost && !hasCustomUrl) {
        errorMsg = 'Could not reach server. Static hosts like Netlify require a configured custom WebSocket Server URL in Customize.';
      }
      this.showToast(errorMsg);
    }
  }

  private enterMatch(): void {
    this.screen = 'match';
    this.overlay.classList.add('hidden');
    this.hud.classList.remove('hidden');
    this.killFeed = [];
    this.footstepTimer = 0;
    this.previousReloading = false;
    this.leadPrimed = false;
    this.lastLeaderNumber = undefined;
    this.headBobPhase = 0;
    this.headBobStrength = 0;
    this.hitmarkerTimer = 0;
    this.introAnnounced = false;
    this.introBannerUntil = 0;
    this.remoteFootsteps.clear();
    this.lastShotAudioAt.clear();
    this.lastReloadAudioAt.clear();
    this.lastFireRequestAt = 0;
    this.lastReloadRequestAt = 0;
    this.reloadVisual = 0;
    this.rewardIssued = false;
    this.lastRoundReward = undefined;
    if (!this.matchStartsAt) {
      this.matchStartsAt = performance.now();
    }
    this.updateWeaponView(true);
    this.controller.requestLock();
  }

  private syncFromSnapshot(snapshot: MatchSnapshot): void {
    const self = snapshot.players.find((player) => player.id === snapshot.selfId);
    if (self) {
      this.profile = { ...self.profile, loadout: normalizeLoadout(self.profile.loadout, this.progression) };
      this.saveProfile();
      if (!self.alive) {
        this.controller.setPose(self.x, 1.7, self.z, self.yaw, self.pitch);
      } else if (this.localMode) {
        // Singleplayer: hard-set from local simulation (no latency).
        this.controller.setPose(self.x, self.y, self.z, self.yaw, self.pitch);
      } else {
        // Online multiplayer: smooth reconciliation to avoid rubber-banding.
        this.controller.reconcile(self.x, self.y, self.z);
      }
    }
    this.updateActors(snapshot.players);
    this.updateRemoteFootsteps(snapshot);
    this.updateHud(snapshot);
    this.evaluateLead(snapshot);
  }

  private createLocalActor(
    id: string,
    playerNumber: number,
    profile: PlayerProfile,
    team: TeamId,
    bot: boolean,
    spawnIndex: number,
    now: number,
  ): LocalActorState {
    const weapon = weaponDefinitions[profile.loadout.weapon];
    const point = spawnPoints[spawnIndex % spawnPoints.length];
    const yaw = Math.atan2(-point[0], -point[2]);
    const maxHealth = getMaxHealth(profile);
    return {
      id,
      playerNumber,
      profile,
      x: point[0],
      y: point[1],
      z: point[2],
      yaw,
      pitch: 0,
      health: maxHealth,
      maxHealth,
      alive: true,
      respawnAt: 0,
      ammo: weapon.magSize,
      reserve: weapon.magSize * weapon.reserveMags,
      reloadingUntil: 0,
      lastShotAt: now - weapon.fireDelayMs,
      kills: 0,
      deaths: 0,
      ads: false,
      team,
      bot,
      moveTimer: 0,
      strafe: 1,
      thinkAt: 0,
    };
  }

  private updateSingleplayer(dt: number, now: number): void {
    if (!this.localSelf || this.localBots.length === 0 || this.localMatchOver) {
      return;
    }
    if (now < this.matchStartsAt) {
      const snapshot = this.buildLocalSnapshot(now);
      this.snapshot = snapshot;
      this.syncFromSnapshot(snapshot);
      return;
    }

    if (this.localSelf.alive) {
      this.localSelf.x = this.camera.position.x;
      this.localSelf.y = this.camera.position.y;
      this.localSelf.z = this.camera.position.z;
      const input = this.controller.getInput();
      this.localSelf.yaw = input.yaw;
      this.localSelf.pitch = input.pitch;
      this.localSelf.ads = input.ads;
      this.applyLocalReload(this.localSelf, now);
    } else if (now >= this.localSelf.respawnAt) {
      this.respawnLocalActor(this.localSelf, 0, now);
      this.controller.setPose(
        this.localSelf.x,
        this.localSelf.y,
        this.localSelf.z,
        this.localSelf.yaw,
        this.localSelf.pitch,
      );
      this.handleCombatEvent({
        type: 'combat_event',
        kind: 'respawn',
        playerId: this.localSelf.id,
        message: `${this.localSelf.profile.name} respawned`,
      });
    }

    for (let index = 0; index < this.localBots.length; index += 1) {
      const bot = this.localBots[index];
      this.updateBot(bot, dt, now);
      if (!bot.alive && now >= bot.respawnAt) {
        this.respawnLocalActor(bot, index + 1, now);
        this.handleCombatEvent({
          type: 'combat_event',
          kind: 'respawn',
          playerId: bot.id,
          message: `${bot.profile.name} respawned`,
        });
      }
    }

    const snapshot = this.buildLocalSnapshot(now);
    this.snapshot = snapshot;
    this.syncFromSnapshot(snapshot);
    const winner = this.getLocalWinner(now);
    const winnerTeam = this.getLocalWinnerTeam(now);
    if (winner || winnerTeam || now >= this.localEndsAt) {
      this.localMatchOver = true;
      this.renderEnd(snapshot.scoreboard, winner, this.localGameMode, winnerTeam, snapshot.teamScores);
    }
  }

  private updateBot(bot: LocalActorState, dt: number, now: number): void {
    if (!this.localSelf || !bot.alive) {
      return;
    }

    this.applyLocalReload(bot, now);
    const target = this.pickBotTarget(bot);
    if (!target) {
      return;
    }

    const dx = target.x - bot.x;
    const dz = target.z - bot.z;
    const distance = Math.max(0.001, Math.hypot(dx, dz));
    bot.yaw = Math.atan2(-dx, -dz);
    bot.pitch = THREE.MathUtils.clamp((target.y - bot.y) / distance, -0.35, 0.35);
    bot.moveTimer = (bot.moveTimer ?? 0) - dt;
    if (bot.moveTimer <= 0) {
      bot.moveTimer = this.localBotDifficulty === 'hard' ? 0.45 + Math.random() * 0.7 : 0.8 + Math.random() * 1.1;
      bot.strafe = Math.random() > 0.5 ? 1 : -1;
      const cover = this.pickBotCover(bot, target);
      bot.coverX = cover.x;
      bot.coverZ = cover.z;
    }

    const wantsCover = bot.health < bot.maxHealth * 0.45 || bot.reloadingUntil > now;
    const desiredX = wantsCover && bot.coverX !== undefined ? bot.coverX : target.x;
    const desiredZ = wantsCover && bot.coverZ !== undefined ? bot.coverZ : target.z;
    const pathX = desiredX - bot.x;
    const pathZ = desiredZ - bot.z;
    const pathDistance = Math.max(0.001, Math.hypot(pathX, pathZ));
    const forward = wantsCover ? 1 : distance > 18 ? 1 : distance < 8 ? -1 : 0.25;
    const strafe = bot.strafe ?? 1;
    let moveX = (pathX / pathDistance) * forward + (dz / distance) * 0.62 * strafe;
    let moveZ = (pathZ / pathDistance) * forward - (dx / distance) * 0.62 * strafe;
    for (const other of this.localBots) {
      if (other.id === bot.id || !other.alive) {
        continue;
      }
      const avoidX = bot.x - other.x;
      const avoidZ = bot.z - other.z;
      const avoidDistance = Math.hypot(avoidX, avoidZ);
      if (avoidDistance > 0.001 && avoidDistance < 3.2) {
        const force = (3.2 - avoidDistance) / 3.2;
        moveX += (avoidX / avoidDistance) * force * 0.9;
        moveZ += (avoidZ / avoidDistance) * force * 0.9;
      }
    }
    this.moveLocalActor(bot, moveX, moveZ, dt, this.localBotDifficulty === 'hard' ? 6.1 : 5.2);

    const canSee = distance < 58 && hasLineOfSight([bot.x, bot.y, bot.z], [target.x, target.y, target.z]);
    const weapon = weaponDefinitions[bot.profile.loadout.weapon];
    const reactionDelay = this.localBotDifficulty === 'hard' ? 120 : 360;
    if (!wantsCover && canSee && now - bot.lastShotAt >= weapon.fireDelayMs + reactionDelay && bot.reloadingUntil <= now) {
      if (bot.ammo <= 0) {
        if (this.reloadLocalActor(bot)) {
          this.handleCombatEvent({
            type: 'combat_event',
            kind: 'reload',
            playerId: bot.id,
            weapon: bot.profile.loadout.weapon,
            message: `${bot.profile.name} reloading`,
          });
        }
        return;
      }
      bot.lastShotAt = now;
      bot.ammo -= 1;
      const baseAccuracy = this.localBotDifficulty === 'hard' ? 0.84 : 0.7;
      const accuracy = THREE.MathUtils.clamp(baseAccuracy - distance / 105, this.localBotDifficulty === 'hard' ? 0.34 : 0.22, this.localBotDifficulty === 'hard' ? 0.82 : 0.68);
      const hit = Math.random() < accuracy;
      const from: [number, number, number] = [bot.x, bot.y - 0.1, bot.z];
      const to: [number, number, number] = hit
        ? [target.x, target.y - 0.14, target.z]
        : [target.x + (Math.random() - 0.5) * 7, target.y - 0.14, target.z + (Math.random() - 0.5) * 7];
      let killed = false;
      let damage = 0;
      if (hit) {
        damage = Math.round(weapon.damage * 0.82);
        target.health = Math.max(0, target.health - damage);
        if (target.health <= 0) {
          killed = true;
          target.alive = false;
          target.respawnAt = now + matchConfig.respawnMs;
          target.deaths += 1;
          bot.kills += 1;
        }
      }
      this.handleCombatEvent({
        type: 'combat_event',
        kind: 'shot',
        shooterId: bot.id,
        targetId: hit ? target.id : undefined,
        weapon: bot.profile.loadout.weapon,
        damage,
        killed,
        from,
        to,
        message: killed
          ? `${bot.profile.name} eliminated ${target.profile.name}`
          : hit
            ? `${bot.profile.name} hit ${target.profile.name} for ${damage}`
            : `${bot.profile.name} fired ${weapon.label}`,
      });
    }
  }

  private fireLocalWeapon(): void {
    if (!this.localSelf || this.localBots.length === 0 || !this.localSelf.alive || this.localMatchOver || this.isIntroActive()) {
      return;
    }
    const now = performance.now();
    const shooter = this.localSelf;
    this.applyLocalReload(shooter, now);
    const weapon = weaponDefinitions[shooter.profile.loadout.weapon];
    if (shooter.reloadingUntil > now || now - shooter.lastShotAt < weapon.fireDelayMs) {
      return;
    }
    if (shooter.ammo <= 0) {
      if (this.reloadLocalActor(shooter)) {
        this.audio.playReload(shooter.profile.loadout.weapon);
      }
      return;
    }

    shooter.lastShotAt = now;
    shooter.ammo -= 1;
    const origin = new THREE.Vector3(this.camera.position.x, this.camera.position.y - 0.1, this.camera.position.z);
    const direction = this.controller.getForwardDirection();
    const hit = this.pickLocalHit(origin, direction, this.localBots);
    const to: [number, number, number] = hit
      ? [hit.target.x, hit.target.y - 0.16, hit.target.z]
      : [
          origin.x + direction.x * weapon.range,
          origin.y + direction.y * weapon.range,
          origin.z + direction.z * weapon.range,
        ];
    let damage = 0;
    let killed = false;
    if (hit) {
      damage = hit.damage;
      hit.target.health = Math.max(0, hit.target.health - damage);
      if (hit.target.health <= 0) {
        killed = true;
        hit.target.alive = false;
        hit.target.respawnAt = now + matchConfig.respawnMs;
        hit.target.deaths += 1;
        shooter.kills += 1;
      }
    }
    this.handleCombatEvent({
      type: 'combat_event',
      kind: 'shot',
      shooterId: shooter.id,
      targetId: hit ? hit.target.id : undefined,
      weapon: shooter.profile.loadout.weapon,
      damage,
      killed,
      from: [origin.x, origin.y, origin.z],
      to,
      message: killed
        ? `${shooter.profile.name} eliminated ${hit?.target.profile.name ?? 'target'}`
        : hit
          ? `${shooter.profile.name} hit ${hit.target.profile.name} for ${damage}`
          : `${shooter.profile.name} fired ${weapon.label}`,
    });
    this.snapshot = this.buildLocalSnapshot(now);
    this.syncFromSnapshot(this.snapshot);
  }

  private pickLocalHit(origin: THREE.Vector3, direction: THREE.Vector3, targets: LocalActorState[]): { damage: number; target: LocalActorState } | undefined {
    const weapon = weaponDefinitions[this.profile.loadout.weapon];
    let best: { damage: number; target: LocalActorState; projection: number } | undefined;
    for (const target of targets) {
      if (!target.alive || (this.localGameMode === 'tdm' && target.team === this.localSelf?.team)) {
        continue;
      }
      const center = new THREE.Vector3(target.x, target.y - 0.16, target.z);
      const toTarget = center.clone().sub(origin);
      const projection = toTarget.dot(direction);
      if (projection < 0.4 || projection > weapon.range) {
        continue;
      }
      const closest = origin.clone().add(direction.clone().multiplyScalar(projection));
      const missDistance = center.distanceTo(closest);
      const input = this.controller.getInput();
      const allowedRadius = 0.68 + weapon.spread * projection * (input.ads ? 0.55 : 1);
      if (missDistance > allowedRadius || !hasLineOfSight([origin.x, origin.y, origin.z], [center.x, center.y, center.z])) {
        continue;
      }
      const falloff = weapon.id === 'sniper' ? 1 : Math.max(0.72, 1 - (projection / weapon.range) * 0.24);
      const result = { damage: Math.max(1, Math.round(weapon.damage * falloff)), target, projection };
      if (!best || result.projection < best.projection) {
        best = result;
      }
    }
    return best;
  }

  private reloadLocalActor(actor?: LocalActorState): boolean {
    if (!actor || !actor.alive) {
      return false;
    }
    const now = performance.now();
    const weapon = weaponDefinitions[actor.profile.loadout.weapon];
    if (actor.reloadingUntil > now || actor.ammo >= weapon.magSize || actor.reserve <= 0) {
      return false;
    }
    const multiplier = actor.profile.loadout.tactical === 'quick_hands' ? 0.75 : 1;
    actor.reloadingUntil = now + Math.round(weapon.reloadMs * multiplier);
    return true;
  }

  private applyLocalReload(actor: LocalActorState, now: number): void {
    if (actor.reloadingUntil === 0 || actor.reloadingUntil > now) {
      return;
    }
    const weapon = weaponDefinitions[actor.profile.loadout.weapon];
    const needed = weapon.magSize - actor.ammo;
    const used = Math.min(needed, actor.reserve);
    actor.ammo += used;
    actor.reserve -= used;
    actor.reloadingUntil = 0;
  }

  private respawnLocalActor(actor: LocalActorState, spawnIndex: number, now: number): void {
    const point = spawnPoints[spawnIndex % spawnPoints.length];
    const weapon = weaponDefinitions[actor.profile.loadout.weapon];
    actor.x = point[0];
    actor.y = point[1];
    actor.z = point[2];
    actor.yaw = Math.atan2(-point[0], -point[2]);
    actor.pitch = 0;
    actor.health = getMaxHealth(actor.profile);
    actor.maxHealth = actor.health;
    actor.alive = true;
    actor.respawnAt = 0;
    actor.ammo = weapon.magSize;
    actor.reserve = weapon.magSize * weapon.reserveMags;
    actor.reloadingUntil = 0;
    actor.lastShotAt = now - weapon.fireDelayMs;
  }

  private moveLocalActor(actor: LocalActorState, x: number, z: number, dt: number, speed: number): void {
    const length = Math.hypot(x, z);
    if (length <= 0.001) {
      return;
    }
    const nextX = actor.x + (x / length) * speed * dt;
    const nextZ = actor.z + (z / length) * speed * dt;
    if (!this.arena.isBlocked(nextX, actor.z, 0.44)) {
      actor.x = nextX;
    }
    if (!this.arena.isBlocked(actor.x, nextZ, 0.44)) {
      actor.z = nextZ;
    }
  }

  private buildLocalSnapshot(now: number): MatchSnapshot {
    const players = [this.localSelf, ...this.localBots]
      .filter((player): player is LocalActorState => Boolean(player))
      .map((player) => ({
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
        ads: player.ads,
        kills: player.kills,
        deaths: player.deaths,
      }));
    return {
      type: 'snapshot',
      serverTime: now,
      selfId: 'local-player',
      roomCode: 'BOT',
      mode: this.localGameMode,
      timeRemaining: Math.max(0, Math.ceil((this.localEndsAt - Math.max(now, this.matchStartsAt)) / 1000)),
      players,
      scoreboard: this.buildLocalScoreboard(),
      teamScores: this.buildLocalTeamScores(),
    };
  }

  private buildLocalScoreboard(): ScoreEntry[] {
    return [this.localSelf, ...this.localBots]
      .filter((player): player is LocalActorState => Boolean(player))
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

  private buildLocalTeamScores(): TeamScore[] {
    const scores: Record<TeamId, TeamScore> = {
      alpha: { team: 'alpha', kills: 0, deaths: 0 },
      bravo: { team: 'bravo', kills: 0, deaths: 0 },
    };
    for (const player of [this.localSelf, ...this.localBots]) {
      if (!player) {
        continue;
      }
      scores[player.team].kills += player.kills;
      scores[player.team].deaths += player.deaths;
    }
    return [scores.alpha, scores.bravo];
  }

  private getLocalWinner(now: number): string | undefined {
    const players = [this.localSelf, ...this.localBots].filter((player): player is LocalActorState => Boolean(player));
    if (this.localGameMode === 'tdm') {
      return undefined;
    }
    const limitWinner = players.find((player) => player.kills >= matchConfig.scoreLimit);
    if (limitWinner) {
      return limitWinner.id;
    }
    if (now < this.localEndsAt) {
      return undefined;
    }
    return this.buildLocalScoreboard()[0]?.playerId;
  }

  private getLocalWinnerTeam(now: number): TeamId | undefined {
    if (this.localGameMode !== 'tdm') {
      return undefined;
    }
    const [alpha, bravo] = this.buildLocalTeamScores();
    if (alpha.kills >= matchConfig.teamScoreLimit || bravo.kills >= matchConfig.teamScoreLimit || now >= this.localEndsAt) {
      return alpha.kills >= bravo.kills ? 'alpha' : 'bravo';
    }
    return undefined;
  }

  private pickBotTarget(bot: LocalActorState): LocalActorState | undefined {
    const actors: Array<LocalActorState | undefined> = [this.localSelf, ...this.localBots];
    const candidates = actors.filter(
      (actor): actor is LocalActorState =>
        actor !== undefined && actor.id !== bot.id && actor.alive && (this.localGameMode === 'ffa' || actor.team !== bot.team),
    );
    return candidates.sort((a, b) => {
      const aDistance = Math.hypot(a.x - bot.x, a.z - bot.z);
      const bDistance = Math.hypot(b.x - bot.x, b.z - bot.z);
      const aVisible = hasLineOfSight([bot.x, bot.y, bot.z], [a.x, a.y, a.z]) ? -12 : 0;
      const bVisible = hasLineOfSight([bot.x, bot.y, bot.z], [b.x, b.y, b.z]) ? -12 : 0;
      return aDistance + aVisible - (bDistance + bVisible);
    })[0];
  }

  private pickBotCover(bot: LocalActorState, target: LocalActorState): { x: number; z: number } {
    const awayX = bot.x - target.x;
    const awayZ = bot.z - target.z;
    const length = Math.max(0.001, Math.hypot(awayX, awayZ));
    const side = bot.strafe ?? 1;
    const x = THREE.MathUtils.clamp(bot.x + (awayX / length) * 5 + (awayZ / length) * side * 4, -42, 42);
    const z = THREE.MathUtils.clamp(bot.z + (awayZ / length) * 5 - (awayX / length) * side * 4, -30, 30);
    return this.arena.isBlocked(x, z, 0.44) ? { x: bot.x, z: bot.z } : { x, z };
  }

  private updateActors(players: PlayerSnapshot[]): void {
    const seen = new Set<string>();
    for (const player of players) {
      if (player.id === this.selfId) {
        continue;
      }
      seen.add(player.id);
      const key = getProfileKey(player.profile, player.team);
      let actor = this.actors.get(player.id);
      if (!actor || actor.profileKey !== key) {
        if (actor) {
          this.scene.remove(actor.group);
        }
        actor = { group: this.createActor(player), profileKey: key, targetX: player.x, targetZ: player.z, targetYaw: player.yaw };
        this.actors.set(player.id, actor);
        this.scene.add(actor.group);
        // New actor — snap to initial position immediately.
        actor.group.position.set(player.x, 0, player.z);
        actor.group.rotation.y = player.yaw;
      }
      actor.group.visible = player.alive;
      // Store target; actual interpolation happens in interpolateActors().
      actor.targetX = player.x;
      actor.targetZ = player.z;
      actor.targetYaw = player.yaw;
    }

    for (const [id, actor] of this.actors.entries()) {
      if (!seen.has(id)) {
        this.scene.remove(actor.group);
        this.actors.delete(id);
      }
    }
  }

  private createActor(player: PlayerSnapshot): THREE.Group {
    const group = new THREE.Group();
    const suit = new THREE.Color(player.profile.suitColor);
    const accent = new THREE.Color(player.profile.accentColor);
    const teamColor = player.team === 'alpha' ? '#5e9bff' : '#ff6b56';
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: suit, roughness: 0.58, metalness: 0.18 });
    const armorMaterial = new THREE.MeshStandardMaterial({ color: '#202327', roughness: 0.72, metalness: 0.16 });
    const fabricMaterial = new THREE.MeshStandardMaterial({ color: '#262c2d', roughness: 0.86, metalness: 0.04 });
    const accentMaterial = new THREE.MeshBasicMaterial({ color: accent, toneMapped: false });
    const teamMaterial = new THREE.MeshBasicMaterial({ color: teamColor, toneMapped: false });
    const add = (mesh: THREE.Mesh, x: number, y: number, z: number, rotation: [number, number, number] = [0, 0, 0]) => {
      mesh.position.set(x, y, z);
      mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };
    add(new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.92, 0.36), bodyMaterial), 0, 1.02, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.58, 0.42), armorMaterial), 0, 1.14, -0.02);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.11, 0.44), teamMaterial), 0, 1.46, -0.02);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.26, 0.32), fabricMaterial), 0, 0.5, 0.02);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.27, 18, 12), bodyMaterial), 0, 1.76, 0);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.31, 18, 10), armorMaterial), 0, 1.82, 0.01);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.045), accentMaterial), 0, 1.77, -0.28);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.08), teamMaterial), 0, 1.93, -0.22);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.74, 10), fabricMaterial), -0.48, 1.12, -0.04, [0.08, 0, -0.22]);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.74, 10), fabricMaterial), 0.48, 1.12, -0.04, [0.08, 0, 0.22]);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.78, 10), fabricMaterial), -0.22, 0.15, 0.02, [0.04, 0, -0.06]);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.78, 10), fabricMaterial), 0.22, 0.15, 0.02, [0.04, 0, 0.06]);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.5), armorMaterial), -0.22, -0.24, -0.03);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.5), armorMaterial), 0.22, -0.24, -0.03);
    const weapon = this.createGunModel(
      player.profile.loadout.weapon,
      player.profile.accentColor,
      player.profile.loadout.camoId ?? 'matte_black',
      player.profile.loadout.opticId ?? getDefaultOpticForWeapon(player.profile.loadout.weapon),
      false,
    );
    weapon.position.set(0.34, 1.14, -0.34);
    weapon.scale.setScalar(0.55);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.72, 32), teamMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.025;
    group.add(weapon, ring, this.createNameSprite(`${player.profile.name} / ${formatTeamName(player.team)}`, teamColor));
    return group;
  }

  private createNameSprite(name: string, color: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not create name tag.');
    }
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = color;
    ctx.strokeRect(2, 2, 252, 60);
    ctx.fillStyle = '#f8fff9';
    ctx.font = '800 24px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 128, 32);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
    sprite.position.y = 2.35;
    sprite.scale.set(2.4, 0.6, 1);
    return sprite;
  }

  private handleCombatEvent(event: CombatEvent): void {
    this.killFeed.unshift(event.message);
    this.killFeed = this.killFeed.slice(0, 4);
    if (event.kind === 'shot') {
      if (this.shouldPlayShotAudio(event)) {
        this.audio.playGunshot(event.weapon, event.shooterId !== this.selfId);
      }
      if (event.shooterId === this.selfId && event.damage > 0) {
        this.audio.playHitmarker(event.killed);
        this.flashHitmarker(event.killed);
      }
      if (event.shooterId === this.selfId) {
        const recoil = weaponDefinitions[event.weapon].recoil;
        this.weaponKick = Math.min(0.18, this.weaponKick + recoil * 0.06);
        this.controller.addRecoil(recoil * 0.006);
      }
      this.createMuzzleFlash(this.getMuzzleFlashPosition(event));
      if (event.damage > 0) {
        this.createImpactSpark(event.to, event.killed);
      }
    }
    if (event.kind === 'reload') {
      if (this.shouldPlayReloadAudio(event)) {
        this.audio.playReload(event.weapon, this.getAudioScaleForPlayer(event.playerId, event.playerId !== this.selfId ? 24 : 0));
      }
    }
    if (this.snapshot) {
      this.updateHud(this.snapshot);
    }
  }

  private shouldPlayShotAudio(event: Extract<CombatEvent, { kind: 'shot' }>): boolean {
    const now = performance.now();
    const key = `${event.shooterId}:${event.weapon}`;
    const last = this.lastShotAudioAt.get(key) ?? 0;
    const minGap = Math.max(55, weaponDefinitions[event.weapon].fireDelayMs * 0.68);
    if (now - last < minGap) {
      return false;
    }
    this.lastShotAudioAt.set(key, now);
    return true;
  }

  private shouldPlayReloadAudio(event: Extract<CombatEvent, { kind: 'reload' }>): boolean {
    const now = performance.now();
    const last = this.lastReloadAudioAt.get(event.playerId) ?? 0;
    const minGap = Math.max(900, weaponDefinitions[event.weapon].reloadMs * 0.72);
    if (now - last < minGap) {
      return false;
    }
    this.lastReloadAudioAt.set(event.playerId, now);
    return true;
  }

  private getMuzzleFlashPosition(event: Extract<CombatEvent, { kind: 'shot' }>): [number, number, number] {
    if (event.shooterId === this.selfId) {
      const forward = this.controller.getForwardDirection();
      const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
      const muzzle = this.camera.position
        .clone()
        .add(forward.multiplyScalar(0.72))
        .add(right.multiplyScalar(0.22))
        .add(new THREE.Vector3(0, -0.2, 0));
      return [muzzle.x, muzzle.y, muzzle.z];
    }

    const shooter = this.snapshot?.players.find((player) => player.id === event.shooterId);
    if (!shooter) {
      return event.from;
    }
    const forwardX = -Math.sin(shooter.yaw);
    const forwardZ = -Math.cos(shooter.yaw);
    const rightX = Math.cos(shooter.yaw);
    const rightZ = -Math.sin(shooter.yaw);
    return [
      shooter.x + forwardX * 0.64 + rightX * 0.2,
      shooter.y - 0.28,
      shooter.z + forwardZ * 0.64 + rightZ * 0.2,
    ];
  }

  private flashHitmarker(killed: boolean): void {
    const crosshair = this.hud.querySelector<HTMLDivElement>('.combat-crosshair');
    this.hitmarkerTimer = killed ? 0.14 : 0.09;
    if (!crosshair) {
      return;
    }
    crosshair.classList.remove('combat-crosshair--hit', 'combat-crosshair--kill');
    void crosshair.offsetWidth;
    crosshair.classList.add('combat-crosshair--hit');
    if (killed) {
      crosshair.classList.add('combat-crosshair--kill');
    }
  }

  private updateHud(snapshot: MatchSnapshot): void {
    const self = snapshot.players.find((player) => player.id === snapshot.selfId);
    const top = this.mustFind<HTMLDivElement>('.combat-hud__top', this.hud);
    const bottom = this.mustFind<HTMLDivElement>('.combat-hud__bottom', this.hud);
    const feed = this.mustFind<HTMLDivElement>('.kill-feed', this.hud);
    const board = this.mustFind<HTMLDivElement>('.leaderboard-panel', this.hud);
    const death = this.mustFind<HTMLDivElement>('.death-overlay', this.hud);
    const crosshair = this.mustFind<HTMLDivElement>('.combat-crosshair', this.hud);
    const scoreboard = snapshot.scoreboard.slice(0, 3).map((entry) => `${escapeHtml(entry.name)} ${entry.kills}`).join(' | ');
    const modeLabel = snapshot.mode === 'tdm' ? 'TDM' : 'FFA';
    const scoreLabel =
      snapshot.mode === 'tdm'
        ? snapshot.teamScores.map((entry) => `${formatTeamName(entry.team)} ${entry.kills}`).join(' | ')
        : scoreboard || 'Waiting for score';

    top.innerHTML = `
      <div class="team-score-strip" data-mode="${snapshot.mode}"><strong>${modeLabel}</strong><span>${scoreLabel}</span></div>
    `;
    board.innerHTML = `
      <div class="leaderboard-panel__timer">
        <span>${modeLabel}</span>
        <strong>${formatTime(snapshot.timeRemaining)}</strong>
        <em>${escapeHtml(snapshot.roomCode)}</em>
      </div>
      <div class="leaderboard-panel__rows">
        ${snapshot.scoreboard
          .map(
            (entry, index) => `
              <div class="leaderboard-row ${entry.playerId === snapshot.selfId ? 'leaderboard-row--self' : ''}" data-team="${entry.team}">
                <span>${index + 1}</span>
                <strong>${escapeHtml(entry.name)}</strong>
                <small>${snapshot.mode === 'tdm' ? formatTeamName(entry.team) : `P${entry.playerNumber}`}</small>
                <em>${entry.kills}/${entry.deaths}</em>
              </div>
            `,
          )
          .join('')}
      </div>
    `;
    if (self) {
      const weapon = weaponDefinitions[self.profile.loadout.weapon];
      const healthPercent = Math.max(0, Math.min(1, self.health / self.maxHealth));
      bottom.innerHTML = `
        <div class="health-box">
          <span>Health</span>
          <strong>${self.health}</strong>
          <i style="width:${healthPercent * 100}%"></i>
        </div>
        <div class="ammo-box">
          <span>${weapon.label}</span>
          <strong>${self.reloading ? 'Reloading' : `${self.ammo} / ${self.reserve}`}</strong>
        </div>
      `;
      const respawnSeconds = Math.max(0, Math.ceil((self.respawnAt - snapshot.serverTime) / 1000));
      death.classList.toggle('hidden', self.alive);
      death.innerHTML = `<strong>Respawning</strong><span>${respawnSeconds}s</span>`;
      crosshair.classList.toggle('combat-crosshair--ads', self.ads);
      if (this.previousReloading && !self.reloading) {
        this.audio.playReloadFinish();
      }
      this.previousReloading = self.reloading;
    }
    feed.innerHTML = this.killFeed.map((line) => `<div>${escapeHtml(line)}</div>`).join('');
  }

  private evaluateLead(snapshot: MatchSnapshot): void {
    const top = snapshot.scoreboard[0];
    if (!top || top.kills <= 0) {
      return;
    }

    const leaders = snapshot.scoreboard.filter((entry) => entry.kills === top.kills);
    if (leaders.length !== 1) {
      this.lastLeaderNumber = undefined;
      return;
    }

    const leader = leaders[0];
    if (leader.playerNumber !== 1 && leader.playerNumber !== 2) {
      this.lastLeaderNumber = leader.playerNumber;
      return;
    }

    if (!this.leadPrimed) {
      this.leadPrimed = true;
      this.lastLeaderNumber = leader.playerNumber;
      return;
    }

    if (leader.playerNumber !== this.lastLeaderNumber) {
      this.audio.playLeadCallout(leader.playerNumber);
      this.lastLeaderNumber = leader.playerNumber;
    }
  }

  private createHud(): HTMLDivElement {
    const hud = document.createElement('div');
    hud.className = 'combat-hud hidden';
    hud.innerHTML = `
      <div class="combat-hud__top"></div>
      <div class="combat-crosshair"><span></span><i class="combat-hitmarker-ring"></i></div>
      <div class="scope-overlay hidden">
        <div class="scope-overlay__glass">
          <span></span>
        </div>
      </div>
      <div class="match-intro hidden"></div>
      <div class="leaderboard-panel"></div>
      <div class="kill-feed"></div>
      <div class="combat-hud__bottom"></div>
      <div class="death-overlay hidden"></div>
      <div class="toast"></div>
    `;
    return hud;
  }

  private updateWeaponView(force = false): void {
    const key = `${this.profile.loadout.weapon}:${this.profile.accentColor}:${this.profile.suitColor}:${this.profile.loadout.camoId}:${this.profile.loadout.opticId}`;
    if (!force && key === this.lastWeaponKey) {
      return;
    }
    this.lastWeaponKey = key;
    this.weaponView.clear();
    const gun = this.createGunModel(
      this.profile.loadout.weapon,
      this.profile.accentColor,
      this.profile.loadout.camoId,
      this.profile.loadout.opticId,
      true,
    );
    gun.position.set(0.35, -0.35, -0.72);
    gun.rotation.y = -0.04;
    this.weaponView.add(gun);
  }

  private getCamoMaterial(camoId: CamoId): THREE.MeshStandardMaterial {
    const cached = this.camoMaterials.get(camoId);
    if (cached) {
      return cached;
    }
    const camo = camoDefinitions[camoId] ?? camoDefinitions.matte_black;
    const texture = createCamoTexture(camo);
    const material = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      map: texture,
      roughness: camo.pattern === 'metal' ? 0.38 : 0.72,
      metalness: camo.pattern === 'metal' ? 0.52 : 0.08,
    });
    this.camoMaterials.set(camo.id, material);
    return material;
  }

  private createGunModel(
    weaponClass: WeaponClass,
    accentColor: string,
    camoId: CamoId,
    opticId: OpticId,
    firstPerson: boolean,
  ): THREE.Group {
    const group = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: '#151719', roughness: 0.34, metalness: 0.72 });
    const blued = new THREE.MeshStandardMaterial({ color: '#0b0d0f', roughness: 0.28, metalness: 0.82 });
    const camo = this.getCamoMaterial(camoId);
    const matte = camo;
    const polymer = camo;
    const rubber = new THREE.MeshStandardMaterial({ color: '#15130f', roughness: 0.86, metalness: 0.02 });
    const tape = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.58, metalness: 0.1 });
    const lens = new THREE.MeshPhysicalMaterial({
      color: '#28323a',
      roughness: 0.18,
      metalness: 0,
      transmission: 0.25,
      transparent: true,
      opacity: 0.62,
    });
    const requestedOptic = opticId in opticDefinitions ? opticId : getDefaultOpticForWeapon(weaponClass);
    const activeOptic = opticDefinitions[requestedOptic].compatibleWeapons.includes(weaponClass)
      ? requestedOptic
      : getDefaultOpticForWeapon(weaponClass);
    const scale = firstPerson ? 1 : 0.72;
    const addBox = (
      width: number,
      height: number,
      depth: number,
      material: THREE.Material,
      x: number,
      y: number,
      z: number,
      rotation: [number, number, number] = [0, 0, 0],
    ) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };
    const addCylinder = (
      radiusTop: number,
      radiusBottom: number,
      length: number,
      material: THREE.Material,
      x: number,
      y: number,
      z: number,
      axis: 'x' | 'y' | 'z' = 'z',
      segments = 16,
    ) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, length, segments), material);
      mesh.position.set(x, y, z);
      if (axis === 'z') mesh.rotation.x = Math.PI / 2;
      if (axis === 'x') mesh.rotation.z = Math.PI / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };
    const addRail = (z: number, length: number, y = 0.14) => {
      addBox(0.17, 0.025, length, blued, 0, y, z);
      const teeth = Math.max(3, Math.floor(length / 0.08));
      for (let i = 0; i < teeth; i += 1) {
        addBox(0.19, 0.026, 0.032, metal, 0, y + 0.026, z - length / 2 + i * (length / teeth) + 0.018);
      }
    };
    const addControls = (receiverZ = -0.04) => {
      addBox(0.018, 0.065, 0.035, metal, 0.118, 0.035, receiverZ - 0.07);
      addCylinder(0.018, 0.018, 0.018, blued, 0.126, 0.035, receiverZ + 0.06, 'x', 10);
      addCylinder(0.012, 0.012, 0.016, blued, 0.126, -0.015, receiverZ - 0.045, 'x', 10);
      addBox(0.15, 0.012, 0.085, blued, 0, -0.145, receiverZ - 0.01);
      addBox(0.025, 0.105, 0.025, blued, 0, -0.165, receiverZ - 0.01, [-0.28, 0, 0]);
    };
    const addReceiverPins = (zA: number, zB: number) => {
      [zA, zB].forEach((z) => {
        addCylinder(0.008, 0.008, 0.205, tape, 0, 0.042, z, 'x', 8);
        addCylinder(0.006, 0.006, 0.195, blued, 0, -0.03, z + 0.036, 'x', 8);
      });
    };
    const addMagazineRibs = (z: number, y: number, height: number) => {
      for (let i = 0; i < 4; i += 1) {
        addBox(0.125, 0.012, 0.012, blued, 0, y - i * height, z + i * 0.018, [0.1, 0, 0]);
      }
    };
    const addSightPair = (frontZ: number, rearZ: number) => {
      addBox(0.04, 0.16, 0.035, blued, 0, 0.22, frontZ);
      addBox(0.13, 0.026, 0.044, blued, 0, 0.305, frontZ);
      addBox(0.12, 0.09, 0.055, blued, 0, 0.19, rearZ);
      addBox(0.04, 0.08, 0.02, metal, 0, 0.245, rearZ - 0.012);
    };
    const addOptic = (z: number) => {
      if (activeOptic === 'iron') {
        return;
      }
      addBox(0.15, 0.035, 0.16, blued, 0, 0.245, z);
      addBox(0.035, 0.11, 0.04, blued, -0.055, 0.3, z);
      addBox(0.035, 0.11, 0.04, blued, 0.055, 0.3, z);
      if (activeOptic === 'red_dot') {
        addCylinder(0.072, 0.072, 0.18, blued, 0, 0.38, z - 0.01, 'z', 22);
        addCylinder(0.055, 0.055, 0.014, lens, 0, 0.38, z - 0.105, 'z', 22);
        addBox(0.018, 0.018, 0.012, tape, 0, 0.38, z - 0.118);
      } else if (activeOptic === 'holo') {
        addBox(0.2, 0.16, 0.2, blued, 0, 0.39, z);
        addBox(0.14, 0.1, 0.026, lens, 0, 0.4, z - 0.085);
        addBox(0.036, 0.036, 0.012, tape, 0, 0.4, z - 0.1);
      } else if (activeOptic === 'compact_2x') {
        addCylinder(0.064, 0.064, 0.32, blued, 0, 0.38, z, 'z', 24);
        addCylinder(0.078, 0.064, 0.05, blued, 0, 0.38, z - 0.185, 'z', 24);
        addCylinder(0.067, 0.078, 0.05, blued, 0, 0.38, z + 0.185, 'z', 24);
        addCylinder(0.052, 0.052, 0.012, lens, 0, 0.38, z - 0.205, 'z', 20);
      } else if (activeOptic === 'sniper_scope') {
        addCylinder(0.052, 0.052, 0.58, blued, 0, 0.34, z, 'z', 24);
        addCylinder(0.074, 0.052, 0.12, blued, 0, 0.34, z - 0.36, 'z', 24);
        addCylinder(0.066, 0.052, 0.11, blued, 0, 0.34, z + 0.3, 'z', 24);
      }
    };

    if (weaponClass === 'ar') {
      addBox(0.24, 0.18, 0.5, metal, 0, 0.02, -0.03);
      addBox(0.21, 0.145, 0.48, matte, 0, -0.045, -0.05);
      addBox(0.18, 0.15, 0.48, matte, 0, 0.02, -0.48);
      addRail(-0.33, 0.78, 0.13);
      addCylinder(0.025, 0.025, 0.72, blued, 0, 0.01, -0.86, 'z', 18);
      addCylinder(0.04, 0.035, 0.14, blued, 0, 0.01, -1.28, 'z', 16);
      addBox(0.13, 0.34, 0.17, blued, 0, -0.28, -0.08, [0.1, 0, 0]);
      addBox(0.11, 0.31, 0.12, polymer, 0, -0.24, 0.15, [-0.24, 0, 0]);
      addBox(0.12, 0.08, 0.34, blued, 0, 0.03, 0.42);
      addBox(0.24, 0.13, 0.22, polymer, 0, 0.005, 0.66);
      addBox(0.24, 0.16, 0.045, rubber, 0, 0.0, 0.81);
      addBox(0.05, 0.18, 0.045, blued, 0, 0.18, -0.67);
      addBox(0.14, 0.035, 0.04, blued, 0, 0.28, -0.67);
      addBox(0.11, 0.08, 0.055, blued, 0, 0.19, 0.08);
      addBox(0.05, 0.075, 0.025, blued, 0, 0.25, 0.08);
      addBox(0.19, 0.034, 0.09, tape, 0, 0.115, -0.46);
      addControls(-0.03);
      addReceiverPins(-0.17, 0.11);
      addMagazineRibs(-0.07, -0.2, 0.052);
      addSightPair(-0.72, 0.1);
      addOptic(-0.2);
    } else if (weaponClass === 'smg') {
      addBox(0.23, 0.18, 0.54, metal, 0, 0.02, -0.08);
      addCylinder(0.06, 0.06, 0.52, blued, 0, 0.12, -0.2, 'z', 16);
      addCylinder(0.024, 0.024, 0.34, blued, 0, 0.02, -0.59, 'z', 16);
      addCylinder(0.04, 0.034, 0.1, blued, 0, 0.02, -0.82, 'z', 14);
      addBox(0.11, 0.42, 0.13, blued, 0, -0.34, -0.08, [0.06, 0, 0]);
      addBox(0.1, 0.26, 0.1, polymer, 0, -0.23, 0.18, [-0.22, 0, 0]);
      addBox(0.09, 0.19, 0.08, polymer, 0, -0.22, -0.43);
      addBox(0.14, 0.07, 0.42, blued, 0, 0.02, 0.33);
      addBox(0.18, 0.11, 0.07, rubber, 0, 0.02, 0.58);
      addCylinder(0.055, 0.055, 0.024, blued, 0, 0.22, -0.62, 'z', 18);
      addBox(0.11, 0.08, 0.05, blued, 0, 0.18, 0.1);
      addBox(0.2, 0.03, 0.18, tape, 0, 0.105, -0.28);
      addControls(-0.05);
      addReceiverPins(-0.24, 0.08);
      addMagazineRibs(-0.08, -0.23, 0.062);
      addSightPair(-0.62, 0.1);
      addOptic(-0.18);
    } else if (weaponClass === 'mg') {
      addBox(0.3, 0.2, 0.62, metal, 0, 0.03, -0.02);
      addBox(0.26, 0.18, 0.54, matte, 0, 0.02, -0.5);
      addRail(-0.24, 0.72, 0.17);
      addCylinder(0.032, 0.032, 0.92, blued, 0, 0.02, -1.02, 'z', 18);
      addCylinder(0.052, 0.04, 0.16, blued, 0, 0.02, -1.55, 'z', 16);
      addBox(0.39, 0.24, 0.34, polymer, 0.22, -0.2, -0.06);
      addBox(0.13, 0.3, 0.12, polymer, 0, -0.25, 0.18, [-0.18, 0, 0]);
      addBox(0.22, 0.14, 0.52, polymer, 0, 0.005, 0.53);
      addBox(0.27, 0.17, 0.055, rubber, 0, 0.0, 0.82);
      addBox(0.14, 0.18, 0.44, blued, 0, 0.25, -0.18, [0.18, 0, 0]);
      addBox(0.12, 0.07, 0.055, blued, 0, 0.22, 0.08);
      addBox(0.045, 0.15, 0.04, blued, 0, 0.22, -0.78);
      addCylinder(0.014, 0.014, 0.58, blued, -0.12, -0.25, -0.76, 'y', 8).rotation.z = 0.3;
      addCylinder(0.014, 0.014, 0.58, blued, 0.12, -0.25, -0.76, 'y', 8).rotation.z = -0.3;
      addBox(0.2, 0.034, 0.12, tape, 0, 0.15, -0.52);
      addControls(-0.02);
      addReceiverPins(-0.21, 0.14);
      addMagazineRibs(0.02, -0.12, 0.045);
      addSightPair(-0.78, 0.08);
      addOptic(-0.24);
      for (let i = 0; i < 7; i += 1) {
        addBox(0.055, 0.026, 0.032, metal, -0.01 + i * 0.02, -0.065, -0.42 + i * 0.035, [0.08, 0, 0.18]);
      }
    } else {
      addBox(0.2, 0.16, 0.62, metal, 0, 0.02, -0.08);
      addBox(0.18, 0.12, 0.55, polymer, 0, -0.07, -0.1);
      addBox(0.2, 0.16, 0.74, polymer, 0, -0.03, 0.45);
      addBox(0.23, 0.18, 0.06, rubber, 0, -0.03, 0.86);
      addBox(0.16, 0.12, 0.18, blued, 0, -0.2, -0.06);
      addCylinder(0.024, 0.024, 1.08, blued, 0, 0.04, -0.9, 'z', 20);
      addCylinder(0.037, 0.032, 0.12, blued, 0, 0.04, -1.5, 'z', 16);
      addBox(0.1, 0.12, 0.06, blued, 0.12, 0.05, 0.07);
      addCylinder(0.028, 0.018, 0.15, blued, 0.18, -0.02, 0.1, 'x', 12);
      addCylinder(0.052, 0.052, 0.58, blued, 0, 0.22, -0.16, 'z', 24);
      addCylinder(0.074, 0.052, 0.12, blued, 0, 0.22, -0.52, 'z', 24);
      addCylinder(0.066, 0.052, 0.11, blued, 0, 0.22, 0.18, 'z', 24);
      addBox(0.04, 0.11, 0.045, blued, 0, 0.12, -0.34);
      addBox(0.04, 0.11, 0.045, blued, 0, 0.12, 0.02);
      addBox(0.18, 0.025, 0.72, blued, 0, 0.13, -0.2);
      addBox(0.14, 0.045, 0.18, tape, 0, 0.09, 0.44);
      addControls(-0.08);
      addReceiverPins(-0.16, 0.16);
      addMagazineRibs(-0.06, -0.16, 0.04);
      addSightPair(-0.82, 0.02);
    }

    if (firstPerson) {
      const sleeve = new THREE.MeshStandardMaterial({ color: '#252b2c', roughness: 0.84, metalness: 0.02 });
      const glove = new THREE.MeshStandardMaterial({ color: '#111315', roughness: 0.9, metalness: 0.02 });
      addCylinder(0.055, 0.075, 0.56, sleeve, -0.26, -0.33, -0.18, 'z', 12).rotation.y = -0.42;
      addCylinder(0.055, 0.075, 0.48, sleeve, 0.25, -0.34, 0.2, 'z', 12).rotation.y = 0.35;
      addBox(0.16, 0.11, 0.16, glove, -0.18, -0.2, -0.42, [0.08, 0, -0.18]);
      addBox(0.16, 0.11, 0.16, glove, 0.14, -0.2, 0.02, [0.14, 0, 0.2]);
      for (let i = 0; i < 4; i += 1) {
        addCylinder(0.012, 0.014, 0.12, glove, -0.23 + i * 0.035, -0.19, -0.5, 'z', 7).rotation.x = 0.34;
        addCylinder(0.012, 0.014, 0.11, glove, 0.09 + i * 0.03, -0.19, -0.08, 'z', 7).rotation.x = 0.22;
      }
    }

    group.scale.setScalar(scale);
    return group;
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (this.screen === 'match') {
      const self = this.snapshot?.players.find((player) => player.id === this.selfId);
      const introActive = this.isIntroActive(now);
      if (self?.alive && !introActive) {
        this.controller.updateLocal(dt);
        this.updateFootsteps(dt);
      }
      this.processCombatInput(now, self);
      if (this.localMode) {
        this.updateSingleplayer(dt, now);
      } else {
        this.inputTimer += dt;
        if (this.inputTimer >= 1 / matchConfig.inputHz) {
          this.inputTimer = 0;
          this.network.send({ type: 'input', input: this.controller.getInput() });
        }
      }
      const ads = self?.ads ?? this.controller.getInput().ads;
      const reloading = self?.reloading === true;
      this.updateIntroOverlay(now);
      this.updateViewMotion(dt, self?.alive === true && !introActive, ads);
      this.updateWeaponView();
      this.animateWeapon(now, ads, reloading);
    } else {
      this.updateIntroOverlay(now);
      this.updateViewMotion(dt, false, false);
    }

    this.interpolateActors(dt);
    this.arena.updateWeather(dt);
    this.updateBursts(dt);
    this.composer.render();
  }

  private processCombatInput(now: number, self?: PlayerSnapshot): void {
    const firePressed = this.controller.consumeFirePressed();
    const reloadPressed = this.controller.consumeReloadPressed();
    if (this.screen !== 'match' || this.isIntroActive(now) || self?.alive !== true) {
      return;
    }

    const weapon = weaponDefinitions[(self?.profile ?? this.profile).loadout.weapon];
    const fullAuto = weapon.id === 'ar' || weapon.id === 'smg' || weapon.id === 'mg';
    const wantsFire = fullAuto ? this.controller.isFireHeld() : firePressed;
    if (wantsFire && now - this.lastFireRequestAt >= Math.max(45, weapon.fireDelayMs * 0.9)) {
      this.lastFireRequestAt = now;
      if (this.localMode) {
        this.fireLocalWeapon();
      } else {
        this.network.send({ type: 'input', input: this.controller.getInput() });
        this.network.send({ type: 'fire', sequence: this.shotSequence });
        this.shotSequence += 1;
      }
    }

    if (reloadPressed && now - this.lastReloadRequestAt >= 320) {
      this.lastReloadRequestAt = now;
      if (this.localMode) {
        const localSelf = this.localSelf;
        if (this.reloadLocalActor(localSelf) && localSelf) {
          this.audio.playReload(localSelf.profile.loadout.weapon);
        }
      } else {
        this.network.send({ type: 'reload' });
      }
    }
  }

  /** Smoothly move remote player meshes toward their latest server position each frame. */
  private interpolateActors(dt: number): void {
    const lerpFactor = Math.min(1, dt * 12);
    for (const actor of this.actors.values()) {
      actor.group.position.x += (actor.targetX - actor.group.position.x) * lerpFactor;
      actor.group.position.z += (actor.targetZ - actor.group.position.z) * lerpFactor;
      // Shortest-path yaw interpolation.
      let yawDiff = actor.targetYaw - actor.group.rotation.y;
      if (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
      if (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
      actor.group.rotation.y += yawDiff * lerpFactor;
    }
  }

  private isIntroActive(now = performance.now()): boolean {
    return this.screen === 'match' && now < this.matchStartsAt;
  }

  private updateIntroOverlay(now: number): void {
    const intro = this.hud.querySelector<HTMLDivElement>('.match-intro');
    if (!intro || this.screen !== 'match') {
      intro?.classList.add('hidden');
      return;
    }

    if (now < this.matchStartsAt) {
      const seconds = Math.max(1, Math.ceil((this.matchStartsAt - now) / 1000));
      intro.textContent = String(seconds);
      intro.className = 'match-intro match-intro--count';
      return;
    }

    if (!this.introAnnounced) {
      this.introAnnounced = true;
      this.introBannerUntil = now + 1200;
      if ((this.snapshot?.mode ?? this.localGameMode) === 'ffa') {
        this.audio.playFreeForAll();
      }
    }

    if (now < this.introBannerUntil) {
      intro.textContent = this.snapshot?.mode === 'tdm' || this.localGameMode === 'tdm' ? 'TEAM DEATHMATCH' : 'FREE FOR ALL';
      intro.className = 'match-intro match-intro--go';
    } else {
      intro.classList.add('hidden');
    }
  }

  private updateRemoteFootsteps(snapshot: MatchSnapshot): void {
    if (this.localMode || this.screen !== 'match') {
      return;
    }
    const self = snapshot.players.find((player) => player.id === snapshot.selfId);
    if (!self?.alive || this.isIntroActive()) {
      return;
    }

    const seen = new Set<string>();
    for (const player of snapshot.players) {
      if (player.id === snapshot.selfId || !player.alive) {
        continue;
      }
      seen.add(player.id);
      const previous = this.remoteFootsteps.get(player.id);
      const distanceMoved = previous ? Math.hypot(player.x - previous.x, player.z - previous.z) : 0;
      const distanceToSelf = Math.hypot(player.x - self.x, player.z - self.z);
      const lastStepAt = previous?.lastStepAt ?? 0;
      if (previous && distanceMoved > 0.18 && distanceToSelf < 24 && snapshot.serverTime - lastStepAt > 360) {
        const volumeScale = Math.max(0.12, 1 - distanceToSelf / 24) * 0.72;
        this.audio.playFootstep('walk', volumeScale);
        this.remoteFootsteps.set(player.id, { x: player.x, z: player.z, lastStepAt: snapshot.serverTime });
      } else {
        this.remoteFootsteps.set(player.id, { x: player.x, z: player.z, lastStepAt });
      }
    }

    for (const id of this.remoteFootsteps.keys()) {
      if (!seen.has(id)) {
        this.remoteFootsteps.delete(id);
      }
    }
  }

  private getAudioScaleForPlayer(playerId: string, maxDistance: number): number {
    if (playerId === this.selfId || maxDistance <= 0 || !this.snapshot) {
      return 1;
    }
    const self = this.snapshot.players.find((player) => player.id === this.snapshot?.selfId);
    const player = this.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!self || !player) {
      return 0.35;
    }
    const distance = Math.hypot(player.x - self.x, player.z - self.z);
    return Math.max(0.12, 1 - distance / maxDistance);
  }

  private animateWeapon(now: number, ads: boolean, reloading = false): void {
    const weapon = weaponDefinitions[this.profile.loadout.weapon];
    const sniperScoped = ads && weapon.id === 'sniper' && this.profile.loadout.opticId === 'sniper_scope' && !this.isIntroActive();
    const targetFov = ads ? (weapon.id === 'sniper' ? 22 : weapon.adsFov) : 74;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 0.14);
    this.camera.updateProjectionMatrix();
    this.weaponKick = THREE.MathUtils.lerp(this.weaponKick, 0, 0.18);
    this.reloadVisual = THREE.MathUtils.lerp(this.reloadVisual, reloading ? 1 : 0, reloading ? 0.22 : 0.16);
    const reloadCycle = this.reloadVisual * Math.sin(now * 0.012);
    const reloadLift = this.reloadVisual * Math.sin(now * 0.018 + 0.8);
    const bobSwing = Math.sin(this.headBobPhase) * 0.012 * this.headBobStrength;
    const bobLift = Math.abs(Math.sin(this.headBobPhase * 2)) * 0.015 * this.headBobStrength;
    const aimPose = getWeaponAimPose(weapon.id, ads);
    this.weaponView.visible = !sniperScoped;
    this.weaponView.position.set(
      aimPose.x + bobSwing * 0.65 + this.reloadVisual * 0.18,
      aimPose.y + (ads ? 0 : Math.sin(now * 0.006) * 0.012) + bobLift * 0.7 - this.weaponKick * 0.32 - this.reloadVisual * 0.26 + reloadLift * 0.035,
      aimPose.z + this.weaponKick + this.reloadVisual * 0.2,
    );
    this.weaponView.rotation.set(
      aimPose.pitch + this.reloadVisual * 0.24 + reloadLift * 0.04,
      aimPose.yaw - this.reloadVisual * 0.18,
      aimPose.roll + this.reloadVisual * 0.62 + reloadCycle * 0.12,
    );
  }

  private updateViewMotion(dt: number, alive: boolean, ads: boolean): void {
    const input = this.controller.getInput();
    const moving = alive && (input.forward || input.backward || input.left || input.right);
    let targetStrength = 0;
    let cadence = 0;

    if (moving) {
      targetStrength = input.crouch ? 0.34 : input.sprint ? 1 : 0.68;
      cadence = input.crouch ? 6.4 : input.sprint ? 10.8 : 8.2;
      if (ads) {
        targetStrength *= 0.42;
      }
      this.headBobPhase += dt * cadence;
    }

    const smoothing = Math.min(1, dt * 8);
    this.headBobStrength = THREE.MathUtils.lerp(this.headBobStrength, targetStrength, smoothing);

    const lateral = Math.sin(this.headBobPhase) * 0.011 * this.headBobStrength;
    const vertical = Math.abs(Math.sin(this.headBobPhase * 2)) * 0.017 * this.headBobStrength;
    const roll = Math.sin(this.headBobPhase) * 0.016 * this.headBobStrength;
    this.camera.position.y = this.controller.getEyeHeight() + vertical;
    this.camera.rotation.z = THREE.MathUtils.lerp(this.camera.rotation.z, roll, Math.min(1, dt * 10));

    this.hitmarkerTimer = Math.max(0, this.hitmarkerTimer - dt);
    const crosshair = this.hud.querySelector<HTMLDivElement>('.combat-crosshair');
    const scope = this.hud.querySelector<HTMLDivElement>('.scope-overlay');
    const sniperScoped =
      ads && this.profile.loadout.weapon === 'sniper' && this.profile.loadout.opticId === 'sniper_scope' && alive && !this.isIntroActive();
    if (crosshair) {
      crosshair.classList.toggle('combat-crosshair--ads', ads);
      crosshair.classList.toggle('combat-crosshair--scope-hidden', sniperScoped);
      if (this.hitmarkerTimer <= 0) {
        crosshair.classList.remove('combat-crosshair--hit', 'combat-crosshair--kill');
      }
      crosshair.style.setProperty('--crosshair-shift-x', `${lateral.toFixed(4)}px`);
      crosshair.style.setProperty('--crosshair-shift-y', `${(vertical * -20).toFixed(4)}px`);
    }
    scope?.classList.toggle('hidden', !sniperScoped);
  }

  private updateFootsteps(dt: number): void {
    const input = this.controller.getInput();
    const moving = input.forward || input.backward || input.left || input.right;
    if (!moving) {
      this.footstepTimer = 0;
      return;
    }

    this.footstepTimer -= dt;
    if (this.footstepTimer > 0) {
      return;
    }

    if (input.crouch) {
      this.footstepTimer = 0.64;
      this.audio.playFootstep('crouch');
    } else if (input.sprint) {
      this.footstepTimer = 0.27;
      this.audio.playFootstep('sprint');
    } else {
      this.footstepTimer = 0.43;
      this.audio.playFootstep('walk');
    }
  }

  private createComposer(): EffectComposer {
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.16, 0.38, 0.86);
    composer.addPass(bloom);
    composer.addPass(new SMAAPass());
    composer.addPass(new OutputPass());
    return composer;
  }

  private createMuzzleFlash(position: [number, number, number]): void {
    const material = new THREE.MeshBasicMaterial({ color: '#ffd34a', transparent: true, opacity: 0.95, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.42, 7), material);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.rotation.set(Math.PI / 2 + Math.random() * 0.4, Math.random() * Math.PI, Math.random() * Math.PI);
    this.scene.add(mesh);
    this.bursts.push({ mesh, material, age: 0, life: 0.065, maxScale: 2.2 });
  }

  private createImpactSpark(position: [number, number, number], killed: boolean): void {
    const material = new THREE.MeshBasicMaterial({
      color: killed ? '#ff5f4a' : '#f2c14e',
      transparent: true,
      opacity: 0.78,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(killed ? 0.26 : 0.18, 10, 8), material);
    mesh.position.set(position[0], position[1], position[2]);
    this.scene.add(mesh);
    this.bursts.push({ mesh, material, age: 0, life: killed ? 0.18 : 0.12, maxScale: killed ? 3.2 : 2.1 });
  }

  private updateBursts(dt: number): void {
    for (const burst of this.bursts) {
      burst.age += dt;
      const progress = Math.min(1, burst.age / burst.life);
      const scale = THREE.MathUtils.lerp(1, burst.maxScale, progress);
      burst.mesh.scale.setScalar(scale);
      burst.material.opacity = Math.max(0, 1 - progress);
    }
    const live = this.bursts.filter((burst) => burst.age < burst.life);
    for (const burst of this.bursts) {
      if (!live.includes(burst)) {
        this.scene.remove(burst.mesh);
        burst.mesh.geometry.dispose();
        burst.material.dispose();
      }
    }
    this.bursts = live;
  }

  private goBackFromCustomize(backTo: 'menu' | 'lobby'): void {
    if (backTo === 'lobby' && this.lobby) {
      this.renderLobby();
      return;
    }
    this.renderMenu();
  }

  private showToast(message: string): void {
    const toast = this.root.querySelector<HTMLDivElement>(':scope > .toast') ?? document.createElement('div');
    toast.className = 'toast visible';
    toast.textContent = message;
    if (!toast.parentElement) {
      this.root.appendChild(toast);
    }
    window.setTimeout(() => toast.classList.remove('visible'), 2600);
  }

  private getStatusLabel(): string {
    if (this.networkStatus === 'online') return 'Server online';
    if (this.networkStatus === 'connecting') return 'Connecting';
    return 'Not connected';
  }

  private resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  private mustFind<T extends HTMLElement>(selector: string, root: ParentNode = this.overlay): T {
    const element = root.querySelector<T>(selector);
    if (!element) {
      throw new Error(`Missing UI element: ${selector}`);
    }
    return element;
  }
}

function createCamoTexture(camo: CamoDefinition): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new THREE.CanvasTexture(canvas);
  }
  const [base, mid, dark, light = mid] = camo.swatches;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  if (camo.pattern === 'solid') {
    ctx.fillStyle = mid;
    ctx.globalAlpha = 0.22;
    for (let i = 0; i < 24; i += 1) {
      ctx.fillRect((i * 17) % size, (i * 29) % size, 18, 3);
    }
  } else if (camo.pattern === 'digital') {
    const colors = [mid, dark, light];
    for (let i = 0; i < 72; i += 1) {
      ctx.fillStyle = colors[i % colors.length];
      const block = i % 3 === 0 ? 16 : 8;
      ctx.fillRect((i * 23) % size, (i * 41) % size, block, block);
    }
  } else if (camo.pattern === 'stripe') {
    const colors = [dark, mid, light];
    ctx.lineWidth = 10;
    let stripe = 0;
    for (let i = -size; i < size * 2; i += 18) {
      ctx.strokeStyle = colors[stripe % colors.length];
      ctx.beginPath();
      ctx.moveTo(i, size);
      ctx.bezierCurveTo(i + 20, 90, i - 18, 42, i + 32, 0);
      ctx.stroke();
      stripe += 1;
    }
  } else if (camo.pattern === 'woodland') {
    const colors = [mid, dark, light];
    for (let i = 0; i < 26; i += 1) {
      ctx.fillStyle = colors[i % colors.length];
      ctx.beginPath();
      ctx.ellipse((i * 31) % size, (i * 47) % size, 24, 11, i * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, dark);
    gradient.addColorStop(0.45, base);
    gradient.addColorStop(1, light);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    for (let i = 0; i < size; i += 12) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i - 38, size);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let i = 0; i < 32; i += 1) {
    ctx.fillRect((i * 13) % size, (i * 19) % size, 2, 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.6, 1.6);
  return texture;
}

function loadProfile(progression: ProgressionState): PlayerProfile {
  try {
    const raw = localStorage.getItem('matrix-fps-profile');
    if (!raw) {
      return { ...defaultProfile, loadout: { ...defaultProfile.loadout } };
    }
    const parsed = JSON.parse(raw) as PlayerProfile;
    const isOldDefault = parsed.suitColor === '#151a1f' && parsed.accentColor === '#2cff8f';
    return {
      name: cleanName(parsed.name),
      suitColor: isOldDefault ? defaultProfile.suitColor : isHex(parsed.suitColor) ? parsed.suitColor : defaultProfile.suitColor,
      accentColor: isOldDefault
        ? defaultProfile.accentColor
        : isHex(parsed.accentColor)
          ? parsed.accentColor
          : defaultProfile.accentColor,
      loadout: normalizeLoadout(parsed.loadout, progression),
    };
  } catch {
    return { ...defaultProfile, loadout: { ...defaultProfile.loadout } };
  }
}

function loadProgression(): ProgressionState {
  try {
    const raw = localStorage.getItem('yardline-progression');
    return normalizeProgression(raw ? JSON.parse(raw) : defaultProgression);
  } catch {
    return { ...defaultProgression, unlockedCamos: [...defaultProgression.unlockedCamos], unlockedOptics: [...defaultProgression.unlockedOptics] };
  }
}

function loadLocalSettings(): LocalSettings {
  try {
    const raw = localStorage.getItem('yardline-local-settings');
    if (!raw) {
      return { mode: 'ffa', botCount: 1, botDifficulty: 'normal', quality: 'ultra', timeOfDay: 'day', weather: 'clear' };
    }
    const parsed = JSON.parse(raw) as Partial<LocalSettings>;
    return {
      mode: parsed.mode === 'tdm' ? 'tdm' : 'ffa',
      botCount: Number.isFinite(parsed.botCount) ? THREE.MathUtils.clamp(Math.round(parsed.botCount ?? 1), 1, 7) : 1,
      botDifficulty: parsed.botDifficulty === 'hard' ? 'hard' : 'normal',
      quality: parsed.quality === 'performance' ? 'performance' : parsed.quality === 'high' ? 'high' : 'ultra',
      timeOfDay: parsed.timeOfDay === 'night' ? 'night' : 'day',
      weather: parsed.weather === 'rain' ? 'rain' : 'clear',
    };
  } catch {
    return { mode: 'ffa', botCount: 1, botDifficulty: 'normal', quality: 'ultra', timeOfDay: 'day', weather: 'clear' };
  }
}

function createBotProfile(index: number): PlayerProfile {
  const botNames = ['Viper', 'Rook', 'Havoc', 'Iris', 'Nomad', 'Mace', 'Reaper'];
  const weapons: WeaponClass[] = ['ar', 'smg', 'mg', 'sniper', 'ar', 'smg', 'mg'];
  const tacticals: TacticalMod[] = ['armor_plate', 'lightweight', 'quick_hands', 'quick_hands', 'lightweight', 'armor_plate', 'quick_hands'];
  const suits = ['#394047', '#333834', '#463b34', '#303b42', '#3d4038', '#42383a', '#35353f'];
  const accents = ['#d64f43', '#5c8bd8', '#e0b84e', '#7fc782', '#d99242', '#d8d0bd', '#9f76d6'];
  return {
    name: botNames[index % botNames.length],
    suitColor: suits[index % suits.length],
    accentColor: accents[index % accents.length],
    loadout: {
      weapon: weapons[index % weapons.length],
      tactical: tacticals[index % tacticals.length],
      camoId: (['woodland', 'urban', 'desert', 'matte_black', 'digital', 'tiger', 'matte_black'] as CamoId[])[index % 7],
      opticId: getDefaultOpticForWeapon(weapons[index % weapons.length]),
    },
  };
}

function cleanName(value: string): string {
  const cleaned = value.replace(/[^\w -]/g, '').trim().slice(0, 18);
  return cleaned || defaultProfile.name;
}

function isHex(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remaining}`;
}

function formatTeamName(team: TeamId): string {
  return team === 'alpha' ? 'Alpha' : 'Bravo';
}

function getProfileKey(profile: PlayerProfile, team?: TeamId): string {
  return `${profile.name}:${profile.suitColor}:${profile.accentColor}:${profile.loadout.weapon}:${profile.loadout.tactical}:${profile.loadout.camoId}:${profile.loadout.opticId}:${team ?? 'solo'}`;
}

function getMaxHealth(profile: PlayerProfile): number {
  return profile.loadout.tactical === 'armor_plate' ? 125 : 100;
}

function getWeaponAimPose(weapon: WeaponClass, ads: boolean): { x: number; y: number; z: number; pitch: number; yaw: number; roll: number } {
  if (!ads) {
    return { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
  }
  switch (weapon) {
    case 'ar':
      return { x: -0.28, y: 0.045, z: 0.17, pitch: 0.005, yaw: 0.012, roll: 0 };
    case 'smg':
      return { x: -0.29, y: 0.035, z: 0.2, pitch: 0, yaw: 0.01, roll: 0 };
    case 'mg':
      return { x: -0.26, y: 0.055, z: 0.14, pitch: 0.006, yaw: 0.016, roll: 0 };
    case 'sniper':
      return { x: -0.2, y: 0.02, z: 0.24, pitch: 0, yaw: 0, roll: 0 };
  }
}

function hasLineOfSight(from: [number, number, number], to: [number, number, number]): boolean {
  return !arenaColliders.some((rect) => segmentIntersectsRect(from[0], from[2], to[0], to[2], rect));
}

function segmentIntersectsRect(x1: number, z1: number, x2: number, z2: number, rect: { x1: number; x2: number; z1: number; z2: number }): boolean {
  if (
    (x1 > rect.x1 && x1 < rect.x2 && z1 > rect.z1 && z1 < rect.z2) ||
    (x2 > rect.x1 && x2 < rect.x2 && z2 > rect.z1 && z2 < rect.z2)
  ) {
    return true;
  }
  const edges: Array<[number, number, number, number]> = [
    [rect.x1, rect.z1, rect.x2, rect.z1],
    [rect.x2, rect.z1, rect.x2, rect.z2],
    [rect.x2, rect.z2, rect.x1, rect.z2],
    [rect.x1, rect.z2, rect.x1, rect.z1],
  ];
  return edges.some((edge) => segmentsIntersect(x1, z1, x2, z2, edge[0], edge[1], edge[2], edge[3]));
}

function segmentsIntersect(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const denominator = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
  if (Math.abs(denominator) < 0.0001) {
    return false;
  }
  const ua = ((dx - cx) * (az - cz) - (dz - cz) * (ax - cx)) / denominator;
  const ub = ((bx - ax) * (az - cz) - (bz - az) * (ax - cx)) / denominator;
  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
