import * as THREE from 'three';
import type { InputPayload } from '../shared/protocol';
import type { ContainerYard } from './ContainerYard';

export class PlayerController {
  readonly camera: THREE.PerspectiveCamera;
  private canvas: HTMLCanvasElement;
  private arena: ContainerYard;
  private keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private height = 1.7;
  private locked = false;
  private mouseAds = false;
  private gamepadAds = false;
  private mouseFireHeld = false;
  private gamepadFireHeld = false;
  private gamepadSprintHeld = false;
  private firePressed = false;
  private reloadPressed = false;
  private gamepadMoveX = 0;
  private gamepadMoveY = 0;
  private slideUntil = 0;
  private slideDirection = new THREE.Vector3(0, 0, -1);
  private slideStartedAt = 0;
  private previousGamepadButtons = new Map<number, boolean>();

  constructor(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement, arena: ContainerYard) {
    this.camera = camera;
    this.canvas = canvas;
    this.arena = arena;
    this.bindEvents();
    this.applyRotation();
  }

  requestLock(): void {
    const lockResult = this.canvas.requestPointerLock();
    if (lockResult instanceof Promise) {
      lockResult.catch(() => undefined);
    }
  }

  setPose(x: number, y: number, z: number, yaw?: number, pitch?: number): void {
    this.camera.position.set(x, y, z);
    this.height = y;
    if (!this.locked) {
      this.yaw = yaw ?? this.yaw;
      this.pitch = pitch ?? this.pitch;
      this.applyRotation();
    }
  }

  /** Smoothly reconcile with the server position. Only corrects if the
   *  discrepancy exceeds a threshold, and never overrides yaw/pitch while the
   *  player is actively controlling (pointer locked). */
  reconcile(serverX: number, serverY: number, serverZ: number): void {
    const dx = serverX - this.camera.position.x;
    const dz = serverZ - this.camera.position.z;
    const distSq = dx * dx + dz * dz;

    // If the server and client agree within ~0.3 units, trust the client prediction fully.
    if (distSq < 0.09) {
      return;
    }

    // Large teleport (respawn, lag spike > 5 units) — snap immediately.
    if (distSq > 25) {
      this.camera.position.set(serverX, serverY, serverZ);
      this.height = serverY;
      return;
    }

    // Moderate discrepancy — blend toward the server position smoothly.
    const blend = 0.15;
    this.camera.position.x += dx * blend;
    this.camera.position.z += dz * blend;
    this.height = THREE.MathUtils.lerp(this.height, serverY, blend);
  }

