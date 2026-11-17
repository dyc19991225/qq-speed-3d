import * as THREE from 'three';

export type TrackId = 'city11' | 'akina';
export type KartId = 'renault' | 'razor' | 'rookie';
export type ControlScheme = 'classic' | 'wasd';

export interface TrackNode {
  x: number;
  y: number;
  z: number;
  width: number;
  bank?: number; // tilt in radians
  jumpLip?: boolean;
  label?: string;
}

export interface SampledPoint {
  pos: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  normal: THREE.Vector3;
  width: number;
  bank: number;
  distAlong: number;
  jumpLip: boolean;
  label?: string;
}

export interface ShortcutBranch {
  id: string;
  name: string;
  joinStartDist: number; // distance along main loop where fork starts
  joinEndDist: number; // distance along main loop where fork rejoins
  surface: 'stone' | 'wood' | 'pipe' | 'asphalt';
  samples: SampledPoint[];
  totalLength: number;
}

export interface TrackData {
  id: TrackId;
  name: string;
  cnTitle: string;
  stars: number;
  laps: number;
  theme: 'day_city' | 'night_mountain';
  description: string;
  mainSamples: SampledPoint[];
  totalLength: number;
  shortcuts: ShortcutBranch[];
}

export interface KartSpec {
  id: KartId;
  name: string;
  tier: string;
  desc: string;
  bodyColor: number;
  accentColor: number;
  baseMaxSpeed: number; // km/h
  miniBoostSpeed: number;
  nitroSpeed: number;
  cwwMaxSpeed: number;
  accel: number;
  driftGrip: number;
  chargeRate: number;
}

export interface RacerTelemetry {
  id: string;
  name: string;
  isPlayer: boolean;
  kartId: KartId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speedKmh: number;
  lap: number;
  progressDist: number; // total race distance covered
  rank: number;
  finished: boolean;
  finishTime: number;
}
