'use strict';

// ─────────────────────────────────────────────
//  CONSTANTS & ASSET URLS
// ─────────────────────────────────────────────
const RAW = 'https://raw.githubusercontent.com/samuelcust/flappy-bird-assets/master';

const ASSETS = {
  bg:        `${RAW}/sprites/background-day.png`,
  base:      `${RAW}/sprites/base.png`,
  pipeGreen: `${RAW}/sprites/pipe-green.png`,
  gameover:  `${RAW}/sprites/gameover.png`,
  message:   `${RAW}/sprites/message.png`,
  bird0:     `${RAW}/sprites/yellowbird-upflap.png`,
  bird1:     `${RAW}/sprites/yellowbird-midflap.png`,
  bird2:     `${RAW}/sprites/yellowbird-downflap.png`,
  nums: [...Array(10)].map((_,i) => `${RAW}/sprites/${i}.png`),
  sfxWing:   `${RAW}/audio/wing.ogg`,
  sfxHit:    `${RAW}/audio/hit.ogg`,
  sfxPoint:  `${RAW}/audio/point.ogg`,
  sfxDie:    `${RAW}/audio/die.ogg`,
};

// Game dimensions (classic Flappy Bird)
const W = 288, H = 512;
const GROUND_Y = 400;          // Y coordinate where the base starts
const BASE_H   = H - GROUND_Y; // Height of the scrolling ground

// Physics
const GRAVITY   = 0.25;  // Pixels per frame² (downward acceleration)
const FLAP_VEL  = -4.5;  // Upward velocity applied on each flap
const PIPE_GAP  = 120;   // Vertical gap between top and bottom pipes (+20% vs classic)
const PIPE_VEL  = 2;     // Pixels per frame the pipes move left
const PIPE_FREQ = 90;    // Frames between pipe spawns (~1.5 s at 60 fps)

// Pose detection — flap gesture (wrists moving UP)
const JUMP_THRESHOLD   = 0.05; // Minimum wrist Y delta (normalized 0-1) to trigger a flap
const JUMP_COOLDOWN_MS = 0;    // Minimum ms between flaps (0 = no cooldown)

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────
let imgs   = {};
let sounds = {};
let numImgs = [];

let gameState  = 'waiting'; // 'waiting' | 'playing' | 'dead'
let score      = 0;
let bestScore  = parseInt(localStorage.getItem('fb_best') || '0');
let totalJumps = 0;

let bird, pipes, baseX, frameCount;
let poseFps = 0, poseFrameTs = 0, poseFrameCount = 0;

// ─────────────────────────────────────────────
//  CANVAS
// ─────────────────────────────────────────────
const canvas  = document.getElementById('gameCanvas');
const ctx     = canvas.getContext('2d');

const poseCanvas = document.getElementById('poseCanvas');
const poseCtx    = poseCanvas.getContext('2d');

// ─────────────────────────────────────────────
//  LOADING HELPERS
// ─────────────────────────────────────────────
function setLoading(pct, msg) {
  document.getElementById('loading-bar').style.width = pct + '%';
  document.getElementById('loading-msg').textContent  = msg;
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => res(img);
    img.onerror = () => rej(new Error('Failed to load image: ' + src));
    img.src = src;
  });
}

function loadAudio(src) {
  return new Promise((res) => {
    const a = new Audio();
    a.crossOrigin = 'anonymous';
    a.src = src;
    a.oncanplaythrough = () => res(a);
    a.onerror = () => res(null); // audio is optional — game still works without it
    a.load();
  });
}

