import * as THREE from 'three';
import type { SampledPoint, ShortcutBranch, TrackData, TrackId, TrackNode } from './types';

function samplePolyline(
  nodes: TrackNode[],
  closed: boolean,
  samplesPerSegment = 14
): { samples: SampledPoint[]; totalLength: number } {
  const vecs = nodes.map((n) => new THREE.Vector3(n.x, n.y, n.z));
  const curve = new THREE.CatmullRomCurve3(vecs, closed, 'catmullrom', 0.42);
  const totalCount = (closed ? nodes.length : nodes.length - 1) * samplesPerSegment;

  const samples: SampledPoint[] = [];
  let accumDist = 0;
  let prevPos: THREE.Vector3 | null = null;

  for (let i = 0; i <= totalCount; i++) {
    const t = i / totalCount;
    if (closed && i === totalCount) break; // avoid duplicate endpoint on closed loop

    const pos = curve.getPointAt(Math.min(1, t));
    const tangent = curve.getTangentAt(Math.min(1, t)).normalize();

    if (prevPos) accumDist += prevPos.distanceTo(pos);
    prevPos = pos.clone();

    // Interpolate width, bank, jumpLip from nearest node segment
    const floatIdx = t * (closed ? nodes.length : nodes.length - 1);
    const i0 = Math.floor(floatIdx) % nodes.length;
    const i1 = (i0 + 1) % nodes.length;
    const frac = floatIdx - Math.floor(floatIdx);
    const n0 = nodes[i0];
    const n1 = nodes[i1];

    const width = THREE.MathUtils.lerp(n0.width, n1.width, frac);
    const bank = THREE.MathUtils.lerp(n0.bank ?? 0, n1.bank ?? 0, frac);

    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(tangent, worldUp).normalize();
    // Apply banking roll around tangent
    if (Math.abs(bank) > 0.001) {
      right.applyAxisAngle(tangent, bank).normalize();
    }
    const normal = new THREE.Vector3().crossVectors(right, tangent).normalize();

    samples.push({
      pos,
      tangent,
      right,
      normal,
      width,
      bank,
      distAlong: accumDist,
      jumpLip: Boolean(frac < 0.25 && n0.jumpLip),
      label: frac < 0.35 ? n0.label : undefined
    });
  }

  const totalLength = closed && samples.length > 1
    ? accumDist + samples[samples.length - 1].pos.distanceTo(samples[0].pos)
    : accumDist;

  return { samples, totalLength };
}

function buildShortcut(
  id: string,
  name: string,
  surface: ShortcutBranch['surface'],
  mainSamples: SampledPoint[],
  startIdx: number,
  endIdx: number,
  interiorNodes: TrackNode[]
): ShortcutBranch {
  const sNode: TrackNode = {
    x: mainSamples[startIdx].pos.x,
    y: mainSamples[startIdx].pos.y,
    z: mainSamples[startIdx].pos.z,
    width: interiorNodes[0]?.width ?? 10.5
  };
  const eNode: TrackNode = {
    x: mainSamples[endIdx].pos.x,
    y: mainSamples[endIdx].pos.y,
    z: mainSamples[endIdx].pos.z,
    width: interiorNodes[interiorNodes.length - 1]?.width ?? 10.5
  };
  const { samples, totalLength } = samplePolyline([sNode, ...interiorNodes, eNode], false, 12);
  return {
    id,
    name,
    joinStartDist: mainSamples[startIdx].distAlong,
    joinEndDist: mainSamples[endIdx].distAlong,
    surface,
    samples,
    totalLength
  };
}

/**
 * 十一城 (City 11 · 经典两圈赛)
 * 还原：起跑大道 -> M型弯 -> 西海岸连续U弯 -> 第一处U弯高架近道 -> 后半段三连近道 -> 海滨大桥冲刺
 */
