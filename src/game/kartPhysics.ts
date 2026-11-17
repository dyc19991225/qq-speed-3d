import * as THREE from 'three';
import { queryTrackSurface } from './trackPhysics';
import type { KartSpec, TrackData } from './types';

export interface PlayerInput {
  throttle: boolean;
  brake: boolean;
  steer: number; // -1 (left) .. +1 (right)
  driftHeld: boolean;
  driftJustPressed: boolean;
  miniBoostJustPressed: boolean;
  nitroJustPressed: boolean;
  resetJustPressed: boolean;
}

export interface ComboCallout {
  text: string;
  tier: 'normal' | 'nitro' | 'cww' | 'super';
  expiresAt: number;
}

export class KartController {
  public spec: KartSpec;
  public x = 0;
  public y = 0;
  public z = 0;
  public vy = 0;
  public headingYaw = 0; // visual car nose yaw (0 = facing -Z)
  public velYaw = 0; // velocity vector yaw
  public speedKmh = 0;
  public isGrounded = true;

  // Drift & Boost Combo State Machine
  public isDrifting = false;
  public driftDir = 0; // -1 left, +1 right
  public driftDuration = 0;
  public driftAngle = 0; // headingYaw - velYaw
  public nitroCharge = 0; // 0..100
  public nitroBottles = 0; // 0..2

  public miniBoostsLeft = 0; // 0, 1, 2
  public miniWindowTimer = 0;
  public miniDelayTimer = 0; // enforces authentic double-boost spacing
  public miniBoostHint = '';

  public activeMiniTimer = 0;
  public activeNitroTimer = 0;
  public comboStage: 'none' | 'w1' | 'c_only' | 'c_w1' | 'cww' | 'wcw' = 'none';
  public maxBoostCapKmh = 0;

  // Lap & Race Progress
  public lap = 1;
  public maxDistThisLap = 0;
  public progressDist = 0;
  public currentSectionLabel = '';
  public lastMainDist = 0;
  public finished = false;
  public finishTime = 0;

  // Wall & Air states
  private wallCooldown = 0;
  private wasGrounded = true;
  private cutDriftCooldown = 0;

  public onComboCallout: ((c: ComboCallout) => void) | null = null;
  public onPlayMiniBoost: (() => void) | null = null;
  public onPlayNitro: ((isCombo: boolean) => void) | null = null;
  public onPlayNitroReady: (() => void) | null = null;
  public onPlayWallHit: (() => void) | null = null;

  constructor(spec: KartSpec) {
    this.spec = spec;
  }

  public resetToStart(track: TrackData, lateral = 0): void {
    const s = track.mainSamples[0];
    this.x = s.pos.x + s.right.x * lateral;
    this.y = s.pos.y;
    this.z = s.pos.z + s.right.z * lateral;
    this.vy = 0;
    this.headingYaw = Math.atan2(-s.tangent.x, -s.tangent.z);
    this.velYaw = this.headingYaw;
    this.speedKmh = 0;
    this.isGrounded = true;
    this.wasGrounded = true;
    this.isDrifting = false;
    this.driftDuration = 0;
    this.driftAngle = 0;
    this.nitroCharge = 0;
    this.nitroBottles = 0;
    this.miniBoostsLeft = 0;
    this.miniWindowTimer = 0;
    this.miniDelayTimer = 0;
    this.activeMiniTimer = 0;
    this.activeNitroTimer = 0;
    this.comboStage = 'none';
    this.lap = 1;
    this.maxDistThisLap = 0;
    this.progressDist = 0;
    this.lastMainDist = 0;
    this.finished = false;
    this.finishTime = 0;
    this.currentSectionLabel = s.label ?? track.name;
  }

  private emitCallout(text: string, tier: ComboCallout['tier']): void {
    this.onComboCallout?.({
      text,
      tier,
      expiresAt: performance.now() + 1850
    });
  }

  public triggerSuperStart(): void {
    this.speedKmh = Math.max(this.speedKmh, 158);
    this.activeMiniTimer = 0.9;
    this.maxBoostCapKmh = this.spec.miniBoostSpeed + 6;
    this.emitCallout('超级起步！SUPER START', 'super');
    this.onPlayMiniBoost?.();
  }