async function loadAllAssets() {
  const total = 16; // 8 images + 10 digit sprites (batched)
  let loaded  = 0;
  const tick  = () => { loaded++; setLoading(10 + (loaded/total)*50, `Cargando sprites… (${loaded}/${total})`); };

  [imgs.bg, imgs.base, imgs.pipeGreen, imgs.gameover, imgs.message,
   imgs.bird0, imgs.bird1, imgs.bird2] =
    await Promise.all([
      loadImage(ASSETS.bg).then(i=>{tick();return i;}),
      loadImage(ASSETS.base).then(i=>{tick();return i;}),
      loadImage(ASSETS.pipeGreen).then(i=>{tick();return i;}),
      loadImage(ASSETS.gameover).then(i=>{tick();return i;}),
      loadImage(ASSETS.message).then(i=>{tick();return i;}),
      loadImage(ASSETS.bird0).then(i=>{tick();return i;}),
      loadImage(ASSETS.bird1).then(i=>{tick();return i;}),
      loadImage(ASSETS.bird2).then(i=>{tick();return i;}),
    ]);

  numImgs = await Promise.all(ASSETS.nums.map(src => loadImage(src).then(i=>{tick();return i;})));

  // Audio (best-effort, does not block game startup)
  [sounds.wing, sounds.hit, sounds.point, sounds.die] = await Promise.all([
    loadAudio(ASSETS.sfxWing),
    loadAudio(ASSETS.sfxHit),
    loadAudio(ASSETS.sfxPoint),
    loadAudio(ASSETS.sfxDie),
  ]);
}

function playSound(snd) {
  if (!snd) return;
  try {
    const clone = snd.cloneNode();
    clone.volume = 0.5;
    clone.play().catch(()=>{});
  } catch(e) {}
}

// ─────────────────────────────────────────────
//  BIRD
// ─────────────────────────────────────────────
function createBird() {
  return { x: 50, y: H / 2 - 10, vy: 0, frame: 0, frameTick: 0, angle: 0 };
}

function updateBird() {
  bird.vy += GRAVITY;
  bird.y  += bird.vy;

  // Wing animation — cycle through 3 frames every 5 game ticks
  bird.frameTick++;
  if (bird.frameTick >= 5) { bird.frame = (bird.frame + 1) % 3; bird.frameTick = 0; }

  // Smooth rotation: tilt up on flap, dive on fall
  const targetAngle = bird.vy < 0
    ? Math.max(-25, bird.vy * 3)
    : Math.min(90,   bird.vy * 5);
  bird.angle += (targetAngle - bird.angle) * 0.2;

  // Ground collision
  if (bird.y + 12 >= GROUND_Y) {
    bird.y = GROUND_Y - 12;
    bird.vy = 0;
    return true; // signal death
  }
  // Ceiling clamp
  if (bird.y - 12 <= 0) { bird.y = 12; bird.vy = 0; }

  return false;
}

function drawBird() {
  const sprites = [imgs.bird0, imgs.bird1, imgs.bird2];
  const img = sprites[bird.frame];
  const bw = 34, bh = 24;
  ctx.save();
  ctx.translate(bird.x, bird.y);
  ctx.rotate(bird.angle * Math.PI / 180);
  ctx.drawImage(img, -bw/2, -bh/2, bw, bh);
  ctx.restore();
}

function flap() {
  if (gameState === 'dead') return;
  if (gameState === 'waiting') startGame();
  bird.vy = FLAP_VEL;
  playSound(sounds.wing);
  totalJumps++;
  document.getElementById('stat-jumps').textContent = totalJumps;
  showFlapIndicator();
}

// ─────────────────────────────────────────────
//  PIPES
// ─────────────────────────────────────────────
function createPipe() {
  const minTop = 50, maxTop = GROUND_Y - PIPE_GAP - 50;
  const topH   = Math.floor(Math.random() * (maxTop - minTop + 1)) + minTop;
  return {
    x:    W,
    topH: topH,
    botY:  topH + PIPE_GAP,
    botH:  GROUND_Y - (topH + PIPE_GAP),
    scored: false,
  };
}

const PIPE_W = 52;

function drawPipes() {
  for (const p of pipes) {
    // Top pipe — drawn flipped vertically
    ctx.save();
    ctx.translate(p.x + PIPE_W/2, p.topH/2);
    ctx.scale(1, -1);
    ctx.drawImage(imgs.pipeGreen, -PIPE_W/2, -p.topH/2, PIPE_W, p.topH);
    ctx.restore();

    // Bottom pipe — drawn normally
    ctx.drawImage(imgs.pipeGreen, p.x, p.botY, PIPE_W, p.botH);
  }
}

function updatePipes() {
  if (frameCount % PIPE_FREQ === 0) pipes.push(createPipe());
  for (const p of pipes) p.x -= PIPE_VEL;
  while (pipes.length && pipes[0].x + PIPE_W < 0) pipes.shift();
}

