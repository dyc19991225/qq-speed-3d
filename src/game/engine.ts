import * as THREE from 'three';
import { AiRacer } from './aiRacers';
import { RacingHud, type HudSelection, type KeyVisualState } from './hud';
import { KartController, type PlayerInput } from './kartPhysics';
import { buildKartMesh, KART_SPECS, type BuiltKartVisual } from './karts';
import { RacingAudio } from './soundEngine';
import { buildTrackScene } from './trackBuilder';
import { TRACKS } from './tracks';
import type { KartId, RacerTelemetry, TrackData, TrackId } from './types';

interface SkidMark {
  mesh: THREE.Mesh;
  life: number;
}

interface SparkParticle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

function sampleShakeNoise(time: number): number {
  const index = Math.floor(time);
  const start = Math.sin(index * 127.1) * 43758.5453;
  const end = Math.sin((index + 1) * 127.1) * 43758.5453;
  const blend = THREE.MathUtils.smoothstep(time, index, index + 1);
  return 2 * THREE.MathUtils.lerp(start - Math.floor(start), end - Math.floor(end), blend) - 1;
}

export class QQSpeedEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private audio = new RacingAudio();
  private hud: RacingHud;

  private activeTrack: TrackData = TRACKS.city11;
  private activeKartId: KartId = 'renault';

  private playerCtrl: KartController;
  private playerVisual: BuiltKartVisual;
  private aiRacers: AiRacer[] = [];

  private skidMarks: SkidMark[] = [];
  private sparks: SparkParticle[] = [];
  private skidGeo = new THREE.PlaneGeometry(0.32, 0.95);
  private skidMat = new THREE.MeshBasicMaterial({
    color: 0x0c0d10,
    transparent: true,
    opacity: 0.62,
    depthWrite: false
  });
  private sparkGeo = new THREE.BoxGeometry(0.11, 0.11, 0.11);

  private keys = new Set<string>();
  private driftJustPressed = false;
  private miniJustPressed = false;
  private nitroJustPressed = false;
  private resetJustPressed = false;

  private menuOpen = true;
  private countdownTimer = 0; // 3.4 -> 0
  private lastBeepInt = 4;
  private raceStarted = false;
  private superStartWindow = 0;
  private superStartClaimed = false;
  private raceClock = 0;
  private camDistanceMode: 'near' | 'far' = 'near';

  private camPos = new THREE.Vector3(0, 4, 10);
  private camLook = new THREE.Vector3(0, 1, 0);
  private trauma = 0;
  private skidCooldown = 0;
  private lastTime = performance.now();

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.2, 1600);

    this.playerCtrl = new KartController(KART_SPECS[this.activeKartId]);
    this.playerVisual = buildKartMesh(KART_SPECS[this.activeKartId]);

    this.hud = new RacingHud(container);
    this.hud.applyTouchFlag();

    this.wireCallbacks();
    this.bindKeyboard();
    this.loadRace(this.hud.getSelection(), true);

    window.addEventListener('resize', () => this.onResize());
    requestAnimationFrame((t) => this.loop(t));
  }

  private wireCallbacks(): void {
    this.playerCtrl.onComboCallout = (c) => this.hud.showComboCallout(c);
    this.playerCtrl.onPlayMiniBoost = () => this.audio.playMiniBoost();
    this.playerCtrl.onPlayNitro = (isCombo) => {
      this.addTrauma(isCombo ? 0.36 : 0.22);
      this.audio.playNitro(isCombo);
    };
    this.playerCtrl.onPlayNitroReady = () => this.audio.playNitroReady();
    this.playerCtrl.onPlayWallHit = () => {
      this.addTrauma(0.55);
      this.audio.playWallHit();
    };

    this.hud.onStartRace = (sel) => {
      this.audio.unlock();
      this.loadRace(sel, false);
    };
    this.hud.onRestartRace = () => {
      this.audio.unlock();
      this.loadRace(this.hud.getSelection(), false);
    };
    this.hud.onOpenMenu = () => {
      this.menuOpen = true;
      this.keys.clear();
    };
    this.hud.onToggleTouch = () => {
      this.hud.applyTouchFlag();
    };
    this.hud.onVolumeChanged = (v) => {
      this.audio.setVolume(v);
    };
    this.hud.onCameraToggle = () => {
      this.camDistanceMode = this.camDistanceMode === 'near' ? 'far' : 'near';
    };
    this.hud.onResetKart = () => {
      this.resetJustPressed = true;
    };
  }

  private addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  private loadRace(sel: HudSelection, stayInLobby: boolean): void {
    this.activeTrack = TRACKS[sel.trackId as TrackId];
    this.activeKartId = sel.kartId;
    this.audio.setVolume(sel.volume);

    buildTrackScene(this.scene, this.activeTrack);
    this.hud.computeMinimapBounds(this.activeTrack);

    // Clear FX
    this.skidMarks = [];
    this.sparks = [];
    this.trauma = 0;

    // Rebuild player kart mesh
    this.playerCtrl.spec = KART_SPECS[sel.kartId];
    this.playerVisual = buildKartMesh(this.playerCtrl.spec);
    this.playerCtrl.resetToStart(this.activeTrack, -3.2);
    this.scene.add(this.playerVisual.root);

    // Build 3 AI Rivals
    const rivalDefs: Array<[string, KartId, number, number]> = [
      ['小橘子', 'razor', 194, 3.2],
      ['白勇太', 'renault', 188, -1.0],
      ['镜·车神', 'rookie', 182, 1.2]
    ];
    this.aiRacers = rivalDefs.map(([name, kid, pace, lane], i) => {
      const ai = new AiRacer(`ai_${i}`, name, kid, pace, lane);
      ai.reset(this.activeTrack, 2.5 + i * 2.2, lane);
      this.scene.add(ai.visual.root);
      return ai;
    });

    // Place camera smoothly behind car right away
    const s0 = this.activeTrack.mainSamples[0];
    this.camPos.set(
      this.playerCtrl.x - s0.tangent.x * 7.5,
      this.playerCtrl.y + 3.2,
      this.playerCtrl.z - s0.tangent.z * 7.5
    );
    this.camLook.set(this.playerCtrl.x, this.playerCtrl.y + 1.1, this.playerCtrl.z);

    this.menuOpen = stayInLobby;
    this.raceStarted = false;
    this.countdownTimer = stayInLobby ? 0 : 3.2;
    this.lastBeepInt = 4;
    this.superStartWindow = 0;
    this.superStartClaimed = false;
    this.raceClock = 0;

    if (stayInLobby) {
      this.hud.showCountdown(null);
    }
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (this.menuOpen) return;

      if (
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)
      ) {
        e.preventDefault();
      }

      const firstDown = !this.keys.has(e.code);
      this.keys.add(e.code);

      if (firstDown) {
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
          this.driftJustPressed = true;
        }
        if (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'Space') {
          this.miniJustPressed = true;
        }
        if (e.code === 'AltLeft' || e.code === 'AltRight' || e.code === 'KeyC' || e.code === 'KeyE') {
          e.preventDefault();
          this.nitroJustPressed = true;
        }
        if (e.code === 'KeyR') {
          this.resetJustPressed = true;
        }
        if (e.code === 'KeyV') {
          this.camDistanceMode = this.camDistanceMode === 'near' ? 'far' : 'near';
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
  }

  private gatherInput(): { input: PlayerInput; keyVis: KeyVisualState } {
    const upKey = this.keys.has('ArrowUp') || this.keys.has('KeyW');
    const downKey = this.keys.has('ArrowDown') || this.keys.has('KeyS');
    const leftKey = this.keys.has('ArrowLeft') || this.keys.has('KeyA');
    const rightKey = this.keys.has('ArrowRight') || this.keys.has('KeyD');
    const driftKey = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const miniKey =
      this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('Space');
    const nitroKey =
      this.keys.has('AltLeft') ||
      this.keys.has('AltRight') ||
      this.keys.has('KeyC') ||
      this.keys.has('KeyE');

    const touchAutoGas = this.hud.touchEnabled && this.hud.getSelection().autoThrottleOnTouch;
    const throttle = upKey || (touchAutoGas && !this.hud.touchBrake);
    const brake = downKey || (this.hud.touchEnabled && this.hud.touchBrake);
    const left = leftKey || (this.hud.touchEnabled && this.hud.touchLeft);
    const right = rightKey || (this.hud.touchEnabled && this.hud.touchRight);
    const driftHeld = driftKey || (this.hud.touchEnabled && this.hud.touchDrift);

    const steer = (right ? 1 : 0) - (left ? 1 : 0);

    const input: PlayerInput = {
      throttle,
      brake,
      steer,
      driftHeld,
      driftJustPressed: this.driftJustPressed || this.hud.touchDriftJustPressed,
      miniBoostJustPressed: this.miniJustPressed || this.hud.touchMiniJustPressed,
      nitroJustPressed: this.nitroJustPressed || this.hud.touchNitroJustPressed,
      resetJustPressed: this.resetJustPressed
    };

    this.driftJustPressed = false;
    this.miniJustPressed = false;
    this.nitroJustPressed = false;
    this.resetJustPressed = false;
    this.hud.touchDriftJustPressed = false;
    this.hud.touchMiniJustPressed = false;
    this.hud.touchNitroJustPressed = false;

    return {
      input,
      keyVis: {
        up: throttle,
        down: brake,
        left,
        right,
        drift: driftHeld,
        mini: miniKey || input.miniBoostJustPressed,
        nitro: nitroKey || input.nitroJustPressed
      }
    };
  }

  private emitDriftEffects(dt: number): void {
    this.skidCooldown -= dt;
    if (this.playerCtrl.isDrifting && this.playerCtrl.isGrounded && this.playerCtrl.speedKmh > 65) {
      if (this.skidCooldown <= 0) {
        this.skidCooldown = 0.032;
        const yaw = this.playerCtrl.headingYaw;
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        for (const rx of [-0.82, 0.82]) {
          const sx = this.playerCtrl.x + rx * cos + 1.0 * sin;
          const sz = this.playerCtrl.z - rx * sin + 1.0 * cos;
          const mesh = new THREE.Mesh(this.skidGeo, this.skidMat);
          mesh.position.set(sx, this.playerCtrl.y + 0.04, sz);
          mesh.rotation.order = 'YXZ';
          mesh.rotation.y = this.playerCtrl.velYaw;
          mesh.rotation.x = -Math.PI / 2;
          this.scene.add(mesh);
          this.skidMarks.push({ mesh, life: 3.4 });

          // Sparks
          const spMat = new THREE.MeshBasicMaterial({
            color: this.playerCtrl.nitroBottles >= 1 ? 0x45d9ff : 0xffaa2b,
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false
          });
          const sp = new THREE.Mesh(this.sparkGeo, spMat);
          sp.position.set(sx, this.playerCtrl.y + 0.14, sz);
          this.scene.add(sp);
          this.sparks.push({
            mesh: sp,
            vx: (Math.random() - 0.5) * 6,
            vy: 2 + Math.random() * 4,
            vz: (Math.random() - 0.5) * 6,
            life: 0.25 + Math.random() * 0.15
          });
        }
      }
    }

    for (let i = this.skidMarks.length - 1; i >= 0; i--) {
      const s = this.skidMarks[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        this.skidMarks.splice(i, 1);
      }
    }
    if (this.skidMarks.length > 260) {
      const old = this.skidMarks.shift()!;
      this.scene.remove(old.mesh);
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i];
      p.life -= dt;
      p.vy -= 16 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.sparks.splice(i, 1);
      }
    }
  }

  private loop(now: number): void {
    const rawDt = Math.max(0, (now - this.lastTime) / 1000);
    const dt = Math.min(rawDt, 0.05);
    this.lastTime = now;
    this.trauma = Math.max(0, this.trauma - 1.55 * dt);

    const { input, keyVis } = this.gatherInput();

    if (!this.menuOpen) {
      // Countdown state
      if (!this.raceStarted) {
        this.countdownTimer -= dt;
        const ceilSec = Math.ceil(this.countdownTimer);
        if (ceilSec >= 1 && ceilSec <= 3) {
          this.hud.showCountdown(String(ceilSec));
          if (ceilSec < this.lastBeepInt) {
            this.lastBeepInt = ceilSec;
            this.audio.playCountdown(false);
          }
        } else if (this.countdownTimer <= 0) {
          this.raceStarted = true;
          this.superStartWindow = 0.42;
          this.audio.playCountdown(true);
          this.hud.showCountdown('GO!');
          setTimeout(() => {
            if (!this.menuOpen) this.hud.showCountdown(null);
          }, 750);
        }
      } else {
        this.raceClock += dt;
        if (this.superStartWindow > 0) {
          this.superStartWindow -= dt;
          if (!this.superStartClaimed && input.throttle) {
            this.superStartClaimed = true;
            this.playerCtrl.triggerSuperStart();
          }
        }
      }

      const wasFinished = this.playerCtrl.finished;
      this.playerCtrl.update(dt, input, this.activeTrack, this.raceStarted);
      if (!wasFinished && this.playerCtrl.finished) {
        this.playerCtrl.finishTime = this.raceClock;
        this.audio.playFinish();
      }

      for (const ai of this.aiRacers) {
        ai.update(dt, this.activeTrack, this.raceStarted, this.raceClock, this.playerCtrl.progressDist);
      }

      this.emitDriftEffects(dt);
    }

    // Sync player 3D kart visuals
    const boostTier: 0 | 1 | 2 | 3 =
      this.playerCtrl.comboStage === 'cww' || this.playerCtrl.comboStage === 'wcw'
        ? 3
        : this.playerCtrl.activeNitroTimer > 0
          ? 2
          : this.playerCtrl.activeMiniTimer > 0
            ? 1
            : 0;

    this.playerVisual.root.position.set(this.playerCtrl.x, this.playerCtrl.y, this.playerCtrl.z);
    this.playerVisual.root.rotation.y = this.playerCtrl.headingYaw;
    this.playerVisual.updateVisuals(
      dt,
      this.playerCtrl.speedKmh,
      input.steer,
      this.playerCtrl.driftAngle,
      boostTier,
      input.brake
    );

    this.audio.updateContinuous(
      !this.menuOpen && this.raceStarted && !this.playerCtrl.finished,
      this.playerCtrl.speedKmh,
      this.playerCtrl.isDrifting,
      this.playerCtrl.isGrounded,
      boostTier
    );

    // Smooth Chase Camera with Dynamic Boost FOV
    const camDist = this.camDistanceMode === 'far' ? 8.2 : 6.1;
    const camHeight = this.camDistanceMode === 'far' ? 3.2 : 2.35;
    const camYaw = this.playerCtrl.velYaw * 0.72 + this.playerCtrl.headingYaw * 0.28;
    const desiredCamPos = new THREE.Vector3(
      this.playerCtrl.x + Math.sin(camYaw) * camDist,
      this.playerCtrl.y + camHeight,
      this.playerCtrl.z + Math.cos(camYaw) * camDist
    );
    this.camPos.lerp(desiredCamPos, 1 - Math.exp(-11 * dt));
    const desiredLook = new THREE.Vector3(
      this.playerCtrl.x - Math.sin(this.playerCtrl.headingYaw) * 6.0,
      this.playerCtrl.y + 1.15,
      this.playerCtrl.z - Math.cos(this.playerCtrl.headingYaw) * 6.0
    );
    this.camLook.lerp(desiredLook, 1 - Math.exp(-14 * dt));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    const shake = this.trauma * this.trauma;
    if (shake > 0) {
      const shakeTime = (now / 1000) * 26;
      this.camera.rotateX(shake * 0.075 * sampleShakeNoise(shakeTime));
      this.camera.rotateY(shake * 0.06 * sampleShakeNoise(shakeTime + 17.3));
      this.camera.rotateZ(shake * 0.11 * sampleShakeNoise(shakeTime + 41.7));
    }

    const targetFov = 70 + Math.min(24, Math.max(0, (this.playerCtrl.speedKmh - 140) * 0.14));
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-8 * dt));
      this.camera.updateProjectionMatrix();
    }

    // Telemetry & Rankings
    const racers: RacerTelemetry[] = [
      {
        id: 'player',
        name: '极速车手',
        isPlayer: true,
        kartId: this.activeKartId,
        x: this.playerCtrl.x,
        y: this.playerCtrl.y,
        z: this.playerCtrl.z,
        yaw: this.playerCtrl.headingYaw,
        speedKmh: this.playerCtrl.speedKmh,
        lap: this.playerCtrl.lap,
        progressDist: this.playerCtrl.progressDist,
        rank: 1,
        finished: this.playerCtrl.finished,
        finishTime: this.playerCtrl.finishTime
      },
      ...this.aiRacers.map((ai) => ({
        id: ai.id,
        name: ai.name,
        isPlayer: false,
        kartId: ai.kartId,
        x: ai.x,
        y: ai.y,
        z: ai.z,
        yaw: ai.yaw,
        speedKmh: ai.speedKmh,
        lap: ai.lap,
        progressDist: ai.progressDist,
        rank: 1,
        finished: ai.finished,
        finishTime: ai.finishTime
      }))
    ];

    const sorted = [...racers].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progressDist - a.progressDist;
    });
    sorted.forEach((r, idx) => {
      r.rank = idx + 1;
    });

    if (this.playerCtrl.finished && !this.menuOpen) {
      this.menuOpen = true;
      this.hud.showFinishScreen(racers);
    }

    this.hud.update(this.activeTrack, this.playerCtrl, racers, this.raceClock, keyVis);

    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame((t) => this.loop(t));
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