  public update(dt: number, input: PlayerInput, track: TrackData, raceStarted: boolean): void {
    if (input.resetJustPressed && raceStarted) {
      const q = queryTrackSurface(track, this.x, this.y, this.z);
      this.x = q.sample.pos.x;
      this.y = q.sample.pos.y + 0.3;
      this.z = q.sample.pos.z;
      this.vy = 0;
      this.headingYaw = Math.atan2(-q.sample.tangent.x, -q.sample.tangent.z);
      this.velYaw = this.headingYaw;
      this.speedKmh *= 0.45;
      this.isDrifting = false;
    }

    if (this.wallCooldown > 0) this.wallCooldown -= dt;
    if (this.cutDriftCooldown > 0) this.cutDriftCooldown -= dt;
    if (this.miniWindowTimer > 0) {
      this.miniWindowTimer -= dt;
      if (this.miniWindowTimer <= 0) {
        this.miniBoostsLeft = 0;
        this.miniBoostHint = '';
      }
    }
    if (this.miniDelayTimer > 0) this.miniDelayTimer = Math.max(0, this.miniDelayTimer - dt);

    if (this.activeMiniTimer > 0) {
      this.activeMiniTimer = Math.max(0, this.activeMiniTimer - dt);
    }
    if (this.activeNitroTimer > 0) {
      this.activeNitroTimer = Math.max(0, this.activeNitroTimer - dt);
    }
    if (this.activeMiniTimer <= 0 && this.activeNitroTimer <= 0) {
      this.comboStage = 'none';
      this.maxBoostCapKmh = 0;
    }

    if (!raceStarted) {
      this.driftAngle = 0;
      return;
    }

    // =====================================================
    // 1. N2O & MINI-BOOST COMBO EXECUTION (CWW / WCW / 双喷)
    // =====================================================
    if (input.nitroJustPressed && this.nitroBottles > 0 && this.activeNitroTimer <= 0.4) {
      this.nitroBottles--;
      this.activeNitroTimer = 3.1;
      if (this.comboStage === 'w1' || this.activeMiniTimer > 0) {
        this.comboStage = 'wcw';
        this.maxBoostCapKmh = this.spec.cwwMaxSpeed - 10;
        this.activeNitroTimer += 0.45;
        this.emitCallout('WCW 喷！长效突破', 'cww');
        this.onPlayNitro?.(true);
      } else {
        this.comboStage = 'c_only';
        this.maxBoostCapKmh = this.spec.nitroSpeed;
        this.emitCallout('氮气加速 N2O', 'nitro');
        this.onPlayNitro?.(false);
      }
      this.speedKmh = Math.max(this.speedKmh + 18, this.spec.nitroSpeed * 0.9);
    }

    if (
      input.miniBoostJustPressed &&
      this.miniBoostsLeft > 0 &&
      this.miniDelayTimer <= 0
    ) {
      this.miniBoostsLeft--;
      this.activeMiniTimer = 0.85;
      this.onPlayMiniBoost?.();

      if (this.miniBoostsLeft === 1) {
        // First mini-boost fired; open brief spacing before second mini-boost!
        this.miniDelayTimer = 0.22;
        this.miniWindowTimer = 1.45;
        if (this.activeNitroTimer > 0) {
          this.comboStage = 'c_w1';
          this.maxBoostCapKmh = this.spec.nitroSpeed + 18;
          this.emitCallout('CW 喷！蓄力二段', 'nitro');
        } else {
          this.comboStage = 'w1';
          this.maxBoostCapKmh = this.spec.miniBoostSpeed;
          this.emitCallout(this.miniBoostHint || '小喷！', 'normal');
        }
        this.speedKmh = Math.max(this.speedKmh + 15, this.spec.miniBoostSpeed * 0.9);
      } else {
        // Second mini-boost fired! Check for CWW / WCW / Double Spray!
        this.miniWindowTimer = 0;
        if (this.activeNitroTimer > 0) {
          if (this.comboStage === 'c_w1' || this.comboStage === 'c_only') {
            this.comboStage = 'cww';
            this.maxBoostCapKmh = this.spec.cwwMaxSpeed;
            this.emitCallout(`CWW 喷！极限 ${this.spec.cwwMaxSpeed} km/h`, 'cww');
          } else {
            this.comboStage = 'wcw';
            this.maxBoostCapKmh = this.spec.cwwMaxSpeed - 8;
            this.emitCallout(`WCW 喷！${this.maxBoostCapKmh} km/h`, 'cww');
          }
          this.speedKmh = Math.max(this.speedKmh + 22, this.maxBoostCapKmh * 0.95);
        } else {
          this.maxBoostCapKmh = this.spec.miniBoostSpeed + 6;
          this.emitCallout('双喷！DOUBLE JET', 'normal');
          this.speedKmh = Math.max(this.speedKmh + 16, this.spec.miniBoostSpeed);
        }
      }
    }

    // =====================================================
    // 2. STEERING & DRIFTING PHYSICS (漂移 / 断位 / 侧身)
    // =====================================================
    const canDrift = this.speedKmh > 65 && this.isGrounded;
    // Note: in Three.js yaw, +yaw turns LEFT (-X from -Z), -yaw turns RIGHT (+X from -Z)
    // input.steer: -1 = Left, +1 = Right -> turnRate = -input.steer
    if (!this.isDrifting) {
      if (input.driftHeld && Math.abs(input.steer) > 0.1 && canDrift) {
        this.isDrifting = true;
        this.driftDir = Math.sign(input.steer);
        this.driftDuration = 0;
      }
    } else {
      this.driftDuration += dt;
      // Cut-Drift (段位拉车头): tapping Drift while steering opposite of driftDir!
      if (
        input.driftJustPressed &&
        this.driftDuration > 0.22 &&
        Math.sign(input.steer) === -this.driftDir &&
        this.cutDriftCooldown <= 0
      ) {
        this.cutDriftCooldown = 0.5;
        this.isDrifting = false;
        // Snap velocity angle smoothly toward nose & award extra N2O + instant double spray!
        this.velYaw = THREE.MathUtils.lerp(this.velYaw, this.headingYaw, 0.75);
        this.addNitroCharge(24 * this.spec.chargeRate);
        this.grantMiniBoosts(2, '段位双喷！');
      } else if (!input.driftHeld || this.speedKmh < 45) {
        this.isDrifting = false;
        if (this.driftDuration >= 0.22) {
          this.grantMiniBoosts(2, '双喷准备');
        }
      }
    }

    if (this.isDrifting) {
      // Yaw turns sharply in driftDir; counter-steering tightens/widens slip (侧身/控弯!)
      const steerMod =
        Math.sign(input.steer) === this.driftDir
          ? 1.18
          : Math.sign(input.steer) === -this.driftDir
            ? 0.42
            : 0.78;
      const yawSpeed = 2.05 * this.spec.driftGrip * steerMod;
      this.headingYaw += -this.driftDir * yawSpeed * dt;

      // Velocity trails behind headingYaw by drift slip angle
      const targetVelYaw = this.headingYaw + this.driftDir * 0.46;
      let diff = normalizeAngle(targetVelYaw - this.velYaw);
      this.velYaw += diff * Math.min(1, dt * 5.2);

      // Charge N2O proportional to speed & slip angle
      const slipMag = Math.abs(normalizeAngle(this.headingYaw - this.velYaw));
      this.addNitroCharge((34 + slipMag * 55) * (this.speedKmh / 200) * this.spec.chargeRate * dt);
    } else {
      // Normal grip steering
      const gripTurn = (1.68 - Math.min(0.45, this.speedKmh / 520)) * (this.speedKmh > 12 ? 1 : 0.4);
      const revSign = this.speedKmh < -1 ? -1 : 1;
      this.headingYaw += -input.steer * gripTurn * revSign * dt;

      const diff = normalizeAngle(this.headingYaw - this.velYaw);
      this.velYaw += diff * Math.min(1, dt * 11.5);
    }

    this.driftAngle = normalizeAngle(this.headingYaw - this.velYaw);

    // =====================================================
    // 3. LONGITUDINAL SPEED & ACCELERATION CURVE
    // =====================================================
    const currentTopCap = Math.max(this.spec.baseMaxSpeed, this.maxBoostCapKmh);
    const boostPush = this.activeNitroTimer > 0 ? 115 : this.activeMiniTimer > 0 ? 92 : 0;

    if (input.throttle) {
      const baseAccel = (118 - Math.max(0, this.speedKmh - 100) * 0.42) * this.spec.accel;
      const effectiveAccel = Math.max(28, baseAccel) + boostPush;
      if (this.speedKmh < currentTopCap) {
        this.speedKmh = Math.min(currentTopCap, this.speedKmh + effectiveAccel * dt);
      } else {
        // Gentle bleed down if boost just ended
        this.speedKmh = Math.max(currentTopCap, this.speedKmh - 55 * dt);
      }
      if (this.isDrifting) {
        this.speedKmh = Math.max(105, this.speedKmh - 14 * dt);
      }
    } else if (input.brake) {
      this.speedKmh = Math.max(-55, this.speedKmh - 175 * dt);
    } else {
      // Natural coasting drag
      this.speedKmh *= Math.max(0, 1 - 0.55 * dt);
      if (Math.abs(this.speedKmh) < 0.8) this.speedKmh = 0;
    }

    // =====================================================
    // 4. 3D MOVEMENT, TRACK SURFACE, JUMPS & WALL SLIDE
    // =====================================================
    const speedMs = this.speedKmh / 3.6;
    const vx = -Math.sin(this.velYaw) * speedMs;
    const vz = -Math.cos(this.velYaw) * speedMs;

    this.x += vx * dt;
    this.z += vz * dt;

    // Gravity
    this.vy -= 26.0 * dt;
    this.y += this.vy * dt;

    const q = queryTrackSurface(track, this.x, this.y, this.z, 1.05);
    if (q.sample.label) {
      this.currentSectionLabel = q.sample.label;
    } else if (!q.onMain) {
      this.currentSectionLabel = '捷径近道';
    }

    // Wall collision & crash recovery mini-boost ("撞后点喷")
    if (q.wallHit) {
      this.x = q.clampedX;
      this.z = q.clampedZ;
      const dotWall = vx * q.wallNormalX + vz * q.wallNormalZ;
      if (dotWall < -1.5) {
        // Redirect heading smoothly along road tangent to prevent pinning!
        const roadYaw = Math.atan2(-q.sample.tangent.x, -q.sample.tangent.z);
        this.headingYaw = lerpAngle(this.headingYaw, roadYaw, 0.42);
        this.velYaw = lerpAngle(this.velYaw, roadYaw, 0.55);
        this.speedKmh = Math.max(75, this.speedKmh * 0.72);
        if (this.wallCooldown <= 0) {
          this.wallCooldown = 0.45;
          this.onPlayWallHit?.();
          this.grantMiniBoosts(1, '撞后点喷！');
        }
      }
    }

    // Ground & Jump Ramp Check (空喷 / 落地喷!)
    if (q.sample.jumpLip && this.isGrounded && this.speedKmh > 110) {
      this.vy = 8.2;
      this.isGrounded = false;
      this.grantMiniBoosts(1, '空喷！AIR JET');
    } else if (this.y <= q.roadY + 0.08) {
      if (!this.wasGrounded && this.vy < -4.0) {
        // Touched down from jump!
        this.grantMiniBoosts(1, '落地喷！LANDING JET');
      }
      this.y = q.roadY;
      this.vy = 0;
      this.isGrounded = true;
    } else if (this.y > q.roadY + 0.45) {
      this.isGrounded = false;
      if (this.wasGrounded && this.miniBoostsLeft === 0) {
        this.grantMiniBoosts(1, '空喷！AIR JET');
      }
    }
    this.wasGrounded = this.isGrounded;

    // =====================================================
    // 5. LAP & RACE PROGRESS TRACKING
    // =====================================================
    const prevD = this.lastMainDist;
    const currD = q.mainDistAlong;
    const closed = track.laps > 1;

    if (closed) {
      // Crossed finish line forward (end of lap -> start of lap)
      if (prevD > track.totalLength * 0.78 && currD < track.totalLength * 0.22) {
        if (this.maxDistThisLap > track.totalLength * 0.65) {
          if (this.lap >= track.laps) {
            this.finished = true;
          } else {
            this.lap++;
            this.maxDistThisLap = currD;
            this.emitCallout(`第 ${this.lap} 圈 · FINAL LAP!`, 'super');
          }
        }
      }
      if (currD > this.maxDistThisLap) this.maxDistThisLap = currD;
      this.progressDist = (this.lap - 1) * track.totalLength + this.maxDistThisLap;
    } else {
      // Point-to-point (Akina Mountain)
      if (currD > this.maxDistThisLap) this.maxDistThisLap = currD;
      this.progressDist = this.maxDistThisLap;
      if (this.maxDistThisLap >= track.totalLength - 18) {
        this.finished = true;
      }
    }
    this.lastMainDist = currD;
  }

  private addNitroCharge(amount: number): void {
    if (this.nitroBottles >= 2) {
      this.nitroCharge = 100;
      return;
    }
    this.nitroCharge += amount;
    if (this.nitroCharge >= 100) {
      this.nitroCharge -= 100;
      this.nitroBottles = Math.min(2, this.nitroBottles + 1);
      this.onPlayNitroReady?.();
      if (this.nitroBottles >= 2) this.nitroCharge = 100;
    }
  }

  private grantMiniBoosts(count: number, hint: string): void {
    this.miniBoostsLeft = Math.max(this.miniBoostsLeft, count);
    this.miniWindowTimer = 1.65;
    this.miniDelayTimer = 0;
    this.miniBoostHint = hint;
  }
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + normalizeAngle(b - a) * t;
}