// ─────────────────────────────────────────────
//  COLLISION & SCORING
// ─────────────────────────────────────────────
function checkCollision() {
  // Slightly reduced hitbox for more forgiving gameplay
  const bx = bird.x - 14, by = bird.y - 10, bw2 = 28, bh2 = 20;
  for (const p of pipes) {
    const inX = bx + bw2 > p.x + 2 && bx < p.x + PIPE_W - 2;
    if (inX && (by < p.topH - 2 || by + bh2 > p.botY + 2)) return true;
  }
  return false;
}

function checkScore() {
  for (const p of pipes) {
    if (!p.scored && p.x + PIPE_W < bird.x) {
      p.scored = true;
      score++;
      document.getElementById('stat-score').textContent = score;
      playSound(sounds.point);
      if (score > bestScore) {
        bestScore = score;
        localStorage.setItem('fb_best', bestScore);
        document.getElementById('stat-best').textContent = bestScore;
      }
    }
  }
}

// ─────────────────────────────────────────────
//  DRAWING
// ─────────────────────────────────────────────
function drawBackground() {
  ctx.drawImage(imgs.bg, 0, 0, W, H);
}

function drawBase() {
  const bw = imgs.base.width;
  const drawX = -(baseX % bw);
  ctx.drawImage(imgs.base, drawX,      GROUND_Y, bw, BASE_H);
  ctx.drawImage(imgs.base, drawX + bw, GROUND_Y, bw, BASE_H);
}

function drawScore() {
  const s    = String(score);
  const numW = 24, numH = 36, gap = 4;
  const total = s.length * (numW + gap) - gap;
  let sx = (W - total) / 2;
  for (const ch of s) {
    ctx.drawImage(numImgs[+ch], sx, 24, numW, numH);
    sx += numW + gap;
  }
}

function drawMessage() {
  const mw = 184, mh = 267;
  ctx.drawImage(imgs.message, (W - mw)/2, (H - mh)/2 - 30, mw, mh);
}

function drawGameOver() {
  const gw = 192, gh = 42;
  ctx.drawImage(imgs.gameover, (W - gw)/2, H/2 - 60, gw, gh);

  // Score panel
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.roundRect((W-180)/2, H/2 - 10, 180, 70, 10);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.font = '8px "Press Start 2P"';
  ctx.textAlign = 'left';
  ctx.fillText('SCORE', (W-160)/2 + 6, H/2 + 14);
  ctx.fillText('BEST',  (W-160)/2 + 6, H/2 + 40);
  ctx.textAlign = 'right';
  ctx.fillText(score,     (W+160)/2 - 6, H/2 + 14);
  ctx.fillText(bestScore, (W+160)/2 - 6, H/2 + 40);
  ctx.textAlign = 'start';

  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '7px "Press Start 2P"';
  ctx.textAlign = 'center';
  ctx.fillText('ALETEA PARA REINICIAR', W/2, H/2 + 86);
  ctx.textAlign = 'start';
}

// ─────────────────────────────────────────────
//  GAME STATE MANAGEMENT
// ─────────────────────────────────────────────
function initGame() {
  bird      = createBird();
  pipes     = [];
  baseX     = 0;
  frameCount = 0;
  score      = 0;
  document.getElementById('stat-score').textContent = '0';
}

function startGame() {
  gameState = 'playing';
}

function killBird() {
  if (gameState === 'dead') return;
  gameState = 'dead';
  playSound(sounds.hit);
  setTimeout(() => playSound(sounds.die), 300);
  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem('fb_best', bestScore);
    document.getElementById('stat-best').textContent = bestScore;
  }
}

// ─────────────────────────────────────────────
//  MAIN GAME LOOP
// ─────────────────────────────────────────────
function gameLoop() {
  ctx.clearRect(0, 0, W, H);
  drawBackground();

  if (gameState === 'waiting') {
    drawBird();
    drawBase();
    drawMessage();
  }

  else if (gameState === 'playing') {
    frameCount++;
    baseX += PIPE_VEL;

    updatePipes();
    const hitGround = updateBird();

    if (hitGround || checkCollision()) {
      killBird();
    } else {
      checkScore();
    }

    drawPipes();
    drawBird();
    drawBase();
    drawScore();
  }

  else if (gameState === 'dead') {
    drawPipes();
    drawBird();
    drawBase();
    drawScore();
    drawGameOver();
  }

  requestAnimationFrame(gameLoop);
}

