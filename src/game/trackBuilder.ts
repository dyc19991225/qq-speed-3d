import * as THREE from 'three';
import type { SampledPoint, ShortcutBranch, TrackData } from './types';

function makeAsphaltTex(isNight: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = isNight ? '#1b2028' : '#303640';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle asphalt grain
  for (let i = 0; i < 3200; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.16)';
    ctx.fillRect(x, y, 2, 2);
  }

  // Racing lane borders & dashed center line
  ctx.fillStyle = isNight ? '#f0b429' : '#f4f6f9';
  ctx.fillRect(14, 0, 10, 512);
  ctx.fillRect(488, 0, 10, 512);

  // Subtle shoulder kerbs
  for (let y = 0; y < 512; y += 64) {
    ctx.fillStyle = (y / 64) % 2 === 0 ? '#d93829' : '#eef2f6';
    ctx.fillRect(0, y, 14, 64);
    ctx.fillRect(498, y, 14, 64);
  }

  // Center dashed line
  ctx.fillStyle = 'rgba(255, 224, 102, 0.72)';
  for (let y = 16; y < 512; y += 96) {
    ctx.fillRect(252, y, 8, 50);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeShortcutTex(surface: ShortcutBranch['surface']): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;

  if (surface === 'wood') {
    ctx.fillStyle = '#7d542b';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 24) {
      ctx.fillStyle = y % 48 === 0 ? '#8c6034' : '#6f4824';
      ctx.fillRect(0, y, 256, 22);
      ctx.fillStyle = '#3d2511';
      ctx.fillRect(0, y + 22, 256, 2);
    }
  } else if (surface === 'pipe') {
    ctx.fillStyle = '#334454';
    ctx.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 32) {
      ctx.fillStyle = x % 64 === 0 ? '#3f5366' : '#2a3846';
      ctx.fillRect(x, 0, 30, 256);
    }
    ctx.fillStyle = '#38d9ff';
    ctx.fillRect(0, 0, 10, 256);
    ctx.fillRect(246, 0, 10, 256);
  } else {
    ctx.fillStyle = '#5c6472';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#3b424d';
    ctx.lineWidth = 3;
    for (let y = 0; y < 256; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(256, y);
      ctx.stroke();
    }
    ctx.fillStyle = '#f5b82e';
    ctx.fillRect(0, 0, 10, 256);
    ctx.fillRect(246, 0, 10, 256);
  }

  // Glowing shortcut direction chevrons
  ctx.strokeStyle = 'rgba(72, 232, 255, 0.72)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(80, 180);
  ctx.lineTo(128, 120);
  ctx.lineTo(176, 180);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeArchBannerTex(title: string, bg: string, fg: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 192;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1024, 192);

  // Checkered borders
  for (let x = 0; x < 1024; x += 32) {
    ctx.fillStyle = (x / 32) % 2 === 0 ? '#ffffff' : '#11151b';
    ctx.fillRect(x, 0, 32, 24);
    ctx.fillRect(x, 168, 32, 24);
  }

  ctx.fillStyle = fg;
  ctx.font = 'bold 64px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 512, 96);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildRibbonMesh(
  samples: SampledPoint[],
  closed: boolean,
  mat: THREE.Material,
  uvTileDist = 14
): THREE.Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const n = samples.length;
  const count = closed ? n + 1 : n;

  for (let i = 0; i < count; i++) {
    const s = samples[i % n];
    const hw = s.width * 0.5;
    const pL = s.pos.clone().addScaledVector(s.right, -hw);
    const pR = s.pos.clone().addScaledVector(s.right, hw);

    positions.push(pL.x, pL.y, pL.z, pR.x, pR.y, pR.z);
    normals.push(s.normal.x, s.normal.y, s.normal.z, s.normal.x, s.normal.y, s.normal.z);

    const vCoord = (i === n ? samples[n - 1].distAlong + 4 : s.distAlong) / uvTileDist;
    uvs.push(0, vCoord, 1, vCoord);
  }

  for (let i = 0; i < count - 1; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    // Right-handed upward (+Y) winding: (b - a) x (c - a) = (+right) x (+tangent) = +Y
    indices.push(a, b, c, b, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function buildRoadDeckSkirt(
  samples: SampledPoint[],
  closed: boolean,
  mat: THREE.Material
): THREE.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const depth = 1.6;
  const n = samples.length;
  const count = closed ? n + 1 : n;

  for (let i = 0; i < count; i++) {
    const s = samples[i % n];
    const hw = s.width * 0.5 + 0.35;
    const tL = s.pos.clone().addScaledVector(s.right, -hw);
    const tR = s.pos.clone().addScaledVector(s.right, hw);
    const bL = tL.clone().add(new THREE.Vector3(0, -depth, 0));
    const bR = tR.clone().add(new THREE.Vector3(0, -depth, 0));
    positions.push(tL.x, tL.y, tL.z, bL.x, bL.y, bL.z, tR.x, tR.y, tR.z, bR.x, bR.y, bR.z);
  }

  for (let i = 0; i < count - 1; i++) {
    const o = i * 4;
    const nxt = (i + 1) * 4;
    // Left skirt face
    indices.push(o + 0, o + 1, nxt + 0, o + 1, nxt + 1, nxt + 0);
    // Right skirt face
    indices.push(o + 2, nxt + 2, o + 3, o + 3, nxt + 2, nxt + 3);
    // Bottom soffit face
    indices.push(o + 1, o + 3, nxt + 1, o + 3, nxt + 3, nxt + 1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

function buildGuardrailWall(
  samples: SampledPoint[],
  side: -1 | 1,
  closed: boolean,
  mat: THREE.Material,
  skipMask?: boolean[]
): THREE.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const wallH = 1.15;
  const n = samples.length;
  const count = closed ? n + 1 : n;

  for (let i = 0; i < count; i++) {
    const idx = i % n;
    const s = samples[idx];
    const hw = s.width * 0.5 + 0.15;
    const base = s.pos.clone().addScaledVector(s.right, side * hw);
    const top = base.clone().addScaledVector(s.normal, wallH);
    positions.push(base.x, base.y - 0.15, base.z, top.x, top.y, top.z);
  }

  for (let i = 0; i < count - 1; i++) {
    const idx = i % n;
    if (skipMask && skipMask[idx]) continue;
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    if (side === 1) {
      indices.push(a, b, c, b, d, c);
    } else {
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

function addStartArch(scene: THREE.Scene, s: SampledPoint, title: string, isNight: boolean): void {
  const g = new THREE.Group();
  g.position.copy(s.pos);
  const yaw = Math.atan2(-s.tangent.x, -s.tangent.z);
  g.rotation.y = yaw;

  const span = s.width + 2.2;
  const pillarMat = new THREE.MeshStandardMaterial({
    color: isNight ? 0x222a38 : 0x2a456e,
    roughness: 0.4,
    metalness: 0.6
  });
  for (const px of [-span * 0.5, span * 0.5]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 8.2, 1.4), pillarMat);
    pillar.position.set(px, 4.1, 0);
    pillar.castShadow = true;
    g.add(pillar);
  }

  const bannerTex = makeArchBannerTex(
    title,
    isNight ? '#111927' : '#0f3057',
    isNight ? '#4be3ff' : '#ffd24c'
  );
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(span + 1.2, 2.5, 0.9),
    new THREE.MeshBasicMaterial({ map: bannerTex })
  );
  banner.position.set(0, 7.6, 0);
  g.add(banner);

  // Checkered start line strip on ground
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  for (let x = 0; x < 512; x += 32) {
    for (let y = 0; y < 64; y += 32) {
      ctx.fillStyle = ((x / 32 + y / 32) % 2 === 0) ? '#ffffff' : '#12151a';
      ctx.fillRect(x, y, 32, 32);
    }
  }
  const lineTex = new THREE.CanvasTexture(c);
  lineTex.colorSpace = THREE.SRGBColorSpace;
  const startLine = new THREE.Mesh(
    new THREE.PlaneGeometry(s.width, 2.8),
    new THREE.MeshBasicMaterial({ map: lineTex })
  );
  startLine.rotation.x = -Math.PI / 2;
  startLine.position.set(0, 0.03, 0);
  g.add(startLine);

  scene.add(g);
}

function addShortcutGate(scene: THREE.Scene, sc: ShortcutBranch, label: string): void {
  const s = sc.samples[Math.min(2, sc.samples.length - 1)];
  const g = new THREE.Group();
  g.position.copy(s.pos);
  g.rotation.y = Math.atan2(-s.tangent.x, -s.tangent.z);

  const glowMat = new THREE.MeshBasicMaterial({ color: 0x36e6ff });
  const postL = new THREE.Mesh(new THREE.BoxGeometry(0.45, 5.0, 0.45), glowMat);
  postL.position.set(-s.width * 0.48, 2.5, 0);
  const postR = postL.clone();
  postR.position.x = s.width * 0.48;
  g.add(postL, postR);

  const signTex = makeArchBannerTex(`>>> ${label} >>>`, '#0c2338', '#42f2ff');
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(s.width, 1.35, 0.35),
    new THREE.MeshBasicMaterial({ map: signTex })
  );
  sign.position.set(0, 5.2, 0);
  g.add(sign);

  scene.add(g);
}

export function buildTrackScene(scene: THREE.Scene, track: TrackData): void {
  const isNight = track.theme === 'night_mountain';

  // Clear existing scene objects cleanly before rebuilding
  while (scene.children.length > 0) {
    scene.remove(scene.children[0]);
  }

  if (isNight) {
    scene.background = new THREE.Color(0x070d1c);
    scene.fog = new THREE.FogExp2(0x0b152b, 0.0028);

    const hemi = new THREE.HemisphereLight(0x5274a8, 0x101824, 0.95);
    scene.add(hemi);

    const moon = new THREE.DirectionalLight(0xbfd9ff, 1.35);
    moon.position.set(80, 140, -120);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.left = -220;
    moon.shadow.camera.right = 220;
    moon.shadow.camera.top = 220;
    moon.shadow.camera.bottom = -220;
    moon.shadow.camera.far = 500;
    scene.add(moon);

    // Night Mountain Ground & Stars
    const mountainFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(1800, 1800),
      new THREE.MeshStandardMaterial({ color: 0x121d1a, roughness: 0.95 })
    );
    mountainFloor.rotation.x = -Math.PI / 2;
    mountainFloor.position.set(0, -12, -350);
    scene.add(mountainFloor);

    // Starfield
    const starPts: number[] = [];
    for (let i = 0; i < 900; i++) {
      starPts.push(
        (Math.random() - 0.5) * 1400,
        140 + Math.random() * 240,
        -350 + (Math.random() - 0.5) * 1400
      );
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPts, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xd9ecff, size: 1.8 })));
  } else {
    // Sunny Blue-Sky City 11 Atmosphere
    scene.background = new THREE.Color(0x74b6f0);
    scene.fog = new THREE.FogExp2(0x9bcdf5, 0.0017);

    const hemi = new THREE.HemisphereLight(0xf2f8ff, 0x3b5870, 1.15);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff4dd, 1.6);
    sun.position.set(110, 180, 90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -280;
    sun.shadow.camera.right = 280;
    sun.shadow.camera.top = 280;
    sun.shadow.camera.bottom = -280;
    sun.shadow.camera.far = 580;
    scene.add(sun);

    // City base terrace ground & harbor sea (ocean sits well below city terrace)
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(450, 4.0, 480),
      new THREE.MeshStandardMaterial({ color: 0x3f6342, roughness: 0.92 })
    );
    ground.position.set(-45, -2.5, -25);
    ground.receiveShadow = true;
    scene.add(ground);

    const seawall = new THREE.Mesh(
      new THREE.BoxGeometry(456, 2.2, 486),
      new THREE.MeshStandardMaterial({ color: 0x626b75, roughness: 0.8 })
    );
    seawall.position.set(-45, -4.6, -25);
    scene.add(seawall);

    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(1800, 1800),
      new THREE.MeshStandardMaterial({ color: 0x1565a0, roughness: 0.22, metalness: 0.15 })
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, -5.8, -50);
    scene.add(sea);
  }

  const closed = track.laps > 1;
  const asphaltMat = new THREE.MeshStandardMaterial({
    map: makeAsphaltTex(isNight),
    roughness: 0.72,
    metalness: 0.08,
    side: THREE.DoubleSide
  });

  // Main Road Ribbon + Solid Concrete Deck Slab & Piers
  const mainMesh = buildRibbonMesh(track.mainSamples, closed, asphaltMat, 14);
  scene.add(mainMesh);
  const deckSkirtMat = new THREE.MeshStandardMaterial({
    color: isNight ? 0x222934 : 0x6c7582,
    roughness: 0.85,
    side: THREE.DoubleSide
  });
  scene.add(buildRoadDeckSkirt(track.mainSamples, closed, deckSkirtMat));

  // Concrete bridge piers supporting elevated road segments
  const pierMat = new THREE.MeshStandardMaterial({ color: isNight ? 0x2a3340 : 0x7b8594, roughness: 0.8 });
  for (let i = 0; i < track.mainSamples.length; i += 10) {
    const s = track.mainSamples[i];
    const baseFloorY = isNight ? -12 : -5.8;
    const h = s.pos.y - baseFloorY;
    if (h > 3.5) {
      const pier = new THREE.Mesh(new THREE.BoxGeometry(3.4, h, 3.4), pierMat);
      pier.position.set(s.pos.x, baseFloorY + h * 0.5 - 0.8, s.pos.z);
      scene.add(pier);
    }
  }

  // Build skip masks so guardrails leave open fork mouths for shortcuts!
  const skipLeft = new Array<boolean>(track.mainSamples.length).fill(false);
  const skipRight = new Array<boolean>(track.mainSamples.length).fill(false);

  for (const sc of track.shortcuts) {
    const midSc = sc.samples[Math.floor(sc.samples.length * 0.35)];
    for (let i = 0; i < track.mainSamples.length; i++) {
      const s = track.mainSamples[i];
      const nearStart = Math.abs(s.distAlong - sc.joinStartDist) < 17;
      const nearEnd = Math.abs(s.distAlong - sc.joinEndDist) < 17;
      if (nearStart || nearEnd) {
        const sideDot = midSc.pos.clone().sub(s.pos).dot(s.right);
        if (sideDot >= 0) skipRight[i] = true;
        else skipLeft[i] = true;
      }
    }
  }

  const wallMat = new THREE.MeshStandardMaterial({
    color: isNight ? 0x3b485c : 0xcbd4e0,
    roughness: 0.55,
    metalness: 0.35
  });
  scene.add(buildGuardrailWall(track.mainSamples, -1, closed, wallMat, skipLeft));
  scene.add(buildGuardrailWall(track.mainSamples, 1, closed, wallMat, skipRight));

  // Shortcut Bridges / Pipes
  for (const sc of track.shortcuts) {
    const scMat = new THREE.MeshStandardMaterial({
      map: makeShortcutTex(sc.surface),
      roughness: sc.surface === 'pipe' ? 0.42 : 0.78,
      metalness: sc.surface === 'pipe' ? 0.5 : 0.05,
      side: THREE.DoubleSide
    });
    scene.add(buildRibbonMesh(sc.samples, false, scMat, 10));
    scene.add(buildRoadDeckSkirt(sc.samples, false, deckSkirtMat));

    const scWallMat = new THREE.MeshStandardMaterial({
      color: sc.surface === 'wood' ? 0x6e4722 : sc.surface === 'pipe' ? 0x35a5cc : 0xe0a229,
      roughness: 0.65
    });
    // Omit first & last 2 wall segments of shortcut so join mouths are smooth
    const scSkip = sc.samples.map((_, idx) => idx < 2 || idx >= sc.samples.length - 3);
    scene.add(buildGuardrailWall(sc.samples, -1, false, scWallMat, scSkip));
    scene.add(buildGuardrailWall(sc.samples, 1, false, scWallMat, scSkip));

    addShortcutGate(scene, sc, sc.name);

    // Decorative pipe ribs on Akina pipe shortcut
    if (sc.surface === 'pipe') {
      const archMat = new THREE.MeshStandardMaterial({ color: 0x3c5266, metalness: 0.6, roughness: 0.4 });
      for (let i = 3; i < sc.samples.length - 3; i += 4) {
        const ps = sc.samples[i];
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(ps.width * 0.52, 0.35, 8, 16, Math.PI),
          archMat
        );
        ring.position.copy(ps.pos);
        ring.rotation.y = Math.atan2(-ps.tangent.x, -ps.tangent.z);
        scene.add(ring);
      }
    }
  }

  // Start & Finish Arches
  addStartArch(
    scene,
    track.mainSamples[0],
    track.id === 'city11' ? 'QQ SPEED · 十一城 CITY 11' : 'QQ SPEED · 秋名山 AKINA',
    isNight
  );
  if (!closed) {
    addStartArch(
      scene,
      track.mainSamples[track.mainSamples.length - 2],
      'FINISH · 秋名山山脚终点',
      true
    );
  }

  // Trackside Environment Props (Buildings, Trees, Lamps, Curve Warning Arrows)
  addSceneryProps(scene, track, isNight);
}

