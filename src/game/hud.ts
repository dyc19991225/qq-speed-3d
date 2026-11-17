import type { ComboCallout, KartController } from './kartPhysics';
import { KART_SPECS } from './karts';
import { TRACKS } from './tracks';
import type { ControlScheme, KartId, RacerTelemetry, TrackData, TrackId } from './types';

export interface HudSelection {
  trackId: TrackId;
  kartId: KartId;
  scheme: ControlScheme;
  volume: number;
  touchMode: 'auto' | 'on' | 'off';
  autoThrottleOnTouch: boolean;
}

export interface KeyVisualState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  drift: boolean;
  mini: boolean;
  nitro: boolean;
}

export class RacingHud {
  public readonly root: HTMLDivElement;

  private minimapCanvas: HTMLCanvasElement;
  private minimapCtx: CanvasRenderingContext2D;
  private speedLinesEl: HTMLElement;

  private rankEl: HTMLElement;
  private lapEl: HTMLElement;
  private clockEl: HTMLElement;
  private sectionEl: HTMLElement;

  private speedNumEl: HTMLElement;
  private speedModeEl: HTMLElement;
  private gaugeArcEl: SVGPathElement;
  private chargeFillEl: HTMLElement;
  private bottleEls: [HTMLElement, HTMLElement];
  private miniPromptEl: HTMLElement;

  private calloutEl: HTMLElement;
  private countdownEl: HTMLElement;
  private keyVisualizerEl: HTMLElement;

  private lobbyOverlay: HTMLElement;
  private finishOverlay: HTMLElement;
  private finishBoardEl: HTMLElement;
  private touchOverlay: HTMLElement;
  private touchThrottleBtn: HTMLButtonElement;

  // Touch input states
  public touchLeft = false;
  public touchRight = false;
  public touchBrake = false;
  public touchDrift = false;
  public touchDriftJustPressed = false;
  public touchMiniJustPressed = false;
  public touchNitroJustPressed = false;
  public touchEnabled = false;

  public onStartRace: ((sel: HudSelection) => void) | null = null;
  public onRestartRace: (() => void) | null = null;
  public onToggleTouch: (() => void) | null = null;
  public onOpenMenu: (() => void) | null = null;
  public onSchemeChanged: ((scheme: ControlScheme) => void) | null = null;
  public onVolumeChanged: ((v: number) => void) | null = null;
  public onCameraToggle: (() => void) | null = null;
  public onResetKart: (() => void) | null = null;

  private selection: HudSelection = {
    trackId: 'city11',
    kartId: 'renault',
    scheme: 'classic',
    volume: 0.7,
    touchMode: 'auto',
    autoThrottleOnTouch: true
  };

  private activeCallout: ComboCallout | null = null;
  private bounds = { minX: -250, maxX: 160, minZ: -260, maxZ: 210 };

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'qq-hud';

