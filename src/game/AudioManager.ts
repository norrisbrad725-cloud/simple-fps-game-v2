import type { WeaponClass } from '../shared/protocol';

type AudioKey =
  | 'gun-ar'
  | 'gun-smg'
  | 'gun-mg'
  | 'gun-sniper'
  | 'hitmarker'
  | 'killmarker'
  | 'reload-general'
  | 'reload-rifle'
  | 'reload-finish'
  | 'footstep-1'
  | 'footstep-2'
  | 'footstep-3'
  | 'footstep-4'
  | 'footstep-5'
  | 'footstep-6';

type PoolMap = Record<AudioKey, HTMLAudioElement[]>;

interface SfxMetadata {
  startOffsetMs: number;
  maxDurationMs?: number;
}

const sfxPaths: Record<AudioKey, string> = {
  'gun-ar': '/audio/sfx/gun-ar.wav',
  'gun-smg': '/audio/sfx/gun-smg.wav',
  'gun-mg': '/audio/sfx/gun-mg.wav',
  'gun-sniper': '/audio/sfx/gun-sniper.wav',
  hitmarker: '/audio/sfx/hitmarker.wav',
  killmarker: '/audio/sfx/killmarker.wav',
  'reload-general': '/audio/sfx/reload-general.wav',
  'reload-rifle': '/audio/sfx/reload-rifle.wav',
  'reload-finish': '/audio/sfx/reload-finish.wav',
  'footstep-1': '/audio/sfx/footstep-1.wav',
  'footstep-2': '/audio/sfx/footstep-2.wav',
  'footstep-3': '/audio/sfx/footstep-3.wav',
  'footstep-4': '/audio/sfx/footstep-4.wav',
  'footstep-5': '/audio/sfx/footstep-5.wav',
  'footstep-6': '/audio/sfx/footstep-6.wav',
};

const weaponSound: Record<WeaponClass, AudioKey> = {
  ar: 'gun-ar',
  smg: 'gun-smg',
  mg: 'gun-mg',
  sniper: 'gun-sniper',
};

export const sfxManifest: Record<AudioKey, SfxMetadata> = {
  'gun-ar': { startOffsetMs: 340, maxDurationMs: 150 },
  'gun-smg': { startOffsetMs: 0, maxDurationMs: 125 },
  'gun-mg': { startOffsetMs: 0, maxDurationMs: 190 },
  'gun-sniper': { startOffsetMs: 430, maxDurationMs: 390 },
  hitmarker: { startOffsetMs: 0 },
  killmarker: { startOffsetMs: 0 },
  'reload-general': { startOffsetMs: 0, maxDurationMs: 1180 },
  'reload-rifle': { startOffsetMs: 0, maxDurationMs: 1180 },
  'reload-finish': { startOffsetMs: 0 },
  'footstep-1': { startOffsetMs: 0 },
  'footstep-2': { startOffsetMs: 0 },
  'footstep-3': { startOffsetMs: 0 },
  'footstep-4': { startOffsetMs: 0 },
  'footstep-5': { startOffsetMs: 0 },
  'footstep-6': { startOffsetMs: 0 },
};

export class AudioManager {
  private pools: PoolMap;
  private cursors = new Map<AudioKey, number>();
  private stopTimers = new WeakMap<HTMLAudioElement, number>();
  private unlocked = false;
  private leadPlayers: Record<1 | 2, HTMLAudioElement>;
  private freeForAll: HTMLAudioElement;
  private footstepIndex = 0;

  constructor() {
    this.pools = this.createPools();
    this.leadPlayers = {
      1: this.createAudio('/audio/lead-player-1.mp4', 0.9),
      2: this.createAudio('/audio/lead-player-2.mp4', 0.9),
    };
    this.freeForAll = this.createAudio('/audio/freeforall.mp4', 0.92);
    window.addEventListener('pointerdown', () => this.unlock(), { once: true });
    window.addEventListener('keydown', () => this.unlock(), { once: true });
  }

  preload(): void {
    Object.values(this.pools).flat().forEach((audio) => audio.load());
    Object.values(this.leadPlayers).forEach((audio) => audio.load());
    this.freeForAll.load();
  }

  unlock(): void {
    this.unlocked = true;
    this.preload();
  }

