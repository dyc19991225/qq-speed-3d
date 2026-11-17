import * as THREE from 'three';
import { buildKartMesh, KART_SPECS, type BuiltKartVisual } from './karts';
import { queryTrackSurface } from './trackPhysics';
import type { KartId, SampledPoint, TrackData } from './types';

export class AiRacer {
  public readonly id: string;
  public readonly name: string;
  public readonly kartId: KartId;
  public readonly visual: BuiltKartVisual;

  public x = 0;
  public y = 0;
  public z = 0;
  public yaw = 0;
  public speedKmh = 0;
  public lap = 1;
  public maxDistThisLap = 0;
  public progressDist = 0;
  public lastMainDist = 0;
  public finished = false;
  public finishTime = 0;

  private targetSampleIdx = 0;
  private preferredLaneOffset = 0;
  private basePace = 188;
  private boostTimer = 0;
  private chosenShortcutId: string | null = null;

  constructor(id: string, name: string, kartId: KartId, paceKmh: number, laneOffset: number) {
    this.id = id;
    this.name = name;
    this.kartId = kartId;
    this.basePace = paceKmh;
    this.preferredLaneOffset = laneOffset;
    this.visual = buildKartMesh(KART_SPECS[kartId]);
  }

  public reset(track: TrackData, startBackOffset: number, laneOffset: number): void {
    const s = track.mainSamples[0];
    this.x = s.pos.x + s.right.x * laneOffset - s.tangent.x * startBackOffset;
    this.y = s.pos.y;
    this.z = s.pos.z + s.right.z * laneOffset - s.tangent.z * startBackOffset;
    this.yaw = Math.atan2(-s.tangent.x, -s.tangent.z);
    this.speedKmh = 0;
    this.lap = 1;
    this.maxDistThisLap = 0;
    this.progressDist = 0;
    this.lastMainDist = 0;
    this.finished = false;
    this.finishTime = 0;
    this.targetSampleIdx = 2;
    this.boostTimer = 0;
    this.chosenShortcutId = null;
    this.syncMesh(0.016, 0, 0, 0);
  }

  public update(dt: number, track: TrackData, raceStarted: boolean, raceClock: number, playerProgress: number): void {
    if (!raceStarted) {
      this.syncMesh(dt, 0, 0, 0);
      return;
    }

    const closed = track.laps > 1;
    const samples = track.mainSamples;
    const n = samples.length;

    // Rubber-banding subtle pace adjustment so race stays exciting
    const gap = playerProgress - this.progressDist;
    const rubber = Math.max(-14, Math.min(24, gap * 0.14));
    const lookAheadIdx = (this.targetSampleIdx + 4) % n;
    const targetSample: SampledPoint =
      !closed && this.targetSampleIdx + 4 >= n ? samples[n - 1] : samples[lookAheadIdx];

    // Occasionally steer into a shortcut branch if near its fork!
    let aimPos = targetSample.pos.clone().addScaledVector(targetSample.right, this.preferredLaneOffset);
    for (const sc of track.shortcuts) {
      if (this.chosenShortcutId === sc.id) {
        // Find closest ahead point on shortcut
        let bestSc = sc.samples[sc.samples.length - 1];
        for (let k = 0; k < sc.samples.length; k++) {
          const d = Math.hypot(sc.samples[k].pos.x - this.x, sc.samples[k].pos.z - this.z);
          if (d > 8 && k > 1) {
            bestSc = sc.samples[k];
            break;
          }
        }
        aimPos = bestSc.pos.clone();
        if (Math.hypot(sc.samples[sc.samples.length - 1].pos.x - this.x, sc.samples[sc.samples.length - 1].pos.z - this.z) < 12) {
          this.chosenShortcutId = null;
        }
        break;
      } else if (Math.abs(samples[this.targetSampleIdx].distAlong - sc.joinStartDist) < 14 && Math.random() < 0.03) {
        this.chosenShortcutId = sc.id;
      }
    }

    const dx = aimPos.x - this.x;
    const dz = aimPos.z - this.z;
    const desiredYaw = Math.atan2(-dx, -dz);
    let dyaw = desiredYaw - this.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;

    const steerRatio = Math.max(-1, Math.min(1, dyaw * 2.4));
    this.yaw += dyaw * Math.min(1, dt * 6.2);

    // Visual drift around sharp corners & occasional nitro surge
    const isSharpCorner = Math.abs(dyaw) > 0.35;
    if (this.boostTimer > 0) this.boostTimer -= dt;
    else if (!isSharpCorner && Math.random() < 0.008 && this.speedKmh > 150) {
      this.boostTimer = 2.4;
    }

    const cornerSlow = isSharpCorner ? -28 : 0;
    const boostAdd = this.boostTimer > 0 ? 48 : 0;
    const targetSpeed = this.basePace + rubber + cornerSlow + boostAdd;
    this.speedKmh = THREE.MathUtils.lerp(this.speedKmh, targetSpeed, Math.min(1, dt * 2.2));

    const ms = this.speedKmh / 3.6;
    this.x += -Math.sin(this.yaw) * ms * dt;
    this.z += -Math.cos(this.yaw) * ms * dt;

    const q = queryTrackSurface(track, this.x, this.y, this.z, 1.0);
    this.y = THREE.MathUtils.lerp(this.y, q.roadY, Math.min(1, dt * 14));
    if (q.wallHit) {
      this.x = q.clampedX;
      this.z = q.clampedZ;
    }
    if (q.onMain) {
      this.targetSampleIdx = q.sampleIdx;
    }

    // Update lap / progress
    const prevD = this.lastMainDist;
    const currD = q.mainDistAlong;
    if (closed) {
      if (prevD > track.totalLength * 0.78 && currD < track.totalLength * 0.22) {
        if (this.maxDistThisLap > track.totalLength * 0.65) {
          if (this.lap >= track.laps && !this.finished) {
            this.finished = true;
            this.finishTime = raceClock;
          } else if (!this.finished) {
            this.lap++;
            this.maxDistThisLap = currD;
          }
        }
      }
      if (currD > this.maxDistThisLap) this.maxDistThisLap = currD;
      this.progressDist = (this.lap - 1) * track.totalLength + this.maxDistThisLap;
    } else {
      if (currD > this.maxDistThisLap) this.maxDistThisLap = currD;
      this.progressDist = this.maxDistThisLap;
      if (this.maxDistThisLap >= track.totalLength - 18 && !this.finished) {
        this.finished = true;
        this.finishTime = raceClock;
      }
    }
    this.lastMainDist = currD;

    const driftVisual = isSharpCorner ? Math.sign(dyaw) * 0.34 : 0;
    const boostTier: 0 | 1 | 2 | 3 = this.boostTimer > 0 ? 2 : 0;
    this.syncMesh(dt, steerRatio, driftVisual, boostTier);
  }

  private syncMesh(dt: number, steer: number, driftAngle: number, boostTier: 0 | 1 | 2 | 3): void {
    this.visual.root.position.set(this.x, this.y, this.z);
    this.visual.root.rotation.y = this.yaw + driftAngle * 0.55;
    this.visual.updateVisuals(dt, this.speedKmh, steer, driftAngle, boostTier, false);
  }
}
