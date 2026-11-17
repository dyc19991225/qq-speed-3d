import * as THREE from 'three';
import type { SampledPoint, ShortcutBranch, TrackData } from './types';

export interface TrackQueryResult {
  onMain: boolean;
  branchId: string | null;
  sample: SampledPoint;
  sampleIdx: number;
  lateralOffset: number; // signed distance along sample.right
  roadY: number;
  halfWidth: number;
  wallHit: boolean;
  wallNormalX: number;
  wallNormalZ: number;
  clampedX: number;
  clampedZ: number;
  mainDistAlong: number; // monotonic race progress along main track [0..totalLength]
}

function projectToRibbon(
  x: number,
  y: number,
  z: number,
  samples: SampledPoint[],
  closed: boolean
): {
  idx: number;
  sample: SampledPoint;
  lat: number;
  horizDistSq: number;
  vertGap: number;
} {
  let bestIdx = 0;
  let bestScore = Infinity;
  let bestLat = 0;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const dx = x - s.pos.x;
    const dz = z - s.pos.z;
    const dSq = dx * dx + dz * dz;
    const dy = Math.abs(y - s.pos.y);
    // Prefer road surface close in height & XZ
    const score = dSq + (dy > 4.5 ? dy * dy * 8 : 0);
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
      bestLat = dx * s.right.x + dz * s.right.z;
    }
  }

  // Refine along segment [bestIdx, nextIdx] for ultra-smooth elevation & width interpolation
  const n = samples.length;
  const s0 = samples[bestIdx];
  const nextIdx = closed ? (bestIdx + 1) % n : Math.min(n - 1, bestIdx + 1);
  const prevIdx = closed ? (bestIdx - 1 + n) % n : Math.max(0, bestIdx - 1);

  const dx0 = x - s0.pos.x;
  const dz0 = z - s0.pos.z;
  const along = dx0 * s0.tangent.x + dz0 * s0.tangent.z;
  const sOther = along >= 0 ? samples[nextIdx] : samples[prevIdx];
  const segLen = Math.max(0.1, s0.pos.distanceTo(sOther.pos));
  const t = Math.max(0, Math.min(0.99, Math.abs(along) / segLen));

  const interpPos = s0.pos.clone().lerp(sOther.pos, t);
  const interpRight = s0.right.clone().lerp(sOther.right, t).normalize();
  const interpTan = s0.tangent.clone().lerp(sOther.tangent, t).normalize();
  const interpNorm = s0.normal.clone().lerp(sOther.normal, t).normalize();
  const width = THREE.MathUtils.lerp(s0.width, sOther.width, t);
  const distAlong = THREE.MathUtils.lerp(s0.distAlong, sOther.distAlong, t);

  const dx = x - interpPos.x;
  const dz = z - interpPos.z;
  bestLat = dx * interpRight.x + dz * interpRight.z;

  return {
    idx: bestIdx,
    sample: {
      pos: interpPos,
      tangent: interpTan,
      right: interpRight,
      normal: interpNorm,
      width,
      bank: THREE.MathUtils.lerp(s0.bank, sOther.bank, t),
      distAlong,
      jumpLip: s0.jumpLip,
      label: s0.label ?? sOther.label
    },
    lat: bestLat,
    horizDistSq: dx * dx + dz * dz,
    vertGap: Math.abs(y - interpPos.y)
  };
}

export function queryTrackSurface(
  track: TrackData,
  x: number,
  y: number,
  z: number,
  carRadius = 1.05
): TrackQueryResult {
  const closed = track.laps > 1;
  const mainProj = projectToRibbon(x, y, z, track.mainSamples, closed);
  const mainHalf = mainProj.sample.width * 0.5;
  const insideMain = Math.abs(mainProj.lat) <= mainHalf - carRadius * 0.25 && mainProj.vertGap < 6.5;

  // Check shortcut branches
  let bestBranch: ShortcutBranch | null = null;
  let bestBranchProj: ReturnType<typeof projectToRibbon> | null = null;

  for (const sc of track.shortcuts) {
    const bp = projectToRibbon(x, y, z, sc.samples, false);
    const scHalf = bp.sample.width * 0.5;
    if (Math.abs(bp.lat) <= scHalf + 1.5 && bp.vertGap < 5.0) {
      if (!bestBranchProj || Math.abs(bp.lat) < Math.abs(bestBranchProj.lat)) {
        bestBranch = sc;
        bestBranchProj = bp;
      }
    }
  }

  // Decide active surface (shortcut wins if inside shortcut corridor and closer to its centerline than main!)
  let useBranch = false;
  if (bestBranch && bestBranchProj) {
    const scHalf = bestBranchProj.sample.width * 0.5;
    const insideSc = Math.abs(bestBranchProj.lat) <= scHalf;
    if (insideSc && (!insideMain || Math.abs(bestBranchProj.lat) < Math.abs(mainProj.lat))) {
      useBranch = true;
    }
  }

  const active = useBranch && bestBranchProj ? bestBranchProj : mainProj;
  const halfW = active.sample.width * 0.5;
  const maxLat = halfW - carRadius;

  // Compute map progress along main loop even when taking a shortcut
  let mainDistAlong = mainProj.sample.distAlong;
  if (useBranch && bestBranch && bestBranchProj) {
    const frac = Math.max(0, Math.min(1, bestBranchProj.sample.distAlong / Math.max(1, bestBranch.totalLength)));
    mainDistAlong = THREE.MathUtils.lerp(bestBranch.joinStartDist, bestBranch.joinEndDist, frac);
  }

  // Check if in a shortcut split/merge union mouth so guardrails never block entering/exiting!
  let inForkMouth = false;
  for (const sc of track.shortcuts) {
    if (
      Math.abs(mainProj.sample.distAlong - sc.joinStartDist) < 16 ||
      Math.abs(mainProj.sample.distAlong - sc.joinEndDist) < 16
    ) {
      const bp = projectToRibbon(x, y, z, sc.samples, false);
      if (Math.abs(bp.lat) <= bp.sample.width * 0.5 - carRadius * 0.5) {
        inForkMouth = true;
        break;
      }
    }
  }

  let wallHit = false;
  let clampedX = x;
  let clampedZ = z;
  let wallNormalX = 0;
  let wallNormalZ = 0;

  if (!inForkMouth && Math.abs(active.lat) > maxLat) {
    wallHit = true;
    const sign = active.lat > 0 ? 1 : -1;
    const clampedLat = sign * maxLat;
    clampedX = active.sample.pos.x + active.sample.right.x * clampedLat;
    clampedZ = active.sample.pos.z + active.sample.right.z * clampedLat;
    wallNormalX = -active.sample.right.x * sign;
    wallNormalZ = -active.sample.right.z * sign;
  }

  return {
    onMain: !useBranch,
    branchId: useBranch && bestBranch ? bestBranch.id : null,
    sample: active.sample,
    sampleIdx: active.idx,
    lateralOffset: active.lat,
    roadY: active.sample.pos.y,
    halfWidth: halfW,
    wallHit,
    wallNormalX,
    wallNormalZ,
    clampedX,
    clampedZ,
    mainDistAlong
  };
}