    this.root.innerHTML = `
      <div id="speed-lines" class="speed-lines"></div>

      <!-- Top-Left Minimap -->
      <div class="hud-map-panel">
        <canvas id="qq-minimap" width="164" height="164"></canvas>
        <div id="qq-section" class="hud-section-badge">起跑线广场</div>
      </div>

      <!-- Top-Right Race Telemetry -->
      <div class="hud-race-panel">
        <div class="race-stat"><small>名次</small><b id="qq-rank">1 / 4</b></div>
        <div class="race-stat"><small>圈数</small><b id="qq-lap">1 / 2</b></div>
        <div class="race-stat"><small>用时</small><b id="qq-clock">00:00.00</b></div>
        <div class="race-actions">
          <button id="btn-cam" class="mini-chip" type="button">视角 V</button>
          <button id="btn-touch-chip" class="mini-chip" type="button">触屏: 自动</button>
          <button id="btn-menu" class="mini-chip" type="button">车库/赛道</button>
        </div>
      </div>

      <!-- Live Key Visualizer (Shows exact CWW/WCW/段位 finger timing!) -->
      <div id="qq-keyvis" class="hud-keyvis">
        <span data-k="left">◀</span>
        <span data-k="up">▲</span>
        <span data-k="down">▼</span>
        <span data-k="right">▶</span>
        <span data-k="drift" class="wide">Shift 漂移</span>
        <span data-k="mini" class="wide">Ctrl/Space 小喷</span>
        <span data-k="nitro" class="wide">Alt/C 氮气</span>
      </div>

      <!-- Countdown & Combo Callout -->
      <div id="qq-countdown" class="hud-countdown hidden">3</div>
      <div id="qq-callout" class="hud-callout hidden"></div>

      <!-- Bottom-Center Classic QQ Speed Dashboard -->
      <div class="hud-dashboard">
        <div id="qq-mini-prompt" class="mini-prompt">小喷待命</div>

        <div class="dash-gauge-wrap">
          <svg class="dash-svg" viewBox="0 0 220 125">
            <path d="M 24 108 A 88 88 0 1 1 196 108" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="12" stroke-linecap="round"/>
            <path id="qq-gauge-arc" d="M 24 108 A 88 88 0 1 1 196 108" fill="none" stroke="#38d9ff" stroke-width="12" stroke-linecap="round" stroke-dasharray="395" stroke-dashoffset="395"/>
          </svg>
          <div class="dash-speed-center">
            <div id="qq-speed-num" class="speed-num">0</div>
            <div class="speed-unit">km/h</div>
            <div id="qq-speed-mode" class="speed-mode">NORMAL</div>
          </div>
        </div>

        <div class="dash-nitro-row">
          <div class="nitro-bar-track"><div id="qq-charge-fill" class="nitro-bar-fill"></div></div>
          <div class="nitro-bottles">
            <div id="qq-bottle-1" class="n2o-bottle">N₂O</div>
            <div id="qq-bottle-2" class="n2o-bottle">N₂O</div>
          </div>
        </div>
      </div>

      <!-- Touch Controls -->
      <div id="qq-touch-overlay" class="qq-touch-overlay hidden">
        <div class="touch-left-pad">
          <button id="t-left" class="t-steer-btn" type="button">◀</button>
          <button id="t-right" class="t-steer-btn" type="button">▶</button>
        </div>
        <div class="touch-right-pad">
          <button id="t-auto-gas" class="t-small-btn active" type="button">自动油门: 开</button>
          <button id="t-reset" class="t-small-btn" type="button">复位</button>
          <button id="t-brake" class="t-small-btn" type="button">刹车</button>
          <button id="t-drift" class="t-act-btn drift" type="button">漂移</button>
          <button id="t-mini" class="t-act-btn mini" type="button">小喷</button>
          <button id="t-nitro" class="t-act-btn nitro" type="button">氮气</button>
        </div>
      </div>

      <!-- Garage / Track Selection Lobby -->
      <div id="qq-lobby" class="qq-lobby">
        <div class="lobby-card">
          <div class="lobby-tag">QQ SPEED 3D · 极速引擎复刻</div>
          <h1>QQ 飞车 3D · 经典竞速</h1>
          <p class="lobby-desc">真实漂移集气物理：支持<b>超级起步</b>、<b>单/双喷</b>、<b>段位双喷</b>、<b>空喷/落地喷</b>、<b>CWW喷 &amp; WCW喷</b> 极速叠加与<b>赛道近道抄近路</b>。</p>

          <div class="lobby-section">
            <div class="lobby-label">1. 选择经典赛道</div>
            <div id="track-cards" class="card-grid"></div>
          </div>

          <div class="lobby-section">
            <div class="lobby-label">2. 选择座驾</div>
            <div id="kart-cards" class="card-grid"></div>
          </div>

          <div class="lobby-options-row">
            <label>键位提示风格
              <select id="sel-scheme">
                <option value="classic">经典端游 (↑↓←→ + Shift漂移 + Ctrl/Space小喷 + Alt/C氮气)</option>
                <option value="wasd">左手通用 (WASD + Shift漂移 + Space小喷 + E/C氮气)</option>
              </select>
            </label>
            <label>触屏按键
              <select id="sel-touch">
                <option value="auto">自动检测</option>
                <option value="on">强制开启 (手机/平板)</option>
                <option value="off">关闭</option>
              </select>
            </label>
            <label><span class="lbl-inline">音效声浪 <b id="lbl-vol">70%</b></span>
              <input id="sel-vol" type="range" min="0" max="1" step="0.05" value="0.7" />
            </label>
          </div>

          <div class="combo-cheatsheet">
            <div><b>超级起步：</b>GO 瞬间按住前进</div>
            <div><b>双喷：</b>漂移拉正松 Shift ➔ 小喷1 ➔ 约0.3s 小喷2</div>
            <div><b>段位双喷：</b>漂移中松 Shift 反方向点 Shift 拉车头 ➔ 双喷</div>
            <div><b>CWW 喷 (312+ km/h)：</b>带氮气出弯 ➔ 氮气 + 小喷1 ➔ 间隔0.4s 小喷2</div>
            <div><b>WCW 喷：</b>无氮气集满出弯 ➔ 小喷1 ➔ 氮气 + 小喷2</div>
          </div>

          <div class="lobby-footer">
            <button id="btn-start-race" class="btn-go" type="button">立即发车 · START RACE</button>
          </div>
        </div>
      </div>

      <!-- Race Finish Modal -->
      <div id="qq-finish" class="qq-lobby hidden">
        <div class="lobby-card finish-card">
          <div class="lobby-tag">RACE FINISHED · 冲线结算</div>
          <h1 id="finish-headline">恭喜完赛！</h1>
          <table class="finish-table">
            <thead><tr><th>名次</th><th>车手</th><th>座驾</th><th>成绩</th></tr></thead>
            <tbody id="finish-tbody"></tbody>
          </table>
          <div class="lobby-footer">
            <button id="btn-again" class="btn-go" type="button">再来一局</button>
            <button id="btn-back-lobby" class="btn-ghost" type="button">更换赛道 / 赛车</button>
          </div>
        </div>
      </div>
    `;

