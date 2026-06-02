import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { arenaBounds, arenaColliders, spawnPoints, type QualityLevel, type RectCollider } from '../shared/protocol';

export type YardTimeOfDay = 'day' | 'night';
export type YardWeather = 'clear' | 'rain';

export interface YardEnvironment {
  timeOfDay: YardTimeOfDay;
  weather: YardWeather;
  quality: QualityLevel;
}

type ContainerPlacement = {
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
  height: number;
  index: number;
};

type YardMaterials = {
  asphalt: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  containerRed: THREE.MeshStandardMaterial;
  containerBlue: THREE.MeshStandardMaterial;
  containerYellow: THREE.MeshStandardMaterial;
  containerGreen: THREE.MeshStandardMaterial;
  barrier: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  darkMetal: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  crate: THREE.MeshStandardMaterial;
  cone: THREE.MeshStandardMaterial;
  coneStripe: THREE.MeshStandardMaterial;
  puddle: THREE.MeshPhysicalMaterial;
  oil: THREE.MeshBasicMaterial;
  sign: THREE.MeshBasicMaterial;
  light: THREE.MeshBasicMaterial;
  spawn: THREE.MeshBasicMaterial;
};

export class ContainerYard {
  readonly colliders: RectCollider[] = arenaColliders;
  readonly spawnPoints = spawnPoints;
  private scene: THREE.Scene;
  private materials: YardMaterials;
  private environment: YardEnvironment;
  private loader = new GLTFLoader();
  private containerModel?: THREE.Group;
  private containerModelLoading = false;
  private containerPlacements: ContainerPlacement[] = [];
  private containerFallbacks: THREE.Object3D[] = [];
  private hemisphere?: THREE.HemisphereLight;
  private sun?: THREE.DirectionalLight;
  private floodLights: THREE.SpotLight[] = [];
  private puddles: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>[] = [];
  private rain?: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private rainPositions?: Float32Array;

  constructor(scene: THREE.Scene, environment: YardEnvironment = { timeOfDay: 'day', weather: 'clear', quality: 'ultra' }) {
    this.scene = scene;
    this.environment = environment;
    this.materials = this.createMaterials();
  }

  build(environment = this.environment): void {
    this.environment = environment;
    this.scene.clear();
    this.applySky();
    this.createLighting();
    this.createGround();
    this.createBoundary();
    this.createContainers();
    this.createBarriers();
    this.createYardDetails();
    this.createSpawnPads();
    this.createWeather();
    this.setEnvironment(this.environment);
  }

  setEnvironment(environment: YardEnvironment): void {
    this.environment = environment;
    this.applySky();
    const night = environment.timeOfDay === 'night';
    const raining = environment.weather === 'rain';
    if (this.hemisphere) {
      this.hemisphere.intensity = night ? 0.34 : 1.18;
      this.hemisphere.color.set(night ? '#9fb6d8' : '#dceaf2');
      this.hemisphere.groundColor.set(night ? '#111821' : '#3b4037');
    }
    if (this.sun) {
      this.sun.intensity = night ? 0.18 : 1.72;
      this.sun.color.set(night ? '#9ab8ff' : '#fff1d0');
    }
    this.floodLights.forEach((light) => {
      light.intensity = night ? 30 : raining ? 22 : 18;
      light.distance = night ? 68 : 58;
    });
    const puddleOpacity =
      environment.quality === 'ultra' ? (raining ? 0.66 : 0.4) : environment.quality === 'high' ? (raining ? 0.48 : 0.3) : raining ? 0.28 : 0.18;
    const puddleRoughness = environment.quality === 'ultra' ? (raining ? 0.025 : 0.08) : environment.quality === 'high' ? 0.08 : 0.18;
    this.puddles.forEach((puddle) => {
      puddle.visible = environment.quality !== 'performance' || raining;
      puddle.material.opacity = puddleOpacity;
      puddle.material.roughness = puddleRoughness;
      puddle.material.metalness = raining && environment.quality === 'ultra' ? 0.02 : 0;
      puddle.material.needsUpdate = true;
    });
    if (this.rain) {
      this.rain.visible = raining;
      this.rain.material.opacity = environment.quality === 'ultra' ? 0.58 : environment.quality === 'high' ? 0.42 : 0.24;
      this.rain.material.size = environment.quality === 'performance' ? 0.04 : 0.055;
    }
  }