function addSceneryProps(scene: THREE.Scene, track: TrackData, isNight: boolean): void {
  const lampPostMat = new THREE.MeshStandardMaterial({ color: 0x2b333f, metalness: 0.6 });
  const lampBulbMat = new THREE.MeshBasicMaterial({ color: isNight ? 0xffb84d : 0xfff6d0 });
  const bldgColors = [0xd9c2a3, 0xc77b58, 0xe8e2d5, 0x5c7f9e, 0xb85844, 0x8ea4b8];
  const pineMat = new THREE.MeshStandardMaterial({ color: isNight ? 0x163828 : 0x266335, roughness: 0.9 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4d3421, roughness: 0.9 });

  const isNearAnyRoad = (px: number, pz: number, minClearance: number): boolean => {
    for (let i = 0; i < track.mainSamples.length; i += 2) {
      const s = track.mainSamples[i];
      if (Math.hypot(px - s.pos.x, pz - s.pos.z) < s.width * 0.5 + minClearance) return true;
    }
    for (const sc of track.shortcuts) {
      for (let i = 0; i < sc.samples.length; i += 2) {
        const s = sc.samples[i];
        if (Math.hypot(px - s.pos.x, pz - s.pos.z) < s.width * 0.5 + minClearance) return true;
      }
    }
    return false;
  };

  // Streetlamps & Turn Chevron Boards along main track
  for (let i = 6; i < track.mainSamples.length - 4; i += 10) {
    const s = track.mainSamples[i];
    const side = (i / 10) % 2 === 0 ? 1 : -1;
    const lpPos = s.pos.clone().addScaledVector(s.right, side * (s.width * 0.5 + 1.4));

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 6.2, 6), lampPostMat);
    pole.position.set(lpPos.x, lpPos.y + 3.1, lpPos.z);
    scene.add(pole);

    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.4), lampBulbMat);
    bulb.position.set(lpPos.x, lpPos.y + 6.1, lpPos.z);
    scene.add(bulb);

    // Curve sharp chevron arrow boards where road bends sharply
    const next = track.mainSamples[(i + 5) % track.mainSamples.length];
    const crossY = s.tangent.x * next.tangent.z - s.tangent.z * next.tangent.x;
    if (Math.abs(crossY) > 0.24) {
      const outerSide = crossY > 0 ? -1 : 1;
      const signPos = s.pos.clone().addScaledVector(s.right, outerSide * (s.width * 0.5 + 1.2));
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 1.5, 0.35),
        new THREE.MeshBasicMaterial({ color: 0xf5b828 })
      );
      sign.position.set(signPos.x, signPos.y + 2.1, signPos.z);
      sign.rotation.y = Math.atan2(-s.tangent.x, -s.tangent.z);
      scene.add(sign);
    }
  }

  // City Buildings (City 11) OR Mountain Pines & Peaks (Akina)
  for (let i = 0; i < track.mainSamples.length; i += 6) {
    const s = track.mainSamples[i];
    for (const side of [-1, 1] as const) {
      const w = isNight ? 8 : 10 + Math.random() * 10;
      const d = isNight ? 8 : 10 + Math.random() * 10;
      const propRad = Math.hypot(w, d) * 0.5;
      const offsetDist = s.width * 0.5 + propRad + 10 + Math.random() * 18;
      const bx = s.pos.x + s.right.x * side * offsetDist;
      const bz = s.pos.z + s.right.z * side * offsetDist;
      if (isNearAnyRoad(bx, bz, propRad + 6.0)) continue;

      if (isNight) {
        // Pine tree cluster or dark rock peak
        if (Math.random() < 0.72) {
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 3.2, 6), trunkMat);
          trunk.position.set(bx, s.pos.y - 0.5, bz);
          scene.add(trunk);
          const cone = new THREE.Mesh(new THREE.ConeGeometry(3.4, 11 + Math.random() * 6, 7), pineMat);
          cone.position.set(bx, s.pos.y + 5.5, bz);
          scene.add(cone);
        } else {
          const peakH = 26 + Math.random() * 34;
          const peak = new THREE.Mesh(
            new THREE.ConeGeometry(16 + Math.random() * 12, peakH, 6),
            new THREE.MeshStandardMaterial({ color: 0x1c2530, roughness: 0.95 })
          );
          peak.position.set(bx, s.pos.y + peakH * 0.3 - 6, bz);
          scene.add(peak);
        }
      } else {
        // Mediterranean European villas & urban towers grounded solidly on city terrace (y = -0.5)
        const h = 14 + Math.random() * 34;
        const col = bldgColors[Math.floor(Math.random() * bldgColors.length)];
        const groundTopY = -0.5;
        const bldg = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, d),
          new THREE.MeshStandardMaterial({ color: col, roughness: 0.75 })
        );
        bldg.position.set(bx, groundTopY + h * 0.5, bz);
        bldg.castShadow = true;
        bldg.receiveShadow = true;
        scene.add(bldg);

        if (h < 24) {
          // Terracotta pitched roof accent
          const roof = new THREE.Mesh(
            new THREE.ConeGeometry(Math.max(w, d) * 0.72, 4.5, 4),
            new THREE.MeshStandardMaterial({ color: 0x9e3f2b, roughness: 0.8 })
          );
          roof.rotation.y = Math.PI / 4;
          roof.position.set(bx, groundTopY + h + 2.2, bz);
          scene.add(roof);
        }
      }
    }
  }
}
