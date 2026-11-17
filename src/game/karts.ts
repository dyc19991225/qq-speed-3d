import * as THREE from 'three';
import type { KartId, KartSpec } from './types';

export const KART_SPECS: Record<KartId, KartSpec> = {
  renault: {
    id: 'renault',
    name: '经典雷诺 · Renault',
    tier: 'A 级重装经典',
    desc: '稳重抗撞、极速强劲，漂移抓地扎实，十一城/秋名山全能神车',
    bodyColor: 0x26446b,
    accentColor: 0xffb72b,
    baseMaxSpeed: 204,
    miniBoostSpeed: 244,
    nitroSpeed: 274,
    cwwMaxSpeed: 312,
    accel: 1.0,
    driftGrip: 1.02,
    chargeRate: 1.04
  },
  razor: {
    id: 'razor',
    name: 'S-追光剃刀 · Razor',
    tier: 'S 级流线超跑',
    desc: '极限集气效率与爆发力，段位双喷与 CWW 喷极速天花板',
    bodyColor: 0xc9262e,
    accentColor: 0x38d9ff,
    baseMaxSpeed: 208,
    miniBoostSpeed: 248,
    nitroSpeed: 278,
    cwwMaxSpeed: 318,
    accel: 1.06,
    driftGrip: 1.06,
    chargeRate: 1.16
  },
  rookie: {
    id: 'rookie',
    name: '经典板车 · Rookie',
    tier: '情怀初心神车',
    desc: '梦开始的地方！轻巧灵活、手感纯粹，老玩家情怀满格',
    bodyColor: 0x2c78d4,
    accentColor: 0xf7d02c,
    baseMaxSpeed: 198,
    miniBoostSpeed: 238,
    nitroSpeed: 266,
    cwwMaxSpeed: 302,
    accel: 0.98,
    driftGrip: 1.0,
    chargeRate: 1.0
  }
};

export interface BuiltKartVisual {
  root: THREE.Group;
  chassisPivot: THREE.Group;
  wheels: THREE.Mesh[];
  frontSteerPivots: THREE.Group[];
  flames: THREE.Mesh[];
  flameLight: THREE.PointLight;
  brakeLights: THREE.Mesh[];
  updateVisuals: (
    dt: number,
    speedKmh: number,
    steerInput: number,
    driftAngle: number,
    boostTier: 0 | 1 | 2 | 3, // 0=none, 1=mini, 2=nitro, 3=cww/wcw
    braking: boolean
  ) => void;
}

