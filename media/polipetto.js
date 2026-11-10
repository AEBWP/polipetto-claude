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
  const LIST_X = GW + 1; // the task sheet sits beside the sprite
  const LIST_W = 2;
  const LIST_ROWS = 4;
  const LIST_PITCH = 3;
  const LIST_TOP = -1;
  const SLOT_W_WITH_LIST = LIST_X + LIST_W + 3;
  const SCALES = [5, 4, 3, 2];
  const BUBBLE_START_Y = 8;
  const BUBBLE_RISE = 4; // cells per second
  const BUBBLE_LIFE_S = 4.25;
  const BUBBLE_MAX_NEW = 3; // a burst of steps read at once stays legible
  const BUBBLE_GAP_S = 0.3;
  const CELEBRATE_S = 2.6;
  const SQUEEZE_S = 2.6;
  const SQUEEZE_RELEASE = 0.75; // fraction of the squeeze after which it pops back
  const SLEEP_AFTER_S = 70;
  const SLEEP_FOR_S = 30;

  const C = {
    body: '#D97757',
    eye: '#231A16',
    shadow: 'rgba(127,127,127,0.25)',
    metal: '#4B5563',
    metalLight: '#9CA3AF',
    lens: '#F5F1E8',
    bubble: '#FFFFFF',
    outline: '#8B949E',
    check: '#3FB950',
    boss: '#8A7BE8',
    link: 'rgba(138,123,232,0.55)',
    signal: '#C9C1FF',
    scan: '#58A6FF',
  };
  const LIST = {
    pending: '#8B949E',
    active: '#D97757',
    activeDim: '#F0B39B',
    done: '#3FB950',
  };
  const STEP_COLOR = {
    read: '#58A6FF',
    write: '#F0B429',
    run: '#A371F7',
    web: '#39C5CF',
    delegate: '#F778BA',
    tool: '#8B949E',
  };

  const GLYPHS = {
    bulb: {
      color: '#E3A008',
      base: '#57606A',
      fps: 2.5,
      frames: [
        ['..###..', '.#.###.', '.#####.', '..###..', '..===..'],
        ['#.###.#', '.#.###.', '.#####.', '#.###.#', '..===..'],
      ],
    },
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
    flask: { color: '#0E8A8A', rows: ['.###.', '..#..', '.#.#.', '#...#', '#####'] },
    check: { color: '#1A7F37', rows: ['....#', '...##', '#.##.', '###..', '.#...'] },
    bricks: {
      color: '#B35900',
      fps: 2,
      frames: [
        ['.......', '.......', '.......', '.......', '###.###'],
        ['.......', '.......', '#.###.#', '.......', '###.###'],
        ['###.###', '.......', '#.###.#', '.......', '###.###'],
      ],
    },
    stamp: {
      color: '#BC4C00',
      fps: 3,
      frames: [
        ['.###.', '..#..', '#####', '.....', '#.#.#'],
        ['.....', '.###.', '..#..', '#####', '#.#.#'],
      ],
    },
    arrowUp: {
      color: '#2F81F7',
      fps: 4,
      frames: [
        ['..#..', '.###.', '#.#.#', '..#..', '..#..'],
        ['.###.', '#.#.#', '..#..', '..#..', '.....'],
      ],
    },
    arrowDown: {
      color: '#1A7F37',
      fps: 4,
      frames: [
        ['..#..', '..#..', '#.#.#', '.###.', '..#..'],
        ['.....', '..#..', '..#..', '#.#.#', '.###.'],
      ],
    },
    parcel: {
      color: '#9A6700',
      fps: 2,
      frames: [
        ['#####', '#.#.#', '#####', '#...#', '#####'],
        ['#...#', '.#.#.', '#####', '#...#', '#####'],
      ],
    },
    rocket: {
      color: '#E8590C',
      fps: 6,
      frames: [
        ['..#..', '.###.', '.###.', '#####', '#.#.#'],
        ['..#..', '.###.', '.###.', '#####', '.#.#.'],
      ],
    },
    hourglass: {
      color: '#57606A',
      fps: 1.5,
      frames: [
        ['#####', '.###.', '..#..', '.#.#.', '#####'],
        ['#####', '.#.#.', '..#..', '.###.', '#####'],
      ],
    },
    squeeze: { color: '#8250DF', rows: ['.###.', '..#..', '#####', '..#..', '.###.'] },
  };
  const BUBBLE_FOR = {
    run: 'terminal',
    write: 'pencil',
    read: 'page',
    search: 'magnifier',
    web: 'globe',
    delegate: 'octopus',
    supervise: 'octopus',
    ask: 'question',
    plan: 'checklist',
    tool: 'gear',
    error: 'cross',
    test: 'flask',
    passed: 'check',
    build: 'bricks',
    commit: 'stamp',
    push: 'arrowUp',
    pull: 'arrowDown',
    install: 'parcel',
    deploy: 'rocket',
    wait: 'hourglass',
    compact: 'squeeze',
  };
  const LAPTOP = new Set(['run', 'write', 'web', 'tool', 'test', 'build', 'commit', 'push', 'pull', 'install', 'deploy']);
  const READING = new Set(['read', 'search']);

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

  function listsVisible() {
    return (
      actors.some((a) => a.tasks.length > 0 || a.stepCount > 0) ||
      latestAgents.some((a) => (a.tasks && a.tasks.length > 0) || a.steps)
    );
  }

  function slotCells() {
    return listsVisible() ? SLOT_W_WITH_LIST : SLOT_W;
  }

  function contentCells() {
    return listsVisible() ? LIST_X + LIST_W : GW;
  }

  function layoutFor(n) {
    const cells = slotCells();
    for (const s of SCALES) {
      const cols = Math.floor(W / (cells * s));
      const rows = Math.floor((H - 4 - s) / (SLOT_H * s));
      if (cols >= 1 && rows >= 1 && cols * rows >= n) return { s, cols, rows };
    }
    const s = SCALES[SCALES.length - 1];
    return { s, cols: Math.max(1, Math.floor(W / (cells * s))), rows: Math.max(1, Math.floor((H - 4 - s) / (SLOT_H * s))) };
  }

  function parentActor(a) {
    return a.parentAgentId ? actors.find((x) => x !== a && x.agentId === a.parentAgentId) : null;
  }

  /** Breadth-first levels of the management tree, orchestrators first. */
  function buildLevels() {
    const children = new Map();
    const roots = [];
    for (const a of actors) {
      const parent = parentActor(a);
      if (!parent) {
        roots.push(a);
      } else {
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(a);
      }
    }
    for (const a of actors) a.boss = children.has(a) || (a.boss && a.mode === 'celebrate');

    const levels = [];
    let current = roots;
    while (current.length && levels.length < 8) {
      levels.push(current);
      current = current.flatMap((a) => children.get(a) || []);
    }
    return levels;
  }

  function wrapLevels(levels, cols) {
    const rows = [];
    for (const level of levels) {
      for (let i = 0; i < level.length; i += cols) rows.push(level.slice(i, i + cols));
    }
    return rows;
  }

  function placeRows(rows, s) {
    const slotW = slotCells() * s;
    const slotH = SLOT_H * s;
    const inset = (slotW - contentCells() * s) / 2;
    rows.forEach((row, r) => {
      const startX = (W - row.length * slotW) / 2;
      row.forEach((a, col) => {
        a.tx = Math.round(startX + col * slotW + inset);
        a.ty = groundY(s) - (rows.length - 1 - r) * slotH;
      });
    });
  }

  function layoutTree(levels) {
    const cells = slotCells();
    let chosen = null;
    for (const s of SCALES) {
      const cols = Math.floor(W / (cells * s));
      if (cols < 1) continue;
      chosen = { s, rows: wrapLevels(levels, cols) };
      if (chosen.rows.length * SLOT_H * s + s + 4 <= H) break;
    }
    if (!chosen) chosen = { s: SCALES[SCALES.length - 1], rows: wrapLevels(levels, 1) };
    scale = chosen.s;
    placeRows(chosen.rows, chosen.s);
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
    const levels = buildLevels();
    if (levels.length > 1) {
      layoutTree(levels);
      return;
    }

    const n = Math.max(actors.length, 1);
    const { s, cols } = layoutFor(n);
    scale = s;

    if (actors.length === 1 && actors[0].mode === 'idle') {
      const a = actors[0];
      a.tx = Math.min(a.tx, maxX());
      a.ty = groundY(s);
      return;
    }
    const rows = [];
    for (let i = 0; i < actors.length; i += cols) rows.unshift(actors.slice(i, i + cols));
    placeRows(rows, s);
  }

  function setMode(a, mode, activity) {
    a.mode = mode;
    a.modeStart = time;
    if (activity) a.activity = activity;
    if (mode === 'idle') {
      a.idleSince = time;
      a.tasks = [];
      a.stepCount = 0;
      a.boss = false;
      a.parentAgentId = null;
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
      parentAgentId: null,
      boss: false,
      tasks: [],
      glanceUntil: -Infinity,
      nextGlance: time + rand(1, 3),
      bubbleAt: -Infinity,
      squeezeAt: -Infinity,
      squeezeReleased: true,
      stepCount: 0,
      floats: [],
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
      color: a.activity === 'build' ? '#E3A008' : Math.random() < 0.5 ? '#58A6FF' : C.check,
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
      actor.parentAgentId = agent.parentId;
      actor.step = agent.step;
      syncTasks(actor, agent.tasks || []);
      setMode(actor, 'work', agent.activity);
      syncSteps(actor, agent.steps);
    }
  }

  function listRowY(row) {
    return LIST_TOP + row * LIST_PITCH;
  }

  /** The visible rows always include the task in progress. */
  function listWindow(tasks) {
    let current = tasks.indexOf('in_progress');
    if (current < 0) current = tasks.indexOf('pending');
    if (current < 0) current = tasks.length - 1;
    const start = Math.max(0, Math.min(current - 1, tasks.length - LIST_ROWS));
    return { current, start };
  }

  function syncTasks(a, tasks) {
    const changed = tasks.length !== a.tasks.length || tasks.some((t, i) => t !== a.tasks[i]);
    if (!changed) return;
    const { start } = listWindow(tasks);
    tasks.forEach((status, i) => {
      const row = i - start;
      if (status !== 'completed' || a.tasks[i] === undefined || a.tasks[i] === 'completed') return;
      if (row < 0 || row >= LIST_ROWS) return;
      for (let n = 0; n < 5; n++) {
        particles.push({
          x: a.x + (LIST_X + 1) * scale,
          y: a.y + listRowY(row) * scale,
          vx: rand(-40, 40),
          vy: rand(-70, -20),
          gravity: 180,
          life: rand(0.3, 0.6),
          color: LIST.done,
          size: Math.max(1, scale - 1),
        });
      }
    });
    a.tasks = tasks;
    a.glanceUntil = time + 1.4;
  }

  /** One rising bubble per new step; a request that starts over has a lower count. */
  function syncSteps(a, steps) {
    const count = steps ? steps.count : 0;
    if (count < a.stepCount) a.stepCount = 0;
    const fresh = Math.min(BUBBLE_MAX_NEW, count - a.stepCount);
    for (let i = 0; i < fresh; i++) {
      a.floats.push({
        born: time + i * BUBBLE_GAP_S,
        color: STEP_COLOR[steps.kind] || STEP_COLOR.tool,
        wobble: rand(0, Math.PI * 2),
      });
    }
    a.stepCount = count;
  }

  function nextBubble(a) {
    a.thinkVariant = 1 - a.thinkVariant;
    a.bubbleSide = -a.bubbleSide;
    a.bubbleAt = time;
  }

  function startSqueeze(a) {
    a.squeezeAt = time;
    a.squeezeReleased = false;
  }

  function isSqueezing(a) {
    return a.mode !== 'celebrate' && time - a.squeezeAt < SQUEEZE_S;
  }

  function isPressed(a) {
    return isSqueezing(a) && time - a.squeezeAt < SQUEEZE_S * SQUEEZE_RELEASE;
  }

  function reconcile(agents, completed, compacted) {
    latestAgents = agents;
    const byId = new Map(agents.map((a) => [a.id, a]));

    for (const a of actors.slice()) {
      if (!a.agentId) continue;
      const agent = byId.get(a.agentId);
      if (agent) {
        a.activity = agent.activity;
        a.parentAgentId = agent.parentId;
        syncTasks(a, agent.tasks || []);
        syncSteps(a, agent.steps);
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

    // A manual compaction happens in a resting session, which has no octopus of its own.
    for (const id of compacted || []) {
      const actor = actors.find((a) => a.agentId === id) || actors.find((a) => !a.agentId && a.mode === 'idle');
      if (actor) startSqueeze(actor);
    }
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
      a.floats = a.floats.filter((f) => time - f.born < BUBBLE_LIFE_S);
      if (a.mode === 'idle') updateIdle(a);
      if (a.mode === 'celebrate') {
        if (time - a.lastConfetti > 0.35) {
          a.lastConfetti = time;
          confetti(a);
        }
        if (time - a.modeStart >= CELEBRATE_S) retire(a);
      }
      if (a.mode === 'work' && LAPTOP.has(a.activity) && Math.random() < 0.3) bits(a);
      if (a.mode === 'work' && a.activity === 'deploy' && time - a.lastConfetti > 0.8) {
        a.lastConfetti = time;
        confetti(a);
      }
      if (!a.squeezeReleased && time - a.squeezeAt >= SQUEEZE_S * SQUEEZE_RELEASE) {
        a.squeezeReleased = true;
        puff(a);
      }
      if (a.mode === 'work' && a.tasks.length && time >= a.nextGlance) {
        a.glanceUntil = time + 1.1;
        a.nextGlance = time + rand(3.5, 7);
      }

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

  function isGlancing(a) {
    return a.mode === 'work' && a.tasks.length > 0 && time < a.glanceUntil;
  }

  function pose(a) {
    const p = basePose(a);
    const sincePoke = time - a.pokedAt;
    if (sincePoke < 0.4) p.lift += Math.round(Math.sin((sincePoke / 0.4) * Math.PI) * 4);
    if (isSqueezing(a)) {
      const since = time - a.squeezeAt;
      const release = SQUEEZE_S * SQUEEZE_RELEASE;
      if (since < release) {
        p.press = Math.floor(since * 5) % 2 ? 2 : 3;
        p.eyes = 'closed';
        p.armL = 1;
        p.armR = 1;
      } else {
        p.lift += Math.round(Math.sin(((since - release) / (SQUEEZE_S - release)) * Math.PI) * 3);
        p.eyes = 'happy';
      }
    }
    if (isGlancing(a)) {
      p.look = 1;
      if (p.eyes !== 'closed') p.eyes = 'open';
    }
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
      if (a.activity === 'build') {
        p.armL = frame % 2 ? -2 : 1;
        p.armR = frame % 2 ? 1 : -2;
      } else if (LAPTOP.has(a.activity)) {
        p.armL = frame % 2 ? 1 : 0;
        p.armR = frame % 2 ? 0 : 1;
      } else if (a.activity === 'passed') {
        p.squash = 0;
        p.lift = Math.round(Math.abs(Math.sin(time * Math.PI * 2)) * 3);
        p.eyes = 'happy';
        p.armL = -4;
        p.armR = -4;
      } else if (a.activity === 'wait') {
        p.squash = 1;
        p.armL = 1;
        p.armR = Math.floor(time * 2 + a.seq) % 2;
        p.eyes = blink ? 'closed' : 'up';
      } else if (READING.has(a.activity)) {
        p.armL = 1;
        p.armR = 1;
        p.look = Math.round(Math.sin(time * 2.5 + a.seq));
      } else if (a.activity === 'error') {
        p.armL = -1;
        p.armR = -1;
        p.squash = 0;
        p.shake = frame % 2 ? 1 : -1;
      } else if (a.activity === 'delegate' || a.activity === 'supervise') {
        p.eyes = blink ? 'closed' : 'down';
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
      if (isPressed(a)) {
        drawBubble(a, R);
      } else if (a.behavior === 'sleep') {
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
    }
    drawBubble(a, R);
  }

  function drawBubble(a, R) {
    const left = a.bubbleSide > 0 ? 6 : 0;
    const top = -9 + (time - a.bubbleAt < 0.17 ? 1 : 0);
    const kind = isPressed(a) ? 'compact' : a.activity;
    const border = kind === 'error' ? GLYPHS.cross.color : kind === 'passed' ? GLYPHS.check.color : C.outline;
    R(left, top, 9, 7, border);
    R(left + 1, top + 1, 7, 5, C.bubble);
    R(a.bubbleSide > 0 ? left + 2 : left + 6, top + 7, 1, 1, border);

    if (kind === 'think' && !a.thinkVariant) {
      const dot = Math.floor(time * 3 + a.seq) % 3;
      for (let i = 0; i < 3; i++) R(left + 2 + i * 2, top + 3 - (i === dot ? 1 : 0), 1, 1, C.eye);
      return;
    }
    const glyph = GLYPHS[kind === 'think' ? 'bulb' : BUBBLE_FOR[kind] || 'gear'];
    const rows = glyph.frames ? glyph.frames[Math.floor(time * glyph.fps + a.seq) % glyph.frames.length] : glyph.rows;
    const x0 = left + 1 + Math.floor((7 - rows[0].length) / 2);
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === '#') R(x0 + x, top + 1 + y, 1, 1, glyph.color);
        else if (row[x] === '=') R(x0 + x, top + 1 + y, 1, 1, glyph.base);
      }
    });
  }

  function drawList(a, R) {
    if (a.tasks.length === 0) return;
    const { current, start } = listWindow(a.tasks);
    const activeColor = Math.floor(time * 4 + a.seq) % 2 === 0 ? LIST.active : LIST.activeDim;

    a.tasks.slice(start, start + LIST_ROWS).forEach((status, i) => {
      const color = status === 'completed' ? LIST.done : status === 'in_progress' ? activeColor : LIST.pending;
      R(LIST_X, listRowY(i), 2, 2, color);
    });

    if (isGlancing(a)) R(LIST_X - 1, listRowY(Math.max(0, current - start)), 1, 1, C.scan);
  }

  function drawFloats(a, R) {
    for (const f of a.floats) {
      const age = time - f.born;
      if (age < 0) continue;
      const y = Math.round(BUBBLE_START_Y - age * BUBBLE_RISE);
      const x = LIST_X + Math.round(Math.sin(age * 2.6 + f.wobble) * 0.5 + 0.5);
      const fade = y < -5 ? Math.max(0, (y + 9) / 4) : 1;
      ctx.globalAlpha = fade;
      R(x, y, 2, 2, f.color);
      ctx.globalAlpha = fade * 0.75;
      R(x, y, 1, 1, '#FFFFFF');
    }
    ctx.globalAlpha = 1;
  }

  function linkPoints(child, parent) {
    const s = scale;
    const x1 = Math.round(parent.x) + 7 * s;
    const y1 = Math.round(parent.y) + (GH + 1) * s;
    const bus = y1 + s;
    // Drop on the side away from the speech bubble so the line stays visible.
    const x2 = Math.round(child.x) + (child.bubbleSide > 0 ? 3 : 11) * s;
    const y2 = Math.round(child.y);
    return [[x1, y1], [x1, bus], [x2, bus], [x2, y2]];
  }

  function drawLinks() {
    const thick = Math.max(2, Math.floor(scale * 0.6));
    for (const a of actors) {
      const parent = parentActor(a);
      if (!parent) continue;
      const pts = linkPoints(a, parent);
      ctx.fillStyle = C.link;
      let length = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax) + thick, Math.abs(by - ay) + thick);
        length += Math.abs(bx - ax) + Math.abs(by - ay);
      }
      if (a.mode !== 'work' || length === 0) continue;

      // A signal travels from the orchestrator down to the worker.
      let travelled = (time * 30 * scale + a.seq * 37) % length;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        const segment = Math.abs(bx - ax) + Math.abs(by - ay);
        if (travelled <= segment) {
          const f = segment ? travelled / segment : 0;
          ctx.fillStyle = C.signal;
          ctx.fillRect(Math.round(ax + (bx - ax) * f), Math.round(ay + (by - ay) * f), thick, thick);
          break;
        }
        travelled -= segment;
      }
    }
  }

  function drawActor(a) {
    const s = scale;
    const p = pose(a);
    const bodyColor = a.boss ? C.boss : C.body;
    const px = Math.round(a.x) + (p.shake || 0) * s;
    const py = Math.round(a.y);
    const R0 = (x, y, w, h, c) => {
      ctx.fillStyle = c;
      ctx.fillRect(px + x * s, py + y * s, w * s, h * s);
    };
    const R = (x, y, w, h, c) => R0(x, y - p.lift, w, h, c);
    const press = p.press || 0;
    const q = p.squash + press;
    const wide = press >= 2 ? 1 : 0;

    R0(2, GH, 11, 1, C.shadow);

    const walkFrame = a.moving ? Math.floor(time * 10) % 2 : -1;
    [3, 5, 9, 11].forEach((x, i) => {
      const short = i % 2 === walkFrame ? 1 : 0;
      R(x, 7 + p.squash, 1, 2 - p.squash - short, bodyColor);
    });

    R(2 - wide, q, 11 + 2 * wide, 7 - press, bodyColor);
    const drawArm = (handX, shoulderX, offset) => {
      R(handX, 3 + q + offset, 2, 2, bodyColor);
      if (offset < -3) R(shoulderX, 5 + q + offset, 1, -offset - 1, bodyColor);
    };
    drawArm(0, 1, p.armL);
    drawArm(13, 13, p.armR);

    if (a.mode === 'work' && READING.has(a.activity)) {
      R(3, 1 + q, 3, 4, C.lens);
      R(9, 1 + q, 3, 4, C.lens);
      R(6, 2 + q, 3, 1, C.metal);
      R(2, 2 + q, 1, 1, C.metal);
      R(12, 2 + q, 1, 1, C.metal);
    }

    for (const ex of [4 + p.look, 10 + p.look]) {
      if (p.eyes === 'closed') R(ex, 3 + q, 1, 1, C.eye);
      else if (p.eyes === 'up') R(ex, 1 + q, 1, 2, C.eye);
      else if (p.eyes === 'down') R(ex, 3 + q, 1, 2, C.eye);
      else if (p.eyes === 'happy') {
        R(ex - 1, 3 + q, 1, 1, C.eye);
        R(ex, 2 + q, 1, 1, C.eye);
        R(ex + 1, 3 + q, 1, 1, C.eye);
      } else R(ex, 2 + q, 1, 2, C.eye);
    }

    drawProp(a, a.mode === 'celebrate' ? R : R0, q);
    drawList(a, R0);
    drawFloats(a, R0);
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    drawLinks();
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
    if (m && m.type === 'agents') reconcile(m.agents, m.completed, m.compacted);
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
