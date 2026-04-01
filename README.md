# 🐦 Flappy Bird + MediaPipe

Un clon de **Flappy Bird** jugado completamente con el cuerpo: **aletea los brazos** frente a la cámara y el pájaro vuela. Sin teclado, sin mouse.

Construido con HTML5 Canvas, JavaScript vanilla y **MediaPipe Pose Landmarker**.

---

## 📸 Demo

> El pájaro vuela cuando levantás ambas muñecas hacia arriba — como si fueras el pájaro.

![Interfaz del juego](https://raw.githubusercontent.com/samuelcust/flappy-bird-assets/master/screenshot.png)

---

## 🚀 Cómo ejecutar

El juego necesita servirse desde un servidor HTTP (no desde `file://`) porque:
- El navegador bloquea `import()` dinámico en archivos locales
- La cámara (`getUserMedia`) requiere un contexto seguro (localhost o HTTPS)

### Opción 1 — Python (recomendado, sin instalar nada)
```bash
cd FlappyBird
python3 -m http.server 8765
```
Luego abrí `http://localhost:8765` en el navegador.

### Opción 2 — Node.js
```bash
npx serve .
```

### Opción 3 — VS Code
Instalá la extensión **Live Server** y hacé click en "Go Live".

---

## 🎮 Cómo jugar

| Acción | Resultado |
|--------|-----------|
| 🦅 Levantar ambos brazos rápido | El pájaro aletea hacia arriba |
| ⌨️ `SPACE` o `↑` | Aleteo por teclado (fallback) |
| 🖱️ Click en el canvas | Aleteo por mouse (fallback) |

**Tip:** Posicionáte de forma que la cámara vea tu torso completo. El gesto ideal es levantar los antebrazos de golpe, como aplaudir en el aire.

---

## 🗂️ Estructura del proyecto

```
FlappyBird/
├── index.html   # Estructura HTML y referencias a los archivos externos
├── style.css    # Estilos: layout oscuro, panel de cámara, animaciones
├── game.js      # Lógica del juego + integración con MediaPipe
└── README.md    # Este archivo
```

> Los sprites y sonidos se cargan directamente desde el repositorio público
> [`samuelcust/flappy-bird-assets`](https://github.com/samuelcust/flappy-bird-assets) — no hay assets locales.

---

## 🧠 MediaPipe: explicación técnica

### ¿Qué es MediaPipe?

[MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/guide) es un framework de ML desarrollado por Google que permite ejecutar modelos de visión por computadora directamente en el navegador, sin servidores ni backends. Utiliza **WebAssembly (WASM)** y **WebGL** para correr inferencia en la GPU del dispositivo.

### ¿Qué modelo se usa?

Se usa **Pose Landmarker Lite**, el modelo más liviano de la familia PoseLandmarker de MediaPipe Tasks Vision. Detecta **33 puntos de referencia** (landmarks) del cuerpo humano en tiempo real.

```
Modelo: pose_landmarker_lite (float16)
Fuente: Google Storage (MediaPipe Models)
Delegado: GPU (WebGL) → fallback a CPU
```

### Los 33 landmarks del cuerpo

MediaPipe devuelve coordenadas normalizadas `(x, y, z)` para cada landmark, donde:
- `x` y `y` van de `0.0` a `1.0` (esquina superior-izquierda → inferior-derecha)
- `z` representa profundidad relativa (menor = más cerca de la cámara)

Los landmarks relevantes para este juego:

| ID | Nombre | Uso en el juego |
|----|--------|-----------------|
| 15 | Left Wrist | ⭐ Punto de detección del aleteo |
| 16 | Right Wrist | ⭐ Punto de detección del aleteo |
| 11 | Left Shoulder | Skeleton visual |
| 12 | Right Shoulder | Skeleton visual |
| 13-14 | Elbows | Skeleton visual |
| 23-28 | Hips / Legs | Skeleton visual |

### ¿Cómo funciona la detección del aleteo?

El algoritmo implementado en `game.js` → `detectFlap()`:

```
┌─────────────────────────────────────────────────────┐
│                   CADA FRAME                         │
│                                                     │
│  1. Obtener Y de muñeca izquierda (landmark 15)     │
│  2. Obtener Y de muñeca derecha   (landmark 16)     │
│  3. wristY = promedio de ambas Y                    │
│                                                     │
│  4. Suavizado: rolling average de 4 frames          │
│     → Elimina jitter del modelo                     │
│                                                     │
│  5. delta = prevSmoothedY - currentSmoothedY        │
│     Si delta > 0 → las muñecas subieron             │
│                                                     │
│  6. Si delta > THRESHOLD (0.05)                     │
│     → ¡ALETEO DETECTADO! → flap()                  │
└─────────────────────────────────────────────────────┘
```

**¿Por qué Y normalizado?**
Al usar coordenadas normalizadas (0–1) en lugar de píxeles, el umbral de detección es independiente de la resolución y del tamaño de la ventana del navegador.

**¿Por qué rolling average?**
El modelo de pose puede tener variaciones de 1-2 píxeles entre frames consecutivos incluso con el cuerpo quieto. El promedio deslizante de 4 frames elimina ese ruido sin agregar latencia perceptible.

### Pipeline de procesamiento

```
Cámara (640×480) → MediaPipe WASM
                         ↓
              PoseLandmarker.detectForVideo()
                         ↓
              33 landmarks (x, y, z, visibility)
                    /           \
           drawPoseSkeleton()  detectFlap()
                    ↓                ↓
          Overlay en canvas    → flap() del pájaro
```

### Inicialización (resumen de código)

```javascript
// 1. Importar el bundle ES module de MediaPipe Tasks Vision
const { PoseLandmarker, FilesetResolver } = await import(
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/vision_bundle.mjs'
);

// 2. Cargar el runtime WASM
const vision = await FilesetResolver.forVisionTasks(
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm'
);

// 3. Crear el modelo con opciones
const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath: 'https://storage.googleapis.com/.../pose_landmarker_lite.task',
    delegate: 'GPU',  // Usa WebGL; cae a CPU si no está disponible
  },
  runningMode: 'VIDEO',   // Optimizado para frames continuos (vs IMAGE para fotos)
  numPoses: 1,
});

// 4. En cada frame del video
const result = poseLandmarker.detectForVideo(videoElement, performance.now());
const landmarks = result.landmarks[0]; // Array de 33 puntos
```

---

## ⚙️ Parámetros ajustables

Todos los parámetros del juego están agrupados como constantes al inicio de `game.js`:

```javascript
// Física del pájaro
const GRAVITY   = 0.25;   // Aceleración hacia abajo (px/frame²)
const FLAP_VEL  = -4.5;   // Velocidad inicial del aleteo (negativo = arriba)

// Tuberías
const PIPE_GAP  = 120;    // Espacio entre tubería superior e inferior (px)
const PIPE_VEL  = 2;      // Velocidad de movimiento de las tuberías (px/frame)
const PIPE_FREQ = 90;     // Frames entre aparición de tuberías nuevas

// Detección de pose
const JUMP_THRESHOLD   = 0.05;  // Delta Y mínimo para disparar un aleteo
const JUMP_COOLDOWN_MS = 0;     // Tiempo mínimo entre aleteos consecutivos (ms)
```

---

## 🛠️ Tecnologías

| Tecnología | Uso |
|------------|-----|
| **HTML5 Canvas** | Renderizado del juego (sin librerías) |
| **JavaScript (ES Modules)** | Lógica del juego + integración ML |
| **MediaPipe Tasks Vision 0.10.34** | Detección de pose en tiempo real |
| **WebAssembly (WASM)** | Runtime del modelo de ML en el navegador |
| **WebGL** | Aceleración GPU para la inferencia |
| **Web APIs** | `getUserMedia` (cámara), `requestAnimationFrame` (loop), `localStorage` (best score) |

---

## 📄 Licencia

Los assets de Flappy Bird (sprites y sonidos) pertenecen a sus respectivos autores y son usados con fines educativos. El código de este proyecto es de uso libre.