  updateWeather(dt: number): void {
    if (this.environment.weather !== 'rain' || !this.rain || !this.rainPositions || !this.rain.visible) {
      return;
    }
    const speed = this.environment.quality === 'performance' ? 15 : 22;
    for (let i = 0; i < this.rainPositions.length; i += 3) {
      this.rainPositions[i + 1] -= speed * dt;
      this.rainPositions[i] += 1.8 * dt;
      if (this.rainPositions[i + 1] < 0.2) {
        this.rainPositions[i] = arenaBounds.x1 + Math.random() * (arenaBounds.x2 - arenaBounds.x1);
        this.rainPositions[i + 1] = 14 + Math.random() * 16;
        this.rainPositions[i + 2] = arenaBounds.z1 + Math.random() * (arenaBounds.z2 - arenaBounds.z1);
      }
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
  }

  isBlocked(x: number, z: number, radius = 0.44): boolean {
    if (
      x - radius < arenaBounds.x1 ||
      x + radius > arenaBounds.x2 ||
      z - radius < arenaBounds.z1 ||
      z + radius > arenaBounds.z2
    ) {
      return true;
    }

    return this.colliders.some(
      (rect) => x + radius > rect.x1 && x - radius < rect.x2 && z + radius > rect.z1 && z - radius < rect.z2,
    );
  }

  resolvePosition(x: number, z: number, radius = 0.44): { x: number; z: number } {
    let resolvedX = THREE.MathUtils.clamp(x, arenaBounds.x1 + radius, arenaBounds.x2 - radius);
    let resolvedZ = THREE.MathUtils.clamp(z, arenaBounds.z1 + radius, arenaBounds.z2 - radius);
    for (let pass = 0; pass < 3; pass += 1) {
      for (const rect of this.colliders) {
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
        resolvedX = THREE.MathUtils.clamp(resolvedX, arenaBounds.x1 + radius, arenaBounds.x2 - radius);
        resolvedZ = THREE.MathUtils.clamp(resolvedZ, arenaBounds.z1 + radius, arenaBounds.z2 - radius);
      }
    }
    return { x: resolvedX, z: resolvedZ };
  }

  private createMaterials(): YardMaterials {
    return {
      asphalt: new THREE.MeshStandardMaterial({
        color: '#252a2c',
        map: this.createAsphaltTexture(),
        roughness: 0.93,
        metalness: 0.02,
      }),
      concrete: new THREE.MeshStandardMaterial({ color: '#777d7d', roughness: 0.86 }),
      containerRed: new THREE.MeshStandardMaterial({
        color: '#8f2f2a',
        map: this.createContainerTexture('#8f2f2a', '#5d201d'),
        roughness: 0.62,
        metalness: 0.28,
      }),
      containerBlue: new THREE.MeshStandardMaterial({
        color: '#245b7d',
        map: this.createContainerTexture('#245b7d', '#17384e'),
        roughness: 0.62,
        metalness: 0.28,
      }),
      containerYellow: new THREE.MeshStandardMaterial({
        color: '#a68431',
        map: this.createContainerTexture('#a68431', '#6e571f'),
        roughness: 0.62,
        metalness: 0.28,
      }),
      containerGreen: new THREE.MeshStandardMaterial({
        color: '#386946',
        map: this.createContainerTexture('#386946', '#23442d'),
        roughness: 0.62,
        metalness: 0.28,
      }),
      barrier: new THREE.MeshStandardMaterial({ color: '#a0a39f', roughness: 0.84 }),
      metal: new THREE.MeshStandardMaterial({ color: '#4b5254', roughness: 0.48, metalness: 0.5 }),
      darkMetal: new THREE.MeshStandardMaterial({ color: '#202427', roughness: 0.58, metalness: 0.58 }),
      rubber: new THREE.MeshStandardMaterial({ color: '#151516', roughness: 0.92, metalness: 0.02 }),
      wood: new THREE.MeshStandardMaterial({ color: '#6f583d', roughness: 0.78, metalness: 0.03 }),
      crate: new THREE.MeshStandardMaterial({ color: '#786c58', roughness: 0.7, metalness: 0.04 }),
      cone: new THREE.MeshStandardMaterial({ color: '#d06a2c', roughness: 0.68, metalness: 0.02 }),
      coneStripe: new THREE.MeshStandardMaterial({ color: '#f4f1e8', roughness: 0.62, metalness: 0.02 }),
      puddle: new THREE.MeshPhysicalMaterial({
        color: '#57636a',
        roughness: 0.08,
        metalness: 0,
        transparent: true,
        opacity: 0.42,
        transmission: 0,
      }),
      oil: new THREE.MeshBasicMaterial({ color: '#07090a', transparent: true, opacity: 0.32 }),
      sign: new THREE.MeshBasicMaterial({ color: '#f2c14e', toneMapped: false }),
      light: new THREE.MeshBasicMaterial({ color: '#fff1c4', toneMapped: false }),
      spawn: new THREE.MeshBasicMaterial({ color: '#f6e27a', transparent: true, opacity: 0.32 }),
    };
  }

  private applySky(): void {
    const night = this.environment.timeOfDay === 'night';
    const raining = this.environment.weather === 'rain';
    const sky = night ? '#101824' : raining ? '#68757c' : '#8b9698';
    this.scene.background = new THREE.Color(sky);
    this.scene.fog = new THREE.Fog(sky, night ? 26 : raining ? 34 : 44, night ? 94 : raining ? 106 : 124);
  }

  private createLighting(): void {
    this.floodLights = [];
    this.hemisphere = new THREE.HemisphereLight('#dceaf2', '#3b4037', 1.18);
    this.scene.add(this.hemisphere);
    const sun = new THREE.DirectionalLight('#fff1d0', 1.72);
    sun.position.set(-24, 34, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -58;
    sun.shadow.camera.right = 58;
    sun.shadow.camera.top = 44;
    sun.shadow.camera.bottom = -44;
    sun.shadow.camera.near = 4;
    sun.shadow.camera.far = 92;
    sun.shadow.bias = -0.00024;
    this.sun = sun;
    this.scene.add(sun);

    const towers: Array<[number, number]> = [
      [-42, -30],
      [42, -30],
      [-42, 30],
      [42, 30],
    ];
    towers.forEach(([x, z]) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 8, 10), this.materials.darkMetal);
      pole.position.set(x, 4, z);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.28, 0.5), this.materials.light);
      lamp.position.set(x, 8.1, z);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 1.3), this.materials.darkMetal);
      arm.position.set(x, 7.7, z + (z < 0 ? 0.58 : -0.58));
      const light = new THREE.SpotLight('#ffe0a3', 18, 58, Math.PI / 5.4, 0.45, 1.6);
      light.position.set(x, 7.85, z);
      light.target.position.set(0, 0, 0);
      light.castShadow = true;
      light.shadow.mapSize.set(512, 512);
      this.floodLights.push(light);
      this.scene.add(pole, lamp, arm, light, light.target);
    });
  }

  private createGround(): void {
    this.puddles = [];
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(arenaBounds.x2 - arenaBounds.x1, arenaBounds.z2 - arenaBounds.z1),
      this.materials.asphalt,
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const lineMaterial = new THREE.MeshBasicMaterial({ color: '#d8c65a', transparent: true, opacity: 0.82 });
    for (let z = -24; z <= 24; z += 16) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(74, 0.025, 0.12), lineMaterial);
      line.position.set(0, 0.028, z);
      this.scene.add(line);
    }
    for (let x = -36; x <= 36; x += 18) {
      const lane = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.025, 54), lineMaterial);
      lane.position.set(x, 0.029, 0);
      this.scene.add(lane);
    }

    const puddles: Array<[number, number, number, number, number]> = [
      [-18, -5, 5.2, 2.1, 0.1],
      [22, 12, 4.8, 1.8, -0.26],
      [2, -24, 6.2, 2.4, 0.22],
      [-32, 18, 3.6, 1.4, 0.6],
    ];
    puddles.forEach(([x, z, width, depth, rotation]) => {
      const puddle = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), this.materials.puddle);
      puddle.position.set(x, 0.035, z);
      puddle.rotation.set(-Math.PI / 2, 0, rotation);
      this.puddles.push(puddle);
      this.scene.add(puddle);
    });
    const oilSpots: Array<[number, number, number]> = [
      [-12, 28, 0.3],
      [17, -28, -0.2],
      [34, -7, 0.7],
      [-28, -14, 0.1],
    ];
    oilSpots.forEach(([x, z, rotation]) => {
      const oil = new THREE.Mesh(new THREE.CircleGeometry(1.5 + Math.random() * 0.7, 18), this.materials.oil);
      oil.position.set(x, 0.037, z);
      oil.rotation.set(-Math.PI / 2, 0, rotation);
      oil.scale.x = 1.8;
      this.scene.add(oil);
    });
  }

  private createBoundary(): void {
    const fenceMaterial = this.materials.metal;
    const posts: Array<[number, number]> = [];
    for (let x = arenaBounds.x1; x <= arenaBounds.x2; x += 6) {
      posts.push([x, arenaBounds.z1], [x, arenaBounds.z2]);
    }
    for (let z = arenaBounds.z1; z <= arenaBounds.z2; z += 6) {
      posts.push([arenaBounds.x1, z], [arenaBounds.x2, z]);
    }
    posts.forEach(([x, z]) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 8), fenceMaterial);
      post.position.set(x, 1.6, z);
      this.scene.add(post);
    });

    this.addFenceRail(0, 1.4, arenaBounds.z1, arenaBounds.x2 - arenaBounds.x1, 0);
    this.addFenceRail(0, 2.5, arenaBounds.z1, arenaBounds.x2 - arenaBounds.x1, 0);
    this.addFenceRail(0, 1.4, arenaBounds.z2, arenaBounds.x2 - arenaBounds.x1, 0);
    this.addFenceRail(0, 2.5, arenaBounds.z2, arenaBounds.x2 - arenaBounds.x1, 0);
    this.addFenceRail(arenaBounds.x1, 1.4, 0, arenaBounds.z2 - arenaBounds.z1, Math.PI / 2);
    this.addFenceRail(arenaBounds.x1, 2.5, 0, arenaBounds.z2 - arenaBounds.z1, Math.PI / 2);
    this.addFenceRail(arenaBounds.x2, 1.4, 0, arenaBounds.z2 - arenaBounds.z1, Math.PI / 2);
    this.addFenceRail(arenaBounds.x2, 2.5, 0, arenaBounds.z2 - arenaBounds.z1, Math.PI / 2);
  }

  private createContainers(): void {
    this.containerPlacements = [];
    this.containerFallbacks = [];
    this.colliders.forEach((rect, index) => {
      const width = rect.x2 - rect.x1;
      const depth = rect.z2 - rect.z1;
      const centerX = rect.x1 + width / 2;
      const centerZ = rect.z1 + depth / 2;
      const isCentral = index === 0;
      const height = isCentral ? 5.2 : index % 4 === 0 ? 4.8 : 2.6;
      const placement = { centerX, centerZ, width, depth, height, index };
      this.containerPlacements.push(placement);
      this.addFallbackContainer(placement);
    });
    if (this.containerModel) {
      this.replaceFallbackContainers();
    } else {
      this.loadContainerModel();
    }
  }

  private addFallbackContainer({ centerX, centerZ, width, depth, height, index }: ContainerPlacement): void {
    const mats = [
      this.materials.containerRed,
      this.materials.containerBlue,
      this.materials.containerYellow,
      this.materials.containerGreen,
    ];
    const group = new THREE.Group();
    const container = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mats[index % mats.length]);
    container.position.set(0, height / 2, 0);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(width + 0.08, 0.12, depth + 0.08), this.materials.metal);
    trim.position.set(0, height + 0.08, 0);
    group.add(container, trim);
      const doorZ = depth / 2 + 0.026;
      [-1, 1].forEach((side) => {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(width * 0.84, height * 0.72, 0.04), this.materials.darkMetal);
      panel.position.set(0, height * 0.52, doorZ * side);
      group.add(panel);
        for (let i = -1; i <= 1; i += 1) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, height * 0.72, 0.055), this.materials.metal);
        bar.position.set(i * width * 0.26, height * 0.52, (doorZ + 0.02) * side);
        group.add(bar);
        }
        const warning = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(1.8, width * 0.38), 0.44), this.materials.sign);
      warning.position.set(-width * 0.18, height * 0.64, (doorZ + 0.045) * side);
        warning.rotation.y = side > 0 ? 0 : Math.PI;
      group.add(warning);
      });

      const grime = new THREE.MeshBasicMaterial({ color: '#070807', transparent: true, opacity: 0.18 });
      const stain = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.44, height * 0.22), grime);
    stain.position.set(width * 0.18, height * 0.55, -depth / 2 - 0.04);
      stain.rotation.y = Math.PI;
    group.add(stain);
    group.position.set(centerX, 0, centerZ);
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    this.containerFallbacks.push(group);
    this.scene.add(group);
  }

  private loadContainerModel(): void {
    if (this.containerModelLoading) {
      return;
    }
    this.containerModelLoading = true;
    this.loader.load(
      '/models/shipyard-container.glb',
      (gltf) => {
        this.containerModel = gltf.scene;
        this.containerModel.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.castShadow = true;
            object.receiveShadow = true;
            if (object.material instanceof THREE.MeshStandardMaterial || object.material instanceof THREE.MeshPhysicalMaterial) {
              object.material.roughness = Math.min(object.material.roughness + 0.18, 0.86);
              object.material.metalness = Math.min(object.material.metalness + 0.08, 0.42);
            }
          }
        });
        this.replaceFallbackContainers();
      },
      undefined,
      () => {
        this.containerModelLoading = false;
      },
    );
  }

  private replaceFallbackContainers(): void {
    if (!this.containerModel) {
      return;
    }
    this.containerFallbacks.forEach((fallback) => this.scene.remove(fallback));
    this.containerFallbacks = [];
    this.containerPlacements.forEach((placement) => this.addModelContainer(placement));
  }

  private addModelContainer({ centerX, centerZ, width, depth, height, index }: ContainerPlacement): void {
    if (!this.containerModel) {
      return;
    }
    const wrapper = new THREE.Group();
    const clone = this.containerModel.clone(true);
    const box = new THREE.Box3().setFromObject(clone);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    clone.position.sub(center);
    wrapper.add(clone);
    wrapper.position.set(centerX, height / 2, centerZ);
    wrapper.scale.set(
      width / Math.max(size.x, 0.001),
      height / Math.max(size.y, 0.001),
      depth / Math.max(size.z, 0.001),
    );
    if (index % 2 === 1 && width < depth) {
      wrapper.rotation.y = Math.PI / 2;
    }
    wrapper.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    this.scene.add(wrapper);
  }

  private createBarriers(): void {
    const barriers: Array<[number, number, number]> = [
      [-12, -8, 0],
      [12, 8, Math.PI],
      [-30, -17, Math.PI / 2],
      [30, 17, Math.PI / 2],
      [0, -15, 0],
      [0, 15, 0],
    ];
    barriers.forEach(([x, z, rotationY]) => {
      const barrier = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.8, 0.55), this.materials.barrier);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.22, 0.42), this.materials.concrete);
      cap.position.y = 0.5;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.7, 0.08, 0.57), this.materials.sign);
      stripe.position.y = 0.16;
      barrier.add(base, cap, stripe);
      barrier.position.set(x, 0.4, z);
      barrier.rotation.y = rotationY;
      barrier.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      this.scene.add(barrier);
    });
  }

  private createYardDetails(): void {
    const truckBody = new THREE.Mesh(new THREE.BoxGeometry(6.8, 2.2, 2.5), this.materials.containerBlue);
    truckBody.position.set(-8, 1.1, 30.8);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.1, 2.4), this.materials.containerRed);
    cab.position.set(-13, 1.05, 30.8);
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.62, 1.35), this.materials.darkMetal);
    windshield.position.set(-14.28, 1.52, 30.8);
    this.scene.add(truckBody, cab);
    this.scene.add(windshield);
    [truckBody, cab, windshield].forEach((mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    for (const x of [-14.1, -11.9, -6.2, -3.7]) {
      [-1, 1].forEach((side) => {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.34, 18), this.materials.rubber);
        wheel.position.set(x, 0.42, 30.8 + side * 1.32);
        wheel.rotation.z = Math.PI / 2;
        wheel.castShadow = true;
        this.scene.add(wheel);
      });
    }

    for (let i = 0; i < 7; i += 1) {
      const tire = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.16, 8, 18), this.materials.rubber);
      tire.position.set(18 + i * 0.52, 0.52, -30.3);
      tire.rotation.x = Math.PI / 2;
      tire.castShadow = true;
      this.scene.add(tire);
    }

    const craneRail = new THREE.Mesh(new THREE.BoxGeometry(70, 0.22, 0.3), this.materials.darkMetal);
    craneRail.position.set(0, 7.2, -33.2);
    const craneLegA = new THREE.Mesh(new THREE.BoxGeometry(0.45, 7.2, 0.45), this.materials.darkMetal);
    const craneLegB = craneLegA.clone();
    craneLegA.position.set(-32, 3.6, -33.2);
    craneLegB.position.set(32, 3.6, -33.2);
    const craneCab = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.2, 1.3), this.materials.containerYellow);
    craneCab.position.set(-18, 6.72, -33.2);
    [craneRail, craneLegA, craneLegB, craneCab].forEach((mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    this.scene.add(craneRail, craneLegA, craneLegB, craneCab);

    this.createInstancedProps();
    this.createCableRuns();
    this.createPalletStacks();
    this.createYardSigns();
  }

  private createInstancedProps(): void {
    const barrelGeometry = new THREE.CylinderGeometry(0.42, 0.42, 1.05, 18);
    const barrelPositions: Array<[number, number, number]> = [
      [-33, 0.53, -2],
      [-34, 0.53, -3.1],
      [33, 0.53, 3.5],
      [34.2, 0.53, 2.3],
      [6.8, 0.53, 25.5],
      [-7.5, 0.53, -25.5],
      [24, 0.53, -13.8],
      [-24, 0.53, 14.2],
    ];
    const barrels = new THREE.InstancedMesh(barrelGeometry, this.materials.darkMetal, barrelPositions.length);
    const dummy = new THREE.Object3D();
    barrelPositions.forEach(([x, y, z], index) => {
      dummy.position.set(x, y, z);
      dummy.rotation.y = index * 0.4;
      dummy.updateMatrix();
      barrels.setMatrixAt(index, dummy.matrix);
    });
    barrels.castShadow = true;
    barrels.receiveShadow = true;
    this.scene.add(barrels);

    const crateGeometry = new THREE.BoxGeometry(1.2, 0.9, 1.2);
    const cratePositions: Array<[number, number, number, number]> = [
      [-20, 0.45, 27, 0.1],
      [-21.3, 0.45, 27.5, -0.15],
      [21, 0.45, -27, 0.2],
      [22.3, 0.45, -27.5, -0.2],
      [-2, 0.45, 16, 0.4],
      [2.4, 0.45, -16, -0.32],
    ];
    const crates = new THREE.InstancedMesh(crateGeometry, this.materials.crate, cratePositions.length);
    cratePositions.forEach(([x, y, z, rotation], index) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, rotation, 0);
      dummy.updateMatrix();
      crates.setMatrixAt(index, dummy.matrix);
    });
    crates.castShadow = true;
    crates.receiveShadow = true;
    this.scene.add(crates);

    const conePositions: Array<[number, number, number]> = [
      [-10, 0.38, 24],
      [-8.8, 0.38, 24.8],
      [10, 0.38, -24],
      [8.8, 0.38, -24.8],
      [-38, 0.38, 1.5],
      [38, 0.38, -1.5],
      [0, 0.38, 11],
      [0, 0.38, -11],
    ];
    conePositions.forEach(([x, y, z], index) => {
      const cone = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.72, 14), this.materials.cone);
      body.position.y = 0.36;
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.05, 14), this.materials.coneStripe);
      stripe.position.y = 0.4;
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.05, 0.66), this.materials.darkMetal);
      base.position.y = 0.025;
      cone.add(body, stripe, base);
      cone.position.set(x, y - 0.38, z);
      cone.rotation.y = index * 0.7;
      cone.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      this.scene.add(cone);
    });
  }

  private createCableRuns(): void {
    const cableMaterial = this.materials.rubber;
    const runs: Array<Array<[number, number, number]>> = [
      [
        [-41, 6.9, -30],
        [-21, 6.2, -28],
        [-3, 6.6, -31],
        [20, 6.1, -28],
        [41, 6.9, -30],
      ],
      [
        [-42, 5.8, 30],
        [-18, 5.2, 27],
        [4, 5.6, 30],
        [19, 5.1, 27],
        [42, 5.8, 30],
      ],
    ];
    runs.forEach((points) => {
      const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
      const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.055, 8), cableMaterial);
      cable.castShadow = true;
      this.scene.add(cable);
    });
  }

  private createPalletStacks(): void {
    const stacks: Array<[number, number, number, number]> = [
      [-27, -27, 0.1, 2],
      [27, 27, -0.22, 2],
      [-15, 11, 0.44, 3],
      [16, -11, -0.3, 3],
    ];
    stacks.forEach(([x, z, rotation, layers]) => {
      const stack = new THREE.Group();
      for (let layer = 0; layer < layers; layer += 1) {
        for (let plank = -1; plank <= 1; plank += 1) {
          const board = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.28), this.materials.wood);
          board.position.set(0, layer * 0.16 + 0.04, plank * 0.42);
          board.castShadow = true;
          board.receiveShadow = true;
          stack.add(board);
        }
        for (let brace = -1; brace <= 1; brace += 2) {
          const board = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 1.24), this.materials.wood);
          board.position.set(brace * 0.64, layer * 0.16 + 0.11, 0);
          board.castShadow = true;
          board.receiveShadow = true;
          stack.add(board);
        }
      }
      stack.position.set(x, 0.04, z);
      stack.rotation.y = rotation;
      this.scene.add(stack);
    });
  }

  private createYardSigns(): void {
    const signs: Array<[string, number, number, number, number]> = [
      ['ALPHA SPAWN', -40.5, 2.8, -18, Math.PI / 2],
      ['BRAVO SPAWN', 40.5, 2.8, 18, -Math.PI / 2],
      ['CARGO LANE', 0, 4.2, -33.8, 0],
      ['CONTROL YARD', 0, 4.2, 33.8, Math.PI],
    ];
    signs.forEach(([label, x, y, z, rotation]) => {
      const material = new THREE.MeshBasicMaterial({ map: this.createSignTexture(label), transparent: true, toneMapped: false });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.95), material);
      sign.position.set(x, y, z);
      sign.rotation.y = rotation;
      this.scene.add(sign);
    });
  }

  private createWeather(): void {
    const count = this.environment.quality === 'ultra' ? 1300 : this.environment.quality === 'high' ? 760 : 300;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = arenaBounds.x1 + Math.random() * (arenaBounds.x2 - arenaBounds.x1);
      positions[i * 3 + 1] = 2 + Math.random() * 26;
      positions[i * 3 + 2] = arenaBounds.z1 + Math.random() * (arenaBounds.z2 - arenaBounds.z1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: '#d9f0ff',
      size: 0.052,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.rainPositions = positions;
    this.rain = new THREE.Points(geometry, material);
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }

  private createSpawnPads(): void {
    this.spawnPoints.forEach(([x, , z]) => {
      const pad = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.7, 32), this.materials.spawn);
      pad.position.set(x, 0.04, z);
      pad.rotation.x = -Math.PI / 2;
      this.scene.add(pad);
    });
  }

  private addFenceRail(x: number, y: number, z: number, length: number, rotationY: number): void {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.06, 0.08), this.materials.metal);
    rail.position.set(x, y, z);
    rail.rotation.y = rotationY;
    this.scene.add(rail);
  }

  private createAsphaltTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not create asphalt texture.');
    }
    ctx.fillStyle = '#252a2c';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2200; i += 1) {
      const shade = Math.floor(42 + Math.random() * 48);
      ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade}, 0.28)`;
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 1.5, 1.5);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(10, 8);
    return texture;
  }

  private createContainerTexture(base: string, shadow: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not create container texture.');
    }
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = shadow;
    for (let x = 18; x < 512; x += 34) {
      ctx.fillRect(x, 0, 7, 256);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x + 7, 0, 3, 256);
      ctx.fillStyle = shadow;
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.32)';
    ctx.lineWidth = 10;
    ctx.strokeRect(8, 8, 496, 240);
    ctx.lineWidth = 3;
    for (let y = 52; y < 240; y += 58) {
      ctx.beginPath();
      ctx.moveTo(10, y);
      ctx.lineTo(502, y);
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private createSignTexture(label: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not create sign texture.');
    }
    ctx.fillStyle = '#181b1d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f2c14e';
    ctx.fillRect(0, 0, canvas.width, 16);
    ctx.fillRect(0, canvas.height - 16, canvas.width, 16);
    ctx.strokeStyle = 'rgba(244,241,232,0.72)';
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
    ctx.fillStyle = '#f4f1e8';
    ctx.font = '900 42px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 3);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
}