// ─────────────────────────────────────────────
//  INPUT (keyboard / click fallback)
// ─────────────────────────────────────────────
window.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    if (gameState === 'dead') { initGame(); gameState = 'waiting'; return; }
    flap();
  }
});
canvas.addEventListener('click', () => {
  if (gameState === 'dead') { initGame(); gameState = 'waiting'; return; }
  flap();
});

// ─────────────────────────────────────────────
//  FLAP INDICATOR UI
// ─────────────────────────────────────────────
let flapIndicatorTimeout = null;
function showFlapIndicator() {
  const el = document.getElementById('jump-indicator');
  el.classList.add('active');
  document.getElementById('status-dot').classList.add('jump');
  clearTimeout(flapIndicatorTimeout);
  flapIndicatorTimeout = setTimeout(() => {
    el.classList.remove('active');
    document.getElementById('status-dot').classList.remove('jump');
  }, 400);
}

// ─────────────────────────────────────────────
//  MEDIAPIPE POSE DETECTION
// ─────────────────────────────────────────────
let poseLandmarker  = null;
let lastJumpTime    = 0;
let prevWristY      = null;   // Smoothed average Y of both wrists (normalized 0-1)
let wristHistory    = [];     // Rolling buffer used for smoothing
const WRIST_WINDOW  = 4;      // Smaller window = more responsive detection

/**
 * Initialises MediaPipe PoseLandmarker via dynamic ES module import.
 * Uses the "lite" model for best performance on consumer hardware.
 */