function buildCity11(): TrackData {
  const mainNodes: TrackNode[] = [
    // 0: Start straight (North -Z)
    { x: 0, y: 0, z: 18, width: 22, label: '起跑线广场' },
    { x: 0, y: 0, z: -48, width: 22, label: '城市公开大道' },
    { x: -2, y: 0, z: -92, width: 20, label: 'M型弯入口' },
    // M-Turn (2 tight opposite kinks!)
    { x: -34, y: 0, z: -132, width: 19, bank: -0.05, label: 'M型弯第一折' },
    { x: -12, y: 0, z: -168, width: 19, bank: 0.05, label: 'M型弯第二折' },
    { x: -48, y: 1.5, z: -214, width: 20, label: '北城高速直道' },
    // Coastal Viaduct & Twin U-Turns
    { x: -108, y: 4.5, z: -242, width: 20, bank: -0.08, label: '海滨高架 U 弯' },
    { x: -154, y: 7.5, z: -198, width: 19, bank: -0.09 },
    { x: -116, y: 8.5, z: -148, width: 19, bank: 0.08, label: '观景弯道' },
    { x: -172, y: 9.0, z: -108, width: 19, bank: -0.08 },
    // First Shortcut Fork Area (U-bend loop West -> South)
    { x: -196, y: 7.0, z: -52, width: 20, label: '第一近道岔路口' }, // Fork 1 start (~idx 10)
    { x: -232, y: 4.5, z: 16, width: 20, bank: -0.09, label: '外道大回环' },
    { x: -182, y: 2.5, z: 72, width: 20, bank: -0.08 },
    { x: -136, y: 2.5, z: 36, width: 19, bank: 0.06 },
    { x: -104, y: 2.0, z: 74, width: 20, label: '三连近道前段' }, // Fork 1 merge + Fork 2 start (~idx 14)
    // Triple Shortcut S-Section!
    { x: -82, y: 2.0, z: 136, width: 19, bank: -0.08, label: '三连S弯 1' },
    { x: -40, y: 2.0, z: 112, width: 19, bank: 0.08, label: '三连S弯 2 入口' }, // idx 16
    { x: -12, y: 2.0, z: 172, width: 19, bank: -0.08 },
    { x: 32, y: 2.0, z: 138, width: 19, bank: 0.08, label: '三连S弯 3 入口' }, // idx 18
    { x: 74, y: 2.0, z: 186, width: 20, bank: -0.08 },
    { x: 118, y: 1.5, z: 138, width: 20, label: '海滨大桥入口' }, // idx 20
    // Final Harbor Bridge -> Finish Straight
    { x: 122, y: 3.5, z: 74, width: 21, jumpLip: true, label: '海滨跨海大桥' },
    { x: 72, y: 2.5, z: 66, width: 21 },
    { x: 14, y: 0.5, z: 64, width: 21, bank: -0.05, label: '最后冲刺弯' },
    { x: 0, y: 0, z: 42, width: 22 }
  ];

  const { samples, totalLength } = samplePolyline(mainNodes, true, 16);

  // Locate fork indices accurately by node index * samplesPerSegment
  const idx = (nodeIdx: number) => nodeIdx * 16;

  const shortcuts: ShortcutBranch[] = [
    // First Shortcut: cuts across the big West U-bend (node 10 -> node 14)
    buildShortcut('c11_sc1', '第一 U 弯捷径', 'stone', samples, idx(10) + 4, idx(14) - 4, [
      { x: -168, y: 8.5, z: -8, width: 11.5 },
      { x: -136, y: 6.0, z: 24, width: 11.0 },
      { x: -116, y: 3.0, z: 54, width: 11.5 }
    ]),
    // Three Consecutive Shortcuts (三连近道!)
    buildShortcut('c11_sc2', '三连近道 ①', 'stone', samples, idx(14) + 5, idx(16) - 3, [
      { x: -78, y: 2.4, z: 92, width: 10.5 },
      { x: -58, y: 2.4, z: 104, width: 10.5 }
    ]),
    buildShortcut('c11_sc3', '三连近道 ②', 'stone', samples, idx(16) + 3, idx(18) - 3, [
      { x: -18, y: 2.4, z: 126, width: 10.5 },
      { x: 8, y: 2.4, z: 134, width: 10.5 }
    ]),
    buildShortcut('c11_sc4', '三连近道 ③', 'stone', samples, idx(18) + 3, idx(20) - 4, [
      { x: 58, y: 2.4, z: 144, width: 10.5 },
      { x: 92, y: 2.2, z: 142, width: 10.5 }
    ])
  ];

  return {
    id: 'city11',
    name: '十一城 · City 11',
    cnTitle: '十一城 (经典城市公开赛)',
    stars: 4,
    laps: 2,
    theme: 'day_city',
    description: '还原开局 M 型弯道、海滨高架 U 弯、独立 U 弯捷径与标志性「三连近道」，考验双喷、断位与 CWW 节奏！',
    mainSamples: samples,
    totalLength,
    shortcuts
  };
}