  playGunshot(weapon: WeaponClass, distant = false): void {
    const key = weaponSound[weapon];
    const base = distant ? 0.36 : weapon === 'sniper' ? 0.86 : weapon === 'mg' ? 0.76 : weapon === 'smg' ? 0.64 : 0.69;
    const rate = (weapon === 'smg' ? 1.08 : weapon === 'mg' ? 0.94 : weapon === 'sniper' ? 0.88 : 1) + (Math.random() - 0.5) * 0.045;
    const metadata = sfxManifest[key];
    this.play(key, { volume: base, playbackRate: rate, maxDurationMs: metadata.maxDurationMs, startOffsetMs: metadata.startOffsetMs });
  }

  playHitmarker(killed: boolean): void {
    this.play('hitmarker', { volume: killed ? 1 : 0.92, playbackRate: killed ? 0.92 : 1.08 });
    if (killed) {
      window.setTimeout(() => this.play('killmarker', { volume: 0.96, playbackRate: 0.95 }), 34);
    }
  }

  playReload(weapon: WeaponClass, volumeScale = 1): void {
    this.play(weapon === 'smg' ? 'reload-general' : 'reload-rifle', {
      volume: 0.58 * volumeScale,
      playbackRate: weapon === 'mg' ? 0.86 : weapon === 'sniper' ? 0.92 : 1,
      maxDurationMs: weapon === 'mg' ? 1450 : sfxManifest[weapon === 'smg' ? 'reload-general' : 'reload-rifle'].maxDurationMs,
    });
  }

  playReloadFinish(): void {
    this.play('reload-finish', { volume: 0.42, playbackRate: 0.95 });
  }

  playFootstep(speed: 'walk' | 'sprint' | 'crouch', volumeScale = 1): void {
    const keys: AudioKey[] = ['footstep-1', 'footstep-2', 'footstep-3', 'footstep-4', 'footstep-5', 'footstep-6'];
    const key = keys[this.footstepIndex % keys.length];
    this.footstepIndex += 1;
    this.play(key, {
      volume: (speed === 'crouch' ? 0.2 : speed === 'sprint' ? 0.46 : 0.32) * volumeScale,
      playbackRate: speed === 'sprint' ? 1.1 + Math.random() * 0.04 : speed === 'crouch' ? 0.84 : 0.95 + Math.random() * 0.1,
    });
    if (speed === 'sprint') {
      window.setTimeout(() => {
        this.play(key, { volume: 0.12 * volumeScale, playbackRate: 0.82 + Math.random() * 0.08 });
      }, 24);
    }
  }

  playLeadCallout(playerNumber: 1 | 2): void {
    if (!this.unlocked) {
      return;
    }
    const audio = this.leadPlayers[playerNumber];
    audio.pause();
    audio.currentTime = 0;
    audio.volume = 0.9;
    void audio.play().catch(() => undefined);
  }

  playFreeForAll(): void {
    if (!this.unlocked) {
      return;
    }
    this.freeForAll.pause();
    this.freeForAll.currentTime = 0;
    this.freeForAll.volume = 0.92;
    void this.freeForAll.play().catch(() => undefined);
  }

  private createPools(): PoolMap {
    const entries = Object.entries(sfxPaths).map(([key, path]) => {
      const poolSize = key.startsWith('gun-') ? 6 : key.startsWith('footstep') ? 2 : 3;
      return [key, Array.from({ length: poolSize }, () => this.createAudio(path, 0.5))];
    });
    return Object.fromEntries(entries) as PoolMap;
  }

  private createAudio(path: string, volume: number): HTMLAudioElement {
    const audio = new Audio(path);
    audio.preload = 'auto';
    audio.volume = volume;
    audio.loop = false;
    return audio;
  }

  private play(
    key: AudioKey,
    options: { volume: number; playbackRate?: number; maxDurationMs?: number; startOffsetMs?: number },
  ): void {
    if (!this.unlocked) {
      return;
    }
    const pool = this.pools[key];
    const cursor = this.cursors.get(key) ?? 0;
    const audio = pool[cursor % pool.length];
    this.cursors.set(key, cursor + 1);
    const timer = this.stopTimers.get(audio);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.stopTimers.delete(audio);
    }
    audio.pause();
    try {
      audio.currentTime = (options.startOffsetMs ?? sfxManifest[key].startOffsetMs) / 1000;
    } catch {
      audio.currentTime = 0;
    }
    audio.volume = options.volume;
    audio.playbackRate = options.playbackRate ?? 1;
    void audio.play().catch(() => undefined);
    if (options.maxDurationMs !== undefined) {
      const stopTimer = window.setTimeout(() => {
        audio.pause();
        audio.currentTime = 0;
        this.stopTimers.delete(audio);
      }, options.maxDurationMs);
      this.stopTimers.set(audio, stopTimer);
    }
  }
}