export function buildKartMesh(spec: KartSpec): BuiltKartVisual {
  const root = new THREE.Group();
  const chassisPivot = new THREE.Group();
  root.add(chassisPivot);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: spec.bodyColor,
    roughness: 0.32,
    metalness: 0.65
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: spec.accentColor,
    roughness: 0.35,
    metalness: 0.55
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x171b22,
    roughness: 0.65,
    metalness: 0.45
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x10283d,
    roughness: 0.12,
    metalness: 0.85
  });
  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x15171c,
    roughness: 0.88
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: spec.accentColor,
    roughness: 0.3,
    metalness: 0.8
  });

  // Underglow neon strip
  const underglow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.75, 2.9),
    new THREE.MeshBasicMaterial({
      color: spec.accentColor,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide
    })
  );
  underglow.rotation.x = -Math.PI / 2;
  underglow.position.y = 0.04;
  root.add(underglow);

  // Chassis geometry varies by KartId for distinct silhouettes
  if (spec.id === 'rookie') {
    const floorPan = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.22, 2.55), bodyMat);
    floorPan.position.set(0, 0.32, 0);
    floorPan.castShadow = true;
    chassisPivot.add(floorPan);

    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.28, 0.9), accentMat);
    nose.position.set(0, 0.42, -1.05);
    chassisPivot.add(nose);

    const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.22), darkMat);
    seatBack.position.set(0, 0.68, 0.35);
    chassisPivot.add(seatBack);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.1, 0.34), accentMat);
    wing.position.set(0, 0.88, 1.15);
    chassisPivot.add(wing);
  } else if (spec.id === 'renault') {
    // Muscular wide A-car silhouette
    const lowerHull = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.36, 3.05), darkMat);
    lowerHull.position.set(0, 0.34, 0);
    lowerHull.castShadow = true;
    chassisPivot.add(lowerHull);

    const upperBody = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.38, 2.6), bodyMat);
    upperBody.position.set(0, 0.62, 0.05);
    upperBody.castShadow = true;
    chassisPivot.add(upperBody);

    const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.34, 1.18), glassMat);
    canopy.position.set(0, 0.92, -0.05);
    chassisPivot.add(canopy);

    const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.22, 0.45), accentMat);
    frontBumper.position.set(0, 0.32, -1.45);
    chassisPivot.add(frontBumper);

    const spoilerWing = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.12, 0.42), accentMat);
    spoilerWing.position.set(0, 1.12, 1.32);
    chassisPivot.add(spoilerWing);

    for (const sx of [-0.66, 0.66]) {
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.38, 0.3), darkMat);
      pylon.position.set(sx, 0.9, 1.28);
      chassisPivot.add(pylon);
    }
  } else {
    // Sleek low-slung S-car wedge
    const mainWedge = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.3, 3.15), bodyMat);
    mainWedge.position.set(0, 0.34, 0);
    mainWedge.castShadow = true;
    chassisPivot.add(mainWedge);

    const noseCone = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.2, 0.95), accentMat);
    noseCone.position.set(0, 0.38, -1.35);
    noseCone.rotation.x = 0.14;
    chassisPivot.add(noseCone);

    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.32, 1.28), glassMat);
    cockpit.position.set(0, 0.62, -0.05);
    chassisPivot.add(cockpit);

    const sidePodL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 1.85), accentMat);
    sidePodL.position.set(-0.84, 0.35, 0.1);
    chassisPivot.add(sidePodL);
    const sidePodR = sidePodL.clone();
    sidePodR.position.x = 0.84;
    chassisPivot.add(sidePodR);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.09, 0.4), bodyMat);
    wing.position.set(0, 0.96, 1.38);
    chassisPivot.add(wing);
  }

  // Driver Helmet inside open/semi-open cockpit
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xf4f7fc, roughness: 0.3 })
  );
  helmet.position.set(0, 0.88, 0.08);
  chassisPivot.add(helmet);

  // Wheels (2 front steerable + 2 wide rear)
  const wheels: THREE.Mesh[] = [];
  const frontSteerPivots: THREE.Group[] = [];
  const wheelCoords: Array<[number, number, number, boolean]> = [
    [-0.86, 0.32, -1.04, true],
    [0.86, 0.32, -1.04, true],
    [-0.9, 0.36, 1.05, false],
    [0.9, 0.36, 1.05, false]
  ];

  for (const [wx, wy, wz, isFront] of wheelCoords) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, wy, wz);
    const wRad = isFront ? 0.32 : 0.36;
    const wWid = isFront ? 0.26 : 0.34;
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(wRad, wRad, wWid, 14), tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    pivot.add(tire);

    const rim = new THREE.Mesh(new THREE.CylinderGeometry(wRad * 0.56, wRad * 0.56, wWid + 0.02, 8), rimMat);
    rim.rotation.z = Math.PI / 2;
    pivot.add(rim);

    root.add(pivot);
    wheels.push(tire);
    if (isFront) frontSteerPivots.push(pivot);
  }

  // Brake Lights
  const brakeLights: THREE.Mesh[] = [];
  for (const bx of [-0.52, 0.52]) {
    const bl = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.1, 0.06),
      new THREE.MeshBasicMaterial({ color: 0x7a1010 })
    );
    bl.position.set(bx, 0.56, 1.54);
    chassisPivot.add(bl);
    brakeLights.push(bl);
  }

  // Dual Exhaust Pipes + Dynamic Boost Flames
  const flames: THREE.Mesh[] = [];
  for (const ex of [-0.42, 0.42]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.28, 10), darkMat);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(ex, 0.38, 1.56);
    chassisPivot.add(pipe);

    const flameGeo = new THREE.ConeGeometry(0.14, 1.15, 10);
    flameGeo.translate(0, 0.55, 0);
    flameGeo.rotateX(Math.PI / 2);
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0x3ad2ff,
      transparent: true,
      opacity: 0.9
    });
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(ex, 0.38, 1.66);
    flame.visible = false;
    chassisPivot.add(flame);
    flames.push(flame);
  }

  const flameLight = new THREE.PointLight(0x3ad2ff, 0, 8);
  flameLight.position.set(0, 0.45, 2.1);
  chassisPivot.add(flameLight);

  return {
    root,
    chassisPivot,
    wheels,
    frontSteerPivots,
    flames,
    flameLight,
    brakeLights,
    updateVisuals: (dt, speedKmh, steerInput, driftAngle, boostTier, braking) => {
      const wheelSpin = (speedKmh / 3.6) * dt * 2.8;
      for (const w of wheels) w.rotation.x -= wheelSpin;

      const steerAngle = steerInput * 0.42 - driftAngle * 0.35;
      for (const p of frontSteerPivots) p.rotation.y = steerAngle;

      // Body roll & pitch suspension
      chassisPivot.rotation.z = THREE.MathUtils.lerp(
        chassisPivot.rotation.z,
        -steerInput * 0.065 + driftAngle * 0.14,
        Math.min(1, dt * 10)
      );
      chassisPivot.rotation.x = THREE.MathUtils.lerp(
        chassisPivot.rotation.x,
        boostTier > 0 ? 0.045 : braking ? -0.05 : 0,
        Math.min(1, dt * 10)
      );

      for (const bl of brakeLights) {
        (bl.material as THREE.MeshBasicMaterial).color.setHex(braking ? 0xff2222 : 0x6b1010);
      }

      if (boostTier > 0) {
        const flicker = 0.85 + Math.random() * 0.45;
        const lenScale = boostTier === 3 ? 2.15 : boostTier === 2 ? 1.55 : 0.95;
        const colorHex =
          boostTier === 3 ? 0xc855ff : boostTier === 2 ? 0x35c9ff : 0xffaa2b;
        for (const f of flames) {
          f.visible = true;
          f.scale.set(
            boostTier === 3 ? 1.35 : 1.0,
            boostTier === 3 ? 1.35 : 1.0,
            lenScale * flicker
          );
          (f.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
        }
        flameLight.color.setHex(colorHex);
        flameLight.intensity = (boostTier === 3 ? 8 : boostTier === 2 ? 5 : 2.5) * flicker;
      } else {
        for (const f of flames) f.visible = false;
        flameLight.intensity = 0;
      }
    }
  };
}
