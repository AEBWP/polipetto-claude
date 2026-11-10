(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');

  const FPS = 12;
  const GW = 15; // sprite size in grid cells
  const GH = 9;
  const SLOT_W = GW + 5; // includes room for props
  const SLOT_H = GH + 9;
  const SCALES = [5, 4, 3, 2];
  const CELEBRATE_S = 2.6;
  const SLEEP_AFTER_S = 70;
  const SLEEP_FOR_S = 30;

  const C = {
    body: '#D97757',
    eye: '#231A16',
    shadow: 'rgba(127,127,127,0.25)',
    metal: '#4B5563',
    metalLight: '#9CA3AF',
    page: '#F5F1E8',
    ink: '#A8A29E',
    spine: '#8B5E3C',
    bubble: '#FFFFFF',
    outline: '#8B949E',
    check: '#3FB950',
  };
  const CONFETTI = ['#D97757', '#F2C14E', '#3FB950', '#58A6FF', '#E06C9F'];

  const GLYPHS = {
    bulb: { color: '#E3A008', rows: ['.###.', '#####', '.###.', '..#..', '.###.'] },
    terminal: { color: '#238636', rows: ['#......', '.#.....', '..#....', '.#.....', '#...###'] },
    pencil: { color: '#B35900', rows: ['.....##', '....###', '...##..', '..##...', '###....'] },
    page: { color: '#57606A', rows: ['#####', '.....', '#####', '.....', '###..'] },
    magnifier: { color: '#2F81F7', rows: ['.###...', '#...#..', '#...#..', '.###.#.', '......#'] },
    globe: { color: '#0969DA', rows: ['.###.', '#.#.#', '#####', '#.#.#', '.###.'] },
    octopus: { color: '#D97757', rows: ['.#####.', '##.#.##', '#######', '.#.#.#.', '.#.#.#.'] },
    question: { color: '#8250DF', rows: ['.###.', '#...#', '..##.', '.....', '..#..'] },
    checklist: { color: '#8250DF', rows: ['#.###', '.....', '#.###', '.....', '#.###'] },
    gear: { color: '#57606A', rows: ['#.#.#', '.###.', '##.##', '.###.', '#.#.#'] },
    cross: { color: '#CF222E', rows: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'] },
  };
  const BUBBLE_FOR = {
    run: 'terminal',
    write: 'pencil',
    read: 'page',
    search: 'magnifier',
    web: 'globe',
    delegate: 'octopus',
    ask: 'question',
    plan: 'checklist',
    tool: 'gear',
    error: 'cross',
  };
  const LAPTOP = new Set(['run', 'write', 'web', 'tool']);
  const BOOK = new Set(['read', 'search']);

  let W = 0;
  let H = 0;
  let scale = 4;
  let time = 0;
  let last = performance.now();
  let seq = 0;
  let actors = [];
  let particles = [];
  let latestAgents = [];
  let overflow = 0;

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function pick(weighted) {
    let n = Math.random() * weighted.reduce((sum, w) => sum + w[1], 0);
    for (const [value, weight] of weighted) {
      n -= weight;
      if (n <= 0) return value;
    }
    return weighted[0][0];
  }

  function layoutFor(n) {
    for (const s of SCALES) {
      const cols = Math.floor(W / (SLOT_W * s));
      const rows = Math.floor(H / (SLOT_H * s));
      if (cols >= 1 && rows >= 1 && cols * rows >= n) return { s, cols, rows };
    }
    const s = SCALES[SCALES.length - 1];
    return { s, cols: Math.max(1, Math.floor(W / (SLOT_W * s))), rows: Math.max(1, Math.floor(H / (SLOT_H * s))) };
  }

  function capacity() {
    const l = layoutFor(Infinity);
    return l.cols * l.rows;
  }

  function groundY(s) {
    return H - 4 - (GH + 1) * s;
  }

  function maxX() {
    return Math.max(0, W - GW * scale);
  }

  function relayout() {
    const n = Math.max(actors.length, 1);
    const { s, cols } = layoutFor(n);
    scale = s;
    const slotW = SLOT_W * s;
    const slotH = SLOT_H * s;

    if (actors.length === 1 && actors[0].mode === 'idle') {
      const a = actors[0];
      a.tx = Math.min(a.tx, maxX());
      a.ty = groundY(s);
      return;
    }
    actors.forEach((a, i) => {
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, actors.length - row * cols);
      const col = i - row * cols;
      const startX = (W - inRow * slotW) / 2;
      a.tx = Math.round(startX + col * slotW + (slotW - GW * s) / 2);
      a.ty = groundY(s) - row * slotH;
    });
  }

  function setMode(a, mode, activity) {
    a.mode = mode;
    a.modeStart = time;
    if (activity) a.activity = activity;
    if (mode === 'idle') {
      a.idleSince = time;
      startBehavior(a, 'rest', rand(1, 3));
    }
  }

  function startBehavior(a, behavior, duration) {
    a.behavior = behavior;
    a.behaviorStart = time;
    a.behaviorUntil = time + duration;
    a.look = behavior === 'look' ? (Math.random() < 0.5 ? -1 : 1) : 0;
  }

  function createActor(x, y) {
    const a = {
      seq: seq++,
      agentId: null,
      x,
      y,
      tx: x,
      ty: y,
      mode: 'idle',
      activity: 'think',
      modeStart: time,
      idleSince: time,
      behavior: 'rest',
      behaviorStart: time,
      behaviorUntil: time + 2,
      look: 0,
      moving: false,
      lastConfetti: 0,
      pokedAt: -Infinity,
      step: 0,
      bubbleSide: 1,
      thinkVariant: 0,
      bubbleAt: -Infinity,
    };
    actors.push(a);
    return a;
  }

  function puff(a) {
    const cx = a.x + (GW * scale) / 2;
    const cy = a.y + (GH * scale) / 2;
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2;
      const speed = rand(30, 70) * (scale / 3);
      particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: 0,
        life: rand(0.25, 0.5),
        color: C.outline,
        size: Math.max(2, scale),
      });
    }
  }

  function confetti(a) {
    const cx = a.x + (GW * scale) / 2;
    for (let i = 0; i < 8; i++) {
      particles.push({
        x: cx + rand(-GW, GW) * (scale / 2),
        y: a.y,
        vx: rand(-60, 60) * (scale / 3),
        vy: rand(-170, -80) * (scale / 3),
        gravity: 340 * (scale / 3),
        life: rand(0.7, 1.3),
        color: CONFETTI[Math.floor(Math.random() * CONFETTI.length)],
        size: Math.max(2, scale - 1),
      });
    }
  }

  function bits(a) {
    particles.push({
      x: a.x + rand(4, 11) * scale,
      y: a.y + 3 * scale,
      vx: rand(-12, 12),
      vy: rand(-45, -25) * (scale / 3),
      gravity: 0,
      life: rand(0.4, 0.8),
      color: Math.random() < 0.5 ? '#58A6FF' : C.check,
      size: Math.max(1, scale - 2),
    });
  }

  function removeActor(a) {
    puff(a);
    actors = actors.filter((x) => x !== a);
    assignAgents();
    relayout();
  }

  /** A finished actor stays only if it would otherwise leave the scene empty. */
  function retire(a) {
    if (actors.some((x) => x !== a)) removeActor(a);
    else {
      setMode(a, 'idle');
      relayout();
    }
  }

  function assignAgents() {
    const assigned = new Set(actors.map((a) => a.agentId).filter(Boolean));
    const room = capacity();
    overflow = 0;
    for (const agent of latestAgents) {
      if (assigned.has(agent.id)) continue;
      let actor = actors.find((a) => !a.agentId && a.mode === 'idle');
      if (!actor) {
        if (actors.length >= room) {
          overflow++;
          continue;
        }
        const origin = actors.find((a) => a.agentId === agent.parentId) || actors[actors.length - 1];
        actor = origin ? createActor(origin.x, origin.y) : createActor(maxX(), groundY(scale));
        puff(actor);
      }
      actor.agentId = agent.id;
      actor.step = agent.step;
      setMode(actor, 'work', agent.activity);
    }
  }

  function nextBubble(a) {
    a.thinkVariant = 1 - a.thinkVariant;
    a.bubbleSide = -a.bubbleSide;
    a.bubbleAt = time;
  }

  function reconcile(agents, completed) {
    latestAgents = agents;
    const byId = new Map(agents.map((a) => [a.id, a]));

    for (const a of actors.slice()) {
      if (!a.agentId) continue;
      const agent = byId.get(a.agentId);
      if (agent) {
        a.activity = agent.activity;
        if (agent.step !== a.step) {
          a.step = agent.step;
          nextBubble(a);
        }
        continue;
      }
      const id = a.agentId;
      a.agentId = null;
      if (completed.includes(id)) setMode(a, 'celebrate');
      else retire(a);
    }

    assignAgents();
    if (actors.length === 0) createActor(maxX(), groundY(scale));
    relayout();
  }

  function updateIdle(a) {
    if (a.behavior === 'sleep') {
      if (time >= a.behaviorUntil) {
        a.idleSince = time;
        startBehavior(a, 'stretch', 1.5);
      }
      return;
    }
    if (time - a.idleSince > SLEEP_AFTER_S) {
      a.tx = a.x;
      startBehavior(a, 'sleep', SLEEP_FOR_S);
      return;
    }
    if (a.behavior === 'walk' && !a.moving && time - a.behaviorStart > 0.3) a.behaviorUntil = time;
    if (time < a.behaviorUntil) return;

    const next = pick([['rest', 4], ['look', 3], ['walk', 3], ['wave', 1], ['hop', 1], ['stretch', 1]]);
    if (next === 'walk') {
      a.tx = Math.round(rand(0, maxX()));
      startBehavior(a, 'walk', 12);
    } else {
      startBehavior(a, next, next === 'rest' ? rand(2, 6) : rand(1.2, 2.6));
    }
  }

  function update(dt) {
    time += dt;

    for (const a of actors.slice()) {
      if (a.mode === 'idle') updateIdle(a);
      if (a.mode === 'celebrate') {
        if (time - a.lastConfetti > 0.35) {
          a.lastConfetti = time;
          confetti(a);
        }
        if (time - a.modeStart >= CELEBRATE_S) retire(a);
      }
      if (a.mode === 'work' && LAPTOP.has(a.activity) && Math.random() < 0.3) bits(a);

      const speed = (a.mode === 'idle' ? 7 : 26) * scale * dt;
      const dx = a.tx - a.x;
      const dy = a.ty - a.y;
      const dist = Math.hypot(dx, dy);
      a.moving = dist > 0.5;
      if (dist <= speed) {
        a.x = a.tx;
        a.y = a.ty;
      } else {
        a.x += (dx / dist) * speed;
        a.y += (dy / dist) * speed;
      }
    }

    particles = particles.filter((p) => {
      p.life -= dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      return p.life > 0;
    });
  }

  function pose(a) {
    const p = basePose(a);
    const sincePoke = time - a.pokedAt;
    if (sincePoke < 0.4) p.lift += Math.round(Math.sin((sincePoke / 0.4) * Math.PI) * 4);
    return p;
  }

  function basePose(a) {
    const t = time - a.modeStart;
    const blink = (time + a.seq * 1.7) % 3.7 < 0.14;
    const p = { squash: 0, lift: 0, eyes: blink ? 'closed' : 'open', look: 0, armL: 0, armR: 0 };

    if (a.mode === 'celebrate') {
      p.lift = Math.round(Math.abs(Math.sin(t * Math.PI * 2.4)) * 5);
      p.eyes = 'happy';
      const up = Math.floor(t * 8) % 2 === 0;
      p.armL = up ? -5 : -4;
      p.armR = up ? -4 : -5;
      return p;
    }

    if (a.mode === 'work') {
      const frame = Math.floor(time * 8 + a.seq);
      p.squash = Math.floor(time * 3 + a.seq) % 2;
      if (LAPTOP.has(a.activity)) {
        p.armL = frame % 2 ? 1 : 0;
        p.armR = frame % 2 ? 0 : 1;
      } else if (BOOK.has(a.activity)) {
        p.armL = 1;
        p.armR = 1;
        p.look = Math.round(Math.sin(time * 2.5 + a.seq));
      } else if (a.activity === 'error') {
        p.armL = -1;
        p.armR = -1;
        p.squash = 0;
        p.shake = frame % 2 ? 1 : -1;
      } else if (a.activity === 'ask') {
        p.armR = Math.floor(time * 4) % 2 ? -5 : -4;
      } else {
        p.look = a.bubbleSide;
        if (a.bubbleSide > 0) p.armR = -1;
        else p.armL = -1;
        p.eyes = blink ? 'closed' : 'up';
      }
      return p;
    }

    const b = time - a.behaviorStart;
    switch (a.behavior) {
      case 'sleep':
        p.eyes = 'closed';
        p.squash = 1;
        p.armL = 1;
        p.armR = 1;
        break;
      case 'look':
        p.look = a.look;
        break;
      case 'wave':
        p.armR = Math.floor(b * 7) % 2 ? -5 : -4;
        p.eyes = 'happy';
        break;
      case 'hop':
        p.lift = Math.round(Math.abs(Math.sin(b * Math.PI * 1.6)) * 3);
        break;
      case 'stretch':
        p.armL = -5;
        p.armR = -5;
        p.eyes = 'closed';
        break;
      case 'walk':
        p.look = a.tx > a.x ? 1 : a.tx < a.x ? -1 : 0;
        break;
      default:
        p.squash = Math.floor(time * 1.2 + a.seq) % 2;
    }
    return p;
  }

  function drawZ(R, x, y, c) {
    R(x, y, 3, 1, c);
    R(x + 1, y + 1, 1, 1, c);
    R(x, y + 2, 3, 1, c);
  }

  function drawProp(a, R, q) {
    if (a.mode === 'celebrate') {
      const pop = Math.min(1, (time - a.modeStart) * 4);
      if (pop >= 1) {
        const cells = [[3, -7], [4, -6], [5, -5], [6, -6], [7, -7], [8, -8], [9, -9]];
        for (const [x, y] of cells) R(x, y, 2, 2, C.check);
      }
      return;
    }
    if (a.mode === 'idle') {
      if (a.behavior === 'sleep') {
        const phase = (time * 0.7) % 1;
        drawZ(R, 11, -2 - Math.floor(phase * 2), C.outline);
        if (phase > 0.5) drawZ(R, 8, -5 - Math.floor(phase * 2), C.outline);
      }
      return;
    }
    if (LAPTOP.has(a.activity)) {
      R(4, 5, 7, 3, C.metal);
      R(6, 6, 3, 1, C.metalLight);
      R(3, 8, 9, 1, C.metalLight);
    } else if (BOOK.has(a.activity)) {
      const flip = Math.floor(time / 1.8 + a.seq) % 3 === 0 && (time / 1.8 + a.seq) % 1 < 0.2;
      R(3, 5 + q, 4, 3, C.page);
      R(8, 5 + q, 4, 3, flip ? C.ink : C.page);
      R(7, 5 + q, 1, 3, C.spine);
      R(4, 6 + q, 2, 1, C.ink);
      if (!flip) R(9, 6 + q, 2, 1, C.ink);
    }
    drawBubble(a, R);
  }

  function drawBubble(a, R) {
    const left = a.bubbleSide > 0 ? 6 : 0;
    const top = -9 + (time - a.bubbleAt < 0.17 ? 1 : 0);
    const border = a.activity === 'error' ? GLYPHS.cross.color : C.outline;
    R(left, top, 9, 7, border);
    R(left + 1, top + 1, 7, 5, C.bubble);
    R(a.bubbleSide > 0 ? left + 2 : left + 6, top + 7, 1, 1, border);

    if (a.activity === 'think' && !a.thinkVariant) {
      const dot = Math.floor(time * 3 + a.seq) % 3;
      for (let i = 0; i < 3; i++) R(left + 2 + i * 2, top + 3 - (i === dot ? 1 : 0), 1, 1, C.eye);
      return;
    }
    const glyph = GLYPHS[a.activity === 'think' ? 'bulb' : BUBBLE_FOR[a.activity] || 'gear'];
    const x0 = left + 1 + Math.floor((7 - glyph.rows[0].length) / 2);
    glyph.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === '#') R(x0 + x, top + 1 + y, 1, 1, glyph.color);
      }
    });
  }

  function drawActor(a) {
    const s = scale;
    const p = pose(a);
    const px = Math.round(a.x) + (p.shake || 0) * s;
    const py = Math.round(a.y);
    const R0 = (x, y, w, h, c) => {
      ctx.fillStyle = c;
      ctx.fillRect(px + x * s, py + y * s, w * s, h * s);
    };
    const R = (x, y, w, h, c) => R0(x, y - p.lift, w, h, c);
    const q = p.squash;

    R0(2, GH, 11, 1, C.shadow);

    const walkFrame = a.moving ? Math.floor(time * 10) % 2 : -1;
    [3, 5, 9, 11].forEach((x, i) => {
      const short = i % 2 === walkFrame ? 1 : 0;
      R(x, 7 + q, 1, 2 - q - short, C.body);
    });

    R(2, q, 11, 7, C.body);
    const drawArm = (handX, shoulderX, offset) => {
      R(handX, 3 + q + offset, 2, 2, C.body);
      if (offset < -3) R(shoulderX, 5 + q + offset, 1, -offset - 1, C.body);
    };
    drawArm(0, 1, p.armL);
    drawArm(13, 13, p.armR);

    for (const ex of [4 + p.look, 10 + p.look]) {
      if (p.eyes === 'closed') R(ex, 3 + q, 1, 1, C.eye);
      else if (p.eyes === 'up') R(ex, 1 + q, 1, 2, C.eye);
      else if (p.eyes === 'happy') {
        R(ex - 1, 3 + q, 1, 1, C.eye);
        R(ex, 2 + q, 1, 1, C.eye);
        R(ex + 1, 3 + q, 1, 1, C.eye);
      } else R(ex, 2 + q, 1, 2, C.eye);
    }

    drawProp(a, a.mode === 'celebrate' ? R : R0, q);
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    actors.slice().sort((a, b) => a.y - b.y).forEach(drawActor);
    for (const p of particles) {
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    if (overflow > 0) {
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--vscode-foreground') || C.outline;
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('+' + overflow, W - 6, 14);
    }
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (actors.length === 0) createActor(maxX(), groundY(scale));
    relayout();
    for (const a of actors) {
      if (a.mode === 'idle') {
        a.x = a.tx;
        a.y = a.ty;
      }
    }
  }

  window.addEventListener('message', (event) => {
    const m = event.data;
    if (m && m.type === 'agents') reconcile(m.agents, m.completed);
  });

  function actorAt(x, y) {
    return actors.find(
      (a) => x >= a.x && x <= a.x + GW * scale && y >= a.y && y <= a.y + (GH + 1) * scale
    );
  }

  canvas.addEventListener('mousemove', (e) => {
    canvas.style.cursor = actorAt(e.offsetX, e.offsetY) ? 'pointer' : 'default';
  });

  canvas.addEventListener('click', (e) => {
    const actor = actorAt(e.offsetX, e.offsetY);
    if (!actor) return;
    actor.pokedAt = time;
    vscode.postMessage({ type: 'newSession' });
  });

  new ResizeObserver(resize).observe(canvas);
  resize();

  setInterval(() => {
    if (document.hidden) {
      last = performance.now();
      return;
    }
    const now = performance.now();
    update(Math.min(0.25, (now - last) / 1000));
    last = now;
    render();
  }, 1000 / FPS);

  vscode.postMessage({ type: 'ready' });
})();