  updateLocal(dt: number): void {
    this.updateGamepad(dt);
    const input = this.getInput();
    const desiredHeight = input.slide ? 1.02 : input.crouch ? 1.18 : 1.7;
    this.height = THREE.MathUtils.lerp(this.height, desiredHeight, Math.min(1, dt * 12));
    const slideActive = this.isSliding();
    const slideProgress = slideActive ? THREE.MathUtils.clamp((performance.now() - this.slideStartedAt) / 720, 0, 1) : 1;
    const speed = slideActive
      ? THREE.MathUtils.lerp(12.8, 6.4, slideProgress)
      : (input.sprint ? 9.4 : 7.0) * (input.crouch ? 0.58 : 1) * (input.ads ? 0.76 : 1);
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const move = new THREE.Vector3();

    if (slideActive) {
      move.copy(this.slideDirection);
    } else {
      const analogX = Math.abs(this.gamepadMoveX) > 0.08 ? this.gamepadMoveX : 0;
      const analogY = Math.abs(this.gamepadMoveY) > 0.08 ? this.gamepadMoveY : 0;
      if (input.forward) move.add(forward);
      if (input.backward) move.sub(forward);
      if (input.right) move.add(right);
      if (input.left) move.sub(right);
      if (analogY !== 0) move.addScaledVector(forward, -analogY);
      if (analogX !== 0) move.addScaledVector(right, analogX);
    }
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed * dt);
      const nextX = this.camera.position.x + move.x;
      const nextZ = this.camera.position.z + move.z;
      const radius = input.crouch || input.slide ? 0.36 : 0.44;
      if (!this.arena.isBlocked(nextX, this.camera.position.z, radius)) {
        this.camera.position.x = nextX;
      }
      if (!this.arena.isBlocked(this.camera.position.x, nextZ, radius)) {
        this.camera.position.z = nextZ;
      }
      const resolved = this.arena.resolvePosition(this.camera.position.x, this.camera.position.z, radius);
      this.camera.position.x = resolved.x;
      this.camera.position.z = resolved.z;
    }
    this.camera.position.y = this.height;
  }

  getInput(): InputPayload {
    const slide = this.isSliding();
    return {
      forward: this.keys.has('KeyW') || this.gamepadMoveY < -0.35,
      backward: this.keys.has('KeyS') || this.gamepadMoveY > 0.35,
      left: this.keys.has('KeyA') || this.gamepadMoveX < -0.35,
      right: this.keys.has('KeyD') || this.gamepadMoveX > 0.35,
      sprint: this.isSprintHeld() && !slide,
      crouch: slide || this.keys.has('KeyC') || this.keys.has('ControlLeft') || this.keys.has('ControlRight'),
      slide,
      yaw: this.yaw,
      pitch: this.pitch,
      ads: (this.mouseAds || this.gamepadAds) && !slide,
    };
  }

  isFireHeld(): boolean {
    return this.mouseFireHeld || this.gamepadFireHeld;
  }

  consumeFirePressed(): boolean {
    const pressed = this.firePressed;
    this.firePressed = false;
    return pressed;
  }

  consumeReloadPressed(): boolean {
    const pressed = this.reloadPressed;
    this.reloadPressed = false;
    return pressed;
  }

  getForwardDirection(): THREE.Vector3 {
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    return direction.normalize();
  }

  getEyeHeight(): number {
    return this.height;
  }

  addRecoil(amount: number): void {
    this.pitch = THREE.MathUtils.clamp(this.pitch + amount, -1.35, 1.35);
    this.applyRotation();
  }

  isLocked(): boolean {
    return this.locked;
  }

  private isSliding(): boolean {
    return performance.now() < this.slideUntil;
  }

  private startOrCancelSlide(): void {
    if (this.isSliding()) {
      this.slideUntil = 0;
      return;
    }
    if (!this.isSprintHeld() || !this.hasForwardIntent()) {
      return;
    }
    this.slideStartedAt = performance.now();
    this.slideUntil = this.slideStartedAt + 720;
    this.slideDirection.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
  }

  private hasForwardIntent(): boolean {
    return this.keys.has('KeyW') || this.gamepadMoveY < -0.35;
  }

  private isSprintHeld(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.gamepadSprintHeld;
  }

  private bindEvents(): void {
    this.canvas.addEventListener('click', () => {
      if (!this.locked) {
        this.requestLock();
      }
    });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.canvas.addEventListener('mousedown', (event) => {
      if (!this.locked) {
        return;
      }
      if (event.button === 0) {
        if (!this.mouseFireHeld) {
          this.firePressed = true;
        }
        this.mouseFireHeld = true;
      }
      if (event.button === 2) {
        this.mouseAds = true;
        if (this.isSliding()) {
          this.slideUntil = 0;
        }
      }
    });
    this.canvas.addEventListener('mouseup', (event) => {
      if (event.button === 0) {
        this.mouseFireHeld = false;
      }
      if (event.button === 2) {
        this.mouseAds = false;
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.resetTransientInput();
      }
    });
    document.addEventListener('mousemove', (event) => {
      if (!this.locked) {
        return;
      }
      if ((event.buttons & 1) === 0) {
        this.mouseFireHeld = false;
      }
      if ((event.buttons & 2) === 0) {
        this.mouseAds = false;
      }
      const sensitivity = this.mouseAds || this.gamepadAds ? 0.00135 : 0.0021;
      this.yaw -= event.movementX * sensitivity;
      this.pitch -= event.movementY * sensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -1.35, 1.35);
      this.applyRotation();
    });
    document.addEventListener('keydown', (event) => {
      this.keys.add(event.code);
      if (event.code === 'KeyR' && !event.repeat) {
        this.reloadPressed = true;
      }
      if ((event.code === 'KeyC' || event.code === 'ControlLeft' || event.code === 'ControlRight') && !event.repeat) {
        this.startOrCancelSlide();
      }
    });
    document.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.resetTransientInput();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.resetTransientInput();
      }
    });
  }

  private applyRotation(): void {
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  private updateGamepad(dt: number): void {
    const gamepad = this.getPrimaryGamepad();
    if (!gamepad) {
      this.gamepadMoveX = 0;
      this.gamepadMoveY = 0;
      this.gamepadFireHeld = false;
      this.gamepadAds = false;
      this.gamepadSprintHeld = false;
      this.previousGamepadButtons.clear();
      return;
    }

    this.gamepadMoveX = this.applyDeadzone(gamepad.axes[0] ?? 0, 0.14);
    this.gamepadMoveY = this.applyDeadzone(gamepad.axes[1] ?? 0, 0.14);
    const lookX = this.applyDeadzone(gamepad.axes[2] ?? 0, 0.16);
    const lookY = this.applyDeadzone(gamepad.axes[3] ?? 0, 0.16);
    const lookScale = (this.mouseAds || this.gamepadAds ? 1.45 : 2.3) * dt;
    this.yaw -= lookX * lookScale;
    this.pitch = THREE.MathUtils.clamp(this.pitch - lookY * lookScale, -1.35, 1.35);
    this.applyRotation();

    this.gamepadAds = this.isButtonPressed(gamepad, 6);
    this.gamepadSprintHeld = this.isButtonPressed(gamepad, 10) || this.isButtonPressed(gamepad, 4);
    const fireHeld = this.isButtonPressed(gamepad, 7);
    if (fireHeld && !this.isGamepadButtonDown(7)) {
      this.firePressed = true;
    }
    this.gamepadFireHeld = fireHeld;
    if (this.isButtonEdge(gamepad, 2)) {
      this.reloadPressed = true;
    }
    if (this.isButtonEdge(gamepad, 1)) {
      this.startOrCancelSlide();
    }
    if (this.gamepadAds && this.isSliding()) {
      this.slideUntil = 0;
    }
    this.storeGamepadButtons(gamepad);
  }

  private getPrimaryGamepad(): Gamepad | undefined {
    const gamepads = navigator.getGamepads?.() ?? [];
    return gamepads.find((gamepad): gamepad is Gamepad => Boolean(gamepad?.connected));
  }

  private applyDeadzone(value: number, deadzone: number): number {
    const absolute = Math.abs(value);
    if (absolute < deadzone) {
      return 0;
    }
    return Math.sign(value) * ((absolute - deadzone) / (1 - deadzone));
  }

  private isButtonPressed(gamepad: Gamepad, index: number): boolean {
    const button = gamepad.buttons[index];
    return button ? button.pressed || button.value > 0.55 : false;
  }

  private isButtonEdge(gamepad: Gamepad, index: number): boolean {
    return this.isButtonPressed(gamepad, index) && !this.isGamepadButtonDown(index);
  }

  private isGamepadButtonDown(index: number): boolean {
    return this.previousGamepadButtons.get(index) === true;
  }

  private storeGamepadButtons(gamepad: Gamepad): void {
    for (let index = 0; index < gamepad.buttons.length; index += 1) {
      this.previousGamepadButtons.set(index, this.isButtonPressed(gamepad, index));
    }
  }

  private resetTransientInput(): void {
    this.mouseAds = false;
    this.gamepadAds = false;
    this.mouseFireHeld = false;
    this.gamepadFireHeld = false;
    this.gamepadSprintHeld = false;
    this.firePressed = false;
    this.reloadPressed = false;
    this.slideUntil = 0;
  }
}