    parent.appendChild(this.root);

    this.minimapCanvas = this.root.querySelector('#qq-minimap')!;
    this.minimapCtx = this.minimapCanvas.getContext('2d')!;
    this.speedLinesEl = this.root.querySelector('#speed-lines')!;

    this.rankEl = this.root.querySelector('#qq-rank')!;
    this.lapEl = this.root.querySelector('#qq-lap')!;
    this.clockEl = this.root.querySelector('#qq-clock')!;
    this.sectionEl = this.root.querySelector('#qq-section')!;

    this.speedNumEl = this.root.querySelector('#qq-speed-num')!;
    this.speedModeEl = this.root.querySelector('#qq-speed-mode')!;
    this.gaugeArcEl = this.root.querySelector('#qq-gauge-arc')!;
    this.chargeFillEl = this.root.querySelector('#qq-charge-fill')!;
    this.bottleEls = [
      this.root.querySelector('#qq-bottle-1')!,
      this.root.querySelector('#qq-bottle-2')!
    ];
    this.miniPromptEl = this.root.querySelector('#qq-mini-prompt')!;
    this.calloutEl = this.root.querySelector('#qq-callout')!;
    this.countdownEl = this.root.querySelector('#qq-countdown')!;
    this.keyVisualizerEl = this.root.querySelector('#qq-keyvis')!;

    this.lobbyOverlay = this.root.querySelector('#qq-lobby')!;
    this.finishOverlay = this.root.querySelector('#qq-finish')!;
    this.finishBoardEl = this.root.querySelector('#finish-tbody')!;
    this.touchOverlay = this.root.querySelector('#qq-touch-overlay')!;
    this.touchThrottleBtn = this.root.querySelector('#t-auto-gas')!;