/**
 * 秋名山 (Akina Mountain · 五星单圈夜赛)
 * 还原：山顶起步飞跃台 -> 右侧管道近道 -> 峡谷木桥近道 -> 灵魂「五连发夹弯」 -> 山脚冲刺
 */
function buildAkina(): TrackData {
  const mainNodes: TrackNode[] = [
    // Start summit downhill
    { x: 0, y: 48, z: 20, width: 18, label: '秋名山顶起点' },
    { x: 0, y: 46, z: -48, width: 18, jumpLip: true, label: '飞跃下坡台' },
    { x: 0, y: 41, z: -96, width: 18, label: '管道近道岔路口' }, // Pipe fork start (idx 2)
    // Main winding left around rock face
    { x: -34, y: 39, z: -136, width: 16.5, bank: -0.07 },
    { x: -24, y: 37, z: -182, width: 16.5, bank: 0.06 },
    { x: 18, y: 34, z: -222, width: 17, label: '木桥岔路口' }, // Wood bridge fork start (idx 5)
    // Canyon sweeping outer bend
    { x: 76, y: 31, z: -252, width: 16.5, bank: -0.08, label: '山谷外弯' },
    { x: 92, y: 28, z: -308, width: 16.5, bank: -0.08 },
    { x: 42, y: 24, z: -344, width: 17, label: '五连发夹弯入口' }, // Wood bridge merge (idx 8)
    // FIVE CONSECUTIVE HAIRPINS (五连发夹弯!)
    { x: -46, y: 21.5, z: -366, width: 16.5, bank: 0.09, label: '发夹弯 ①' },
    { x: -54, y: 19.5, z: -396, width: 16.5, bank: 0.08 },
    { x: 46, y: 17.0, z: -418, width: 16.5, bank: -0.09, label: '发夹弯 ②' },
    { x: 54, y: 15.0, z: -448, width: 16.5, bank: -0.08 },
    { x: -46, y: 12.5, z: -470, width: 16.5, bank: 0.09, label: '发夹弯 ③' },
    { x: -54, y: 10.5, z: -500, width: 16.5, bank: 0.08 },
    { x: 46, y: 8.2, z: -522, width: 16.5, bank: -0.09, label: '发夹弯 ④' },
    { x: 54, y: 6.4, z: -552, width: 16.5, bank: -0.08 },
    { x: -38, y: 4.2, z: -574, width: 16.5, bank: 0.09, label: '发夹弯 ⑤' },
    { x: -24, y: 2.5, z: -612, width: 17 },
    // Final Foot-of-Mountain Sprint
    { x: 0, y: 0.6, z: -668, width: 19, label: '山脚冲刺直道' },
    { x: 0, y: 0, z: -765, width: 20, label: '终点拱门' }
  ];

  const { samples, totalLength } = samplePolyline(mainNodes, false, 16);
  const idx = (nodeIdx: number) => nodeIdx * 16;

  const shortcuts: ShortcutBranch[] = [
    // Pipe Shortcut on the right (node 2 -> node 5)
    buildShortcut('ak_pipe', '右侧管道近道', 'pipe', samples, idx(2) + 2, idx(5) - 2, [
      { x: 22, y: 39.5, z: -130, width: 10.0 },
      { x: 28, y: 37.2, z: -172, width: 10.0 },
      { x: 22, y: 34.8, z: -206, width: 10.5 }
    ]),
    // Wooden Bridge Shortcut across canyon (node 5 -> node 8)
    buildShortcut('ak_wood', '峡谷木桥近道', 'wood', samples, idx(5) + 3, idx(8) - 2, [
      { x: 34, y: 31.2, z: -258, width: 9.2 },
      { x: 40, y: 27.6, z: -302, width: 9.2 }
    ])
  ];

  return {
    id: 'akina',
    name: '秋名山 · Akina Mountain',
    cnTitle: '秋名山 (五星山路巅峰)',
    stars: 5,
    laps: 1,
    theme: 'night_mountain',
    description: '还原山顶飞跃跳台、右侧管道近道、狭窄峡谷木桥近道与传奇「五连发夹弯」夜赛极限过弯！',
    mainSamples: samples,
    totalLength,
    shortcuts
  };
}

export const TRACKS: Record<TrackId, TrackData> = {
  city11: buildCity11(),
  akina: buildAkina()
};