async function initMediaPipe() {
  setLoading(62, 'Cargando MediaPipe Vision…');

  const MEDIAPIPE_VERSION = '0.10.34';
  const { PoseLandmarker, FilesetResolver } = await import(
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`
  );

  setLoading(68, 'Inicializando modelo de pose…');

  const vision = await FilesetResolver.forVisionTasks(
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
  );

  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
      delegate: 'GPU', // Uses WebGL acceleration when available
    },
    runningMode:                'VIDEO',  // Optimised for continuous video frames
    numPoses:                   1,        // Only track one person
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence:  0.5,
    minTrackingConfidence:      0.5,
  });

  setLoading(80, 'Accediendo a la cámara…');
}

/** Requests webcam access and starts the video stream. */
async function startCamera() {
  const video = document.getElementById('camVideo');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    });
    video.srcObject = stream;
    await new Promise(r => video.addEventListener('loadeddata', r, { once: true }));
    document.getElementById('status-dot').classList.add('active');
    document.getElementById('status-text').textContent = 'Cámara activa — ¡Listo!';
  } catch (e) {
    document.getElementById('status-text').textContent = 'Sin acceso a cámara';
    console.warn('Camera error:', e);
  }
}

/**
 * Draws a simplified skeleton on the overlay canvas.
 * Wrists (landmarks 15 & 16) are highlighted in yellow since they
 * are the trigger points for the flap gesture.
 */
function drawPoseSkeleton(landmarks) {
  poseCtx.clearRect(0, 0, poseCanvas.width, poseCanvas.height);

  const CONNECTIONS = [
    [11,13],[13,15], // Left arm
    [12,14],[14,16], // Right arm
    [11,12],         // Shoulders
    [23,24],         // Hips
    [11,23],[12,24], // Torso
    [23,25],[25,27], // Left leg
    [24,26],[26,28], // Right leg
  ];

  poseCtx.strokeStyle = 'rgba(79,195,247,0.7)';
  poseCtx.lineWidth   = 2;

  for (const [a, b] of CONNECTIONS) {
    const la = landmarks[a], lb = landmarks[b];
    if (!la || !lb) continue;
    poseCtx.beginPath();
    poseCtx.moveTo(la.x * poseCanvas.width, la.y * poseCanvas.height);
    poseCtx.lineTo(lb.x * poseCanvas.width, lb.y * poseCanvas.height);
    poseCtx.stroke();
  }

  // Draw keypoints — wrists get a larger yellow highlight
  for (let i = 0; i < landmarks.length; i++) {
    const l = landmarks[i];
    const isWrist = (i === 15 || i === 16);
    poseCtx.beginPath();
    poseCtx.arc(l.x * poseCanvas.width, l.y * poseCanvas.height, isWrist ? 6 : 3, 0, Math.PI * 2);
    poseCtx.fillStyle = isWrist ? '#ffee58' : 'rgba(79,195,247,0.9)';
    if (isWrist) {
      poseCtx.strokeStyle = 'rgba(255,238,88,0.5)';
      poseCtx.lineWidth = 2;
      poseCtx.stroke();
      poseCtx.lineWidth = 2;
    }
    poseCtx.fill();
  }
}

let lastVideoTime = -1;

/** Runs MediaPipe inference on every new video frame. */
function poseDetectionLoop() {
  const video = document.getElementById('camVideo');
  if (!poseLandmarker || video.readyState < 2) {
    requestAnimationFrame(poseDetectionLoop);
    return;
  }

  // Keep overlay canvas in sync with the video resolution
  if (poseCanvas.width !== video.videoWidth || poseCanvas.height !== video.videoHeight) {
    poseCanvas.width  = video.videoWidth  || 640;
    poseCanvas.height = video.videoHeight || 480;
  }

  const now = performance.now();

  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = poseLandmarker.detectForVideo(video, now);

    // FPS counter
    poseFrameCount++;
    if (now - poseFrameTs > 1000) {
      poseFps = poseFrameCount;
      poseFrameCount = 0;
      poseFrameTs = now;
      document.getElementById('stat-fps').textContent = poseFps;
    }

    if (result.landmarks && result.landmarks.length > 0) {
      const landmarks = result.landmarks[0];
      drawPoseSkeleton(landmarks);
      detectFlap(landmarks, now);
    } else {
      poseCtx.clearRect(0, 0, poseCanvas.width, poseCanvas.height);
    }
  }

  requestAnimationFrame(poseDetectionLoop);
}

/**
 * Detects a "flap" gesture by tracking the average Y position of both wrists.
 *
 * How it works:
 *  1. Each frame, compute avgWristY = (leftWrist.y + rightWrist.y) / 2
 *     (Y is normalised 0-1; 0 = top of frame, 1 = bottom)
 *  2. Apply a short rolling average (WRIST_WINDOW frames) to reduce jitter.
 *  3. Compute delta = prevSmoothedY - currentSmoothedY
 *     A positive delta means the wrists moved UP.
 *  4. If delta > JUMP_THRESHOLD, trigger flap().
 */
function detectFlap(landmarks, now) {
  const lwrist = landmarks[15]; // Left wrist
  const rwrist = landmarks[16]; // Right wrist
  if (!lwrist || !rwrist) return;

  const wristY = (lwrist.y + rwrist.y) / 2;

  wristHistory.push(wristY);
  if (wristHistory.length > WRIST_WINDOW) wristHistory.shift();
  const smoothWristY = wristHistory.reduce((a, b) => a + b, 0) / wristHistory.length;

  if (prevWristY === null) { prevWristY = smoothWristY; return; }

  const delta = prevWristY - smoothWristY; // positive → wrists moved UP
  prevWristY = smoothWristY;

  if (delta > JUMP_THRESHOLD && now - lastJumpTime > JUMP_COOLDOWN_MS) {
    lastJumpTime = now;
    if (gameState === 'dead') { initGame(); gameState = 'waiting'; }
    flap();
  }
}

// ─────────────────────────────────────────────
//  BOOT SEQUENCE
// ─────────────────────────────────────────────
async function boot() {
  try {
    setLoading(5, 'Cargando sprites…');
    await loadAllAssets();

    setLoading(60, 'Preparando MediaPipe…');
    await initMediaPipe();

    setLoading(85, 'Iniciando cámara…');
    await startCamera();

    setLoading(100, '¡Listo!');

    document.getElementById('stat-best').textContent = bestScore;
    initGame();

    // Fade out loading overlay
    await new Promise(r => setTimeout(r, 400));
    const overlay = document.getElementById('loading-overlay');
    overlay.style.transition = 'opacity 0.5s';
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 500);

    // Start game and pose loops
    gameLoop();
    poseDetectionLoop();

  } catch (err) {
    document.getElementById('loading-msg').textContent = '❌ Error: ' + err.message;
    console.error(err);
  }
}

boot();