    this.populateCards();
    this.bindLobbyEvents();
    this.bindTouchEvents();
    this.computeMinimapBounds(TRACKS[this.selection.trackId]);
  }

  private populateCards(): void {
    const tWrap = this.root.querySelector('#track-cards')!;
    for (const id of Object.keys(TRACKS) as TrackId[]) {
      const tr = TRACKS[id];
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `sel-card ${id === this.selection.trackId ? 'selected' : ''}`;
      el.dataset.track = id;
      el.innerHTML = `
        <div class="sel-head"><b>${tr.name}</b><span>${'★'.repeat(tr.stars)} · ${tr.laps}圈</span></div>
        <div class="sel-desc">${tr.description}</div>
      `;
      el.addEventListener('click', () => {
        this.selection.trackId = id;
        tWrap.querySelectorAll('.sel-card').forEach((c) => c.classList.remove('selected'));
        el.classList.add('selected');
      });
      tWrap.appendChild(el);
    }

    const kWrap = this.root.querySelector('#kart-cards')!;
    for (const id of Object.keys(KART_SPECS) as KartId[]) {
      const k = KART_SPECS[id];
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `sel-card ${id === this.selection.kartId ? 'selected' : ''}`;
      el.dataset.kart = id;
      el.innerHTML = `
        <div class="sel-head"><b>${k.name}</b><span>${k.tier}</span></div>
        <div class="sel-desc">${k.desc} · CWW极速 ${k.cwwMaxSpeed} km/h</div>
      `;
      el.addEventListener('click', () => {
        this.selection.kartId = id;
        kWrap.querySelectorAll('.sel-card').forEach((c) => c.classList.remove('selected'));
        el.classList.add('selected');
      });
      kWrap.appendChild(el);
    }
  }

  private bindLobbyEvents(): void {
    const schemeSel = this.root.querySelector<HTMLSelectElement>('#sel-scheme')!;
    const touchSel = this.root.querySelector<HTMLSelectElement>('#sel-touch')!;
    const volRange = this.root.querySelector<HTMLInputElement>('#sel-vol')!;
    const volLabel = this.root.querySelector('#lbl-vol')!;

    schemeSel.addEventListener('change', () => {
      this.selection.scheme = schemeSel.value as ControlScheme;
      this.onSchemeChanged?.(this.selection.scheme);
      this.updateKeyVisualizerLabels();
    });

    touchSel.addEventListener('change', () => {
      this.selection.touchMode = touchSel.value as HudSelection['touchMode'];
      this.applyTouchFlag();
    });

    volRange.addEventListener('input', () => {
      this.selection.volume = Number(volRange.value);
      volLabel.textContent = `${Math.round(this.selection.volume * 100)}%`;
      this.onVolumeChanged?.(this.selection.volume);
    });

    this.root.querySelector('#btn-start-race')!.addEventListener('click', () => {
      this.lobbyOverlay.classList.add('hidden');
      this.finishOverlay.classList.add('hidden');
      this.onStartRace?.({ ...this.selection });
    });

    this.root.querySelector('#btn-again')!.addEventListener('click', () => {
      this.finishOverlay.classList.add('hidden');
      this.onRestartRace?.();
    });

    this.root.querySelector('#btn-back-lobby')!.addEventListener('click', () => {
      this.finishOverlay.classList.add('hidden');
      this.lobbyOverlay.classList.remove('hidden');
      this.onOpenMenu?.();
    });

    this.root.querySelector('#btn-menu')!.addEventListener('click', () => {
      this.lobbyOverlay.classList.remove('hidden');
      this.onOpenMenu?.();
    });

    this.root.querySelector('#btn-cam')!.addEventListener('click', () => {
      this.onCameraToggle?.();
    });

    this.root.querySelector('#btn-touch-chip')!.addEventListener('click', () => {
      const order: HudSelection['touchMode'][] = ['auto', 'on', 'off'];
      this.selection.touchMode = order[(order.indexOf(this.selection.touchMode) + 1) % order.length];
      touchSel.value = this.selection.touchMode;
      this.applyTouchFlag();
      this.onToggleTouch?.();
    });

    this.updateKeyVisualizerLabels();
  }

  private updateKeyVisualizerLabels(): void {
    const isClassic = this.selection.scheme === 'classic';
    const setK = (k: string, txt: string) => {
      const el = this.keyVisualizerEl.querySelector(`[data-k="${k}"]`);
      if (el) el.textContent = txt;
    };
    setK('up', isClassic ? '↑' : 'W');
    setK('down', isClassic ? '↓' : 'S');
    setK('left', isClassic ? '←' : 'A');
    setK('right', isClassic ? '→' : 'D');
    setK('mini', isClassic ? 'Ctrl/Space 小喷' : 'Space/Ctrl 小喷');
    setK('nitro', isClassic ? 'Alt/C 氮气' : 'E/C 氮气');
  }

  private bindTouchEvents(): void {
    const bindHold = (id: string, onDown: () => void, onUp: () => void) => {
      const el = this.root.querySelector(id)!;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.classList.add('pressed');
        onDown();
      });
      const up = () => {
        el.classList.remove('pressed');
        onUp();
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
    };

    bindHold('#t-left', () => (this.touchLeft = true), () => (this.touchLeft = false));
    bindHold('#t-right', () => (this.touchRight = true), () => (this.touchRight = false));
    bindHold('#t-brake', () => (this.touchBrake = true), () => (this.touchBrake = false));
    bindHold(
      '#t-drift',
      () => {
        this.touchDrift = true;
        this.touchDriftJustPressed = true;
      },
      () => (this.touchDrift = false)
    );

    this.root.querySelector('#t-mini')!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.touchMiniJustPressed = true;
    });
    this.root.querySelector('#t-nitro')!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.touchNitroJustPressed = true;
    });
    this.root.querySelector('#t-reset')!.addEventListener('click', () => {
      this.onResetKart?.();
    });
    this.touchThrottleBtn.addEventListener('click', () => {
      this.selection.autoThrottleOnTouch = !this.selection.autoThrottleOnTouch;
      this.touchThrottleBtn.textContent = `自动油门: ${this.selection.autoThrottleOnTouch ? '开' : '关'}`;
      this.touchThrottleBtn.classList.toggle('active', this.selection.autoThrottleOnTouch);
    });
  }

  public applyTouchFlag(): void {
    const hasTouch =
      navigator.maxTouchPoints > 0 ||
      'ontouchstart' in window ||
      window.matchMedia('(pointer: coarse)').matches;
    this.touchEnabled =
      this.selection.touchMode === 'on' || (this.selection.touchMode === 'auto' && hasTouch);
    this.touchOverlay.classList.toggle('hidden', !this.touchEnabled);
    this.root.classList.toggle('touch-active', this.touchEnabled);

    const chip = this.root.querySelector('#btn-touch-chip')!;
    chip.textContent =
      this.selection.touchMode === 'auto'
        ? this.touchEnabled
          ? '触屏: 自动(开)'
          : '触屏: 自动(关)'
        : this.selection.touchMode === 'on'
          ? '触屏: 开启'
          : '触屏: 关闭';
  }

  public getSelection(): HudSelection {
    return { ...this.selection };
  }

  public showCountdown(label: string | null): void {
    this.countdownEl.classList.toggle('hidden', label === null);
    if (label !== null) {
      this.countdownEl.textContent = label;
    }
  }

  public showComboCallout(c: ComboCallout): void {
    this.activeCallout = c;
    this.calloutEl.textContent = c.text;
    this.calloutEl.className = `hud-callout tier-${c.tier}`;
  }

  public showFinishScreen(rows: RacerTelemetry[]): void {
    const sorted = [...rows].sort((a, b) => a.rank - b.rank);
    const playerRow = sorted.find((r) => r.isPlayer);
    this.root.querySelector('#finish-headline')!.textContent =
      playerRow && playerRow.rank === 1 ? '🏆 第 1 名冲线！秋名/十一城车神！' : `🏁 第 ${playerRow?.rank ?? 1} 名完赛！`;

    this.finishBoardEl.innerHTML = sorted
      .map(
        (r) => `
      <tr class="${r.isPlayer ? 'me-row' : ''}">
        <td>#${r.rank}</td>
        <td>${r.name}${r.isPlayer ? ' (你)' : ''}</td>
        <td>${KART_SPECS[r.kartId].name}</td>
        <td>${r.finished ? formatClock(r.finishTime) : '行驶中'}</td>
      </tr>`
      )
      .join('');
    this.finishOverlay.classList.remove('hidden');
  }

  public computeMinimapBounds(track: TrackData): void {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const s of track.mainSamples) {
      if (s.pos.x < minX) minX = s.pos.x;
      if (s.pos.x > maxX) maxX = s.pos.x;
      if (s.pos.z < minZ) minZ = s.pos.z;
      if (s.pos.z > maxZ) maxZ = s.pos.z;
    }
    const pad = 28;
    this.bounds = { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
  }

  public update(
    track: TrackData,
    kart: KartController,
    racers: RacerTelemetry[],
    raceClock: number,
    keyState: KeyVisualState
  ): void {
    const playerRank = racers.find((r) => r.isPlayer)?.rank ?? 1;
    this.rankEl.textContent = `${playerRank} / ${racers.length}`;
    this.lapEl.textContent = `${Math.min(track.laps, kart.lap)} / ${track.laps}`;
    this.clockEl.textContent = formatClock(raceClock);
    this.sectionEl.textContent = kart.currentSectionLabel || track.name;

    // Speedometer & Boost Color
    const kmh = Math.max(0, Math.round(kart.speedKmh));
    this.speedNumEl.textContent = String(kmh);
    const arcFill = Math.min(1, kmh / 320);
    this.gaugeArcEl.style.strokeDashoffset = String(395 - 395 * arcFill);

    const isCww = kart.comboStage === 'cww' || kart.comboStage === 'wcw';
    const isNitro = kart.activeNitroTimer > 0;
    const isMini = kart.activeMiniTimer > 0;

    if (isCww) {
      this.gaugeArcEl.style.stroke = '#d46bff';
      this.speedModeEl.textContent = kart.comboStage.toUpperCase() + ' MAX';
      this.speedModeEl.style.color = '#e69aff';
      this.speedLinesEl.style.opacity = String(Math.min(0.85, (kmh - 230) / 85));
    } else if (isNitro) {
      this.gaugeArcEl.style.stroke = '#38d9ff';
      this.speedModeEl.textContent = 'N2O BOOST';
      this.speedModeEl.style.color = '#5ee3ff';
      this.speedLinesEl.style.opacity = String(Math.min(0.55, Math.max(0, (kmh - 220) / 100)));
    } else if (isMini) {
      this.gaugeArcEl.style.stroke = '#ffb72b';
      this.speedModeEl.textContent = 'JET BOOST';
      this.speedModeEl.style.color = '#ffd25c';
      this.speedLinesEl.style.opacity = '0.2';
    } else {
      this.gaugeArcEl.style.stroke = kart.isDrifting ? '#ff6644' : '#4ce898';
      this.speedModeEl.textContent = kart.isDrifting ? 'DRIFTING' : 'DRIVE';
      this.speedModeEl.style.color = kart.isDrifting ? '#ff9466' : '#94b2d0';
      this.speedLinesEl.style.opacity = '0';
    }

    // Nitro Charge & Bottles
    this.chargeFillEl.style.width = `${Math.round(kart.nitroCharge)}%`;
    this.bottleEls[0].classList.toggle('ready', kart.nitroBottles >= 1);
    this.bottleEls[1].classList.toggle('ready', kart.nitroBottles >= 2);

    // Mini-Boost Readiness Prompt
    const miniReady = kart.miniBoostsLeft > 0 && kart.miniDelayTimer <= 0;
    this.miniPromptEl.classList.toggle('ready', miniReady);
    if (miniReady) {
      this.miniPromptEl.textContent =
        kart.miniBoostsLeft === 2 ? '⚡ 小喷 ×2 就绪！' : '⚡ 二段小喷就绪！';
    } else if (kart.miniBoostsLeft > 0 && kart.miniDelayTimer > 0) {
      this.miniPromptEl.textContent = '衔接等待...';
    } else {
      this.miniPromptEl.textContent = '漂移集气 · 小喷待命';
    }

    // Callout expiry
    if (this.activeCallout && performance.now() > this.activeCallout.expiresAt) {
      this.activeCallout = null;
      this.calloutEl.classList.add('hidden');
    }

    // Key visualizer lights
    const mark = (k: keyof KeyVisualState, active: boolean) => {
      const el = this.keyVisualizerEl.querySelector(`[data-k="${k}"]`);
      if (el) el.classList.toggle('on', active);
    };
    mark('up', keyState.up);
    mark('down', keyState.down);
    mark('left', keyState.left);
    mark('right', keyState.right);
    mark('drift', keyState.drift);
    mark('mini', keyState.mini);
    mark('nitro', keyState.nitro);

    this.drawMinimap(track, racers);
  }

  private drawMinimap(track: TrackData, racers: RacerTelemetry[]): void {
    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const spanX = Math.max(10, this.bounds.maxX - this.bounds.minX);
    const spanZ = Math.max(10, this.bounds.maxZ - this.bounds.minZ);
    const scale = Math.min((w - 16) / spanX, (h - 16) / spanZ);
    const ox = (w - spanX * scale) * 0.5;
    const oy = (h - spanZ * scale) * 0.5;
    const tx = (wx: number) => ox + (wx - this.bounds.minX) * scale;
    const ty = (wz: number) => oy + (wz - this.bounds.minZ) * scale;

    // Main loop
    ctx.strokeStyle = 'rgba(200, 220, 240, 0.72)';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    track.mainSamples.forEach((s, idx) => {
      if (idx === 0) ctx.moveTo(tx(s.pos.x), ty(s.pos.z));
      else ctx.lineTo(tx(s.pos.x), ty(s.pos.z));
    });
    if (track.laps > 1) ctx.closePath();
    ctx.stroke();

    // Shortcuts in cyan!
    ctx.strokeStyle = '#38e8ff';
    ctx.lineWidth = 2.6;
    for (const sc of track.shortcuts) {
      ctx.beginPath();
      sc.samples.forEach((s, idx) => {
        if (idx === 0) ctx.moveTo(tx(s.pos.x), ty(s.pos.z));
        else ctx.lineTo(tx(s.pos.x), ty(s.pos.z));
      });
      ctx.stroke();
    }

    // Start line marker
    const s0 = track.mainSamples[0];
    ctx.fillStyle = '#ffd24c';
    ctx.fillRect(tx(s0.pos.x) - 3, ty(s0.pos.z) - 3, 6, 6);

    // Racers
    for (const r of racers) {
      const rx = tx(r.x);
      const ry = ty(r.z);
      if (r.isPlayer) {
        ctx.save();
        ctx.translate(rx, ry);
        ctx.rotate(-r.yaw);
        ctx.fillStyle = '#4bff6b';
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(4.5, 5);
        ctx.lineTo(-4.5, 5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = '#ff7b47';
        ctx.beginPath();
        ctx.arc(rx, ry, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
