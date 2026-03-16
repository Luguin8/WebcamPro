# AirwiLens 📱→🖥️

> **Convierte tu smartphone en una webcam profesional vía red local.**
> AirwiLens es una aplicación **React Native** que captura video en tiempo real desde la cámara nativa del dispositivo móvil y lo transmite, frame a frame, a una PC a través de WebSockets en la LAN. Un servidor de escritorio en Python recibe el stream, lo renderiza en pantalla y lo inyecta como una **cámara virtual** compatible con Zoom, Google Meet, OBS y cualquier software de videoconferencia.

---

## 🛠️ Tecnologías y Stack

### Cliente Mobile — React Native
| Tecnología | Versión | Rol |
|---|---|---|
| React Native | `0.81.5` | Framework UI multiplataforma (Android / iOS) |
| Expo | `~54.0.25` | Toolchain de build y gestión nativa (EAS Build) |
| Expo Router | `~6.0.15` | Navegación basada en sistema de archivos |
| **react-native-vision-camera** | `^4.7.3` | Acceso directo al hardware de cámara nativa (API C++) |
| react-native-worklets-core | `^1.6.2` | Ejecución de Frame Processors en hilo nativo (`worklet`) |
| expo-battery | `~10.0.7` | Telemetría de batería en tiempo real |
| expo-av | `~16.0.7` | Gestión de permisos y sesión de audio |
| AsyncStorage | `2.2.0` | Persistencia de la IP del servidor entre sesiones |
| `WebSocket` (nativo RN) | — | Canal de comunicación bidireccional con el servidor |

### Servidor Desktop — Python
| Tecnología | Rol |
|---|---|
| **Python 3** | Runtime del servidor de escritorio |
| `websockets` (asyncio) | WebSocket Server asíncrono — recibe frames del móvil |
| `OpenCV (cv2)` | Decodificación y procesamiento de frames JPEG (Base64 → numpy → BGR) |
| `pyvirtualcam` | Driver de cámara virtual (requiere OBS Virtual Camera instalado) |
| `Tkinter` | GUI de control nativa — visualiza el stream y envía comandos al móvil |
| `PIL / Pillow` | Conversión de frames OpenCV a imagen compatible con Tkinter |
| `threading + asyncio` | Arquitectura concurrente: event loop de I/O separado del hilo de UI |
| `NumPy` | Manipulación de arrays de frames (letterboxing, rotaciones) |

---

## ✨ Funcionalidades Principales

### 📹 Captura de Cámara Nativa con Frame Processor
La captura de video no utiliza ningún puente JavaScript genérico. Se implementa mediante un **Frame Processor Plugin nativo** (`getBase64`) registrado a través de `VisionCameraProxy`, que opera directamente en el hilo de la cámara de alto rendimiento:

```tsx
// app/index.tsx
const plugin = VisionCameraProxy.initFrameProcessorPlugin('getBase64');

const frameProcessor = useFrameProcessor((frame) => {
  'worklet'; // Ejecuta en el hilo nativo, sin bloquear JS
  if (!isSocketOpen.value) return;
  runAtTargetFps(24, () => {
    const b64 = plugin.call(frame) as string;
    if (b64) sendFrame(b64); // Cross-thread bridge via Worklets
  });
}, [cameraActive]);
```

El formato de video se negocia directamente con el hardware:
```tsx
const format = useCameraFormat(device, [
  { videoResolution: { width: 1280, height: 720 } },
  { fps: 24 }
]);
```

### 🌐 Transmisión de Video vía WebSocket (LAN)
Cada frame capturado es codificado como **JPEG en Base64** y enviado por WebSocket al servidor Python. El diseño garantiza que el socket JS nunca bloquee el procesamiento de la cámara:

```tsx
// Bridge cross-thread: expone la función del hilo JS al worklet
const sendFrame = Worklets.createRunOnJS((b64: string) => {
  if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(b64);
});
```

### 🖥️ Control Remoto Bidireccional
El servidor Python actúa también como **controlador maestro**: envía comandos JSON al móvil para cambiar el estado de la cámara en tiempo real. El protocolo define los siguientes tipos de mensaje:

| Comando (`type`) | `value` | Efecto en el móvil |
|---|---|---|
| `FLASH` | `"on"` / `"off"` | Activa/desactiva la linterna LED |
| `FLIP` | `"front"` / `"back"` | Cambia entre cámara frontal y trasera |
| `VIDEO_TOGGLE` | `true` / `false` | Pausa el stream de video (modo solo audio) |
| `MIC_TOGGLE` | `true` / `false` | Activa/desactiva el micrófono |
| `ZOOM` | `1.0` – `5.0` | Controla el zoom óptico/digital nativo |

El móvil también **reporta datos al servidor** (telemetría inversa):

| Mensaje | Frecuencia | Contenido |
|---|---|---|
| `BATTERY` | Cada 10 segundos | Nivel de batería (`0–100`) |

### 🔋 Modo Ahorro de Energía
La UI implementa un modo `screenDark` que oscurece completamente la pantalla del móvil mientras mantiene la transmisión activa, reduciendo el consumo de batería durante sesiones largas.

### 💾 Persistencia de IP con AsyncStorage
La IP del servidor PC se guarda automáticamente en `AsyncStorage` y se recupera al relanzar la app, eliminando la necesidad de reconfiguración manual en cada sesión.

---

## 🏗️ Arquitectura de Red e Integración Mobile-Desktop

```
┌─────────────────────────────────────┐       Wi-Fi LAN (TCP/WebSocket)      ┌──────────────────────────────────────────┐
│        CLIENTE  (Android/iOS)        │ ─────────────────────────────────── │           SERVIDOR  (Windows PC)          │
│                                     │                                       │                                          │
│  ┌──────────────────────────────┐   │   Frame JPEG (Base64) → ws.send()   │  ┌────────────────────────────────────┐   │
│  │  react-native-vision-camera  │   │ ─────────────────────────────────►  │  │   asyncio WebSocket Server         │   │
│  │  (hilo nativo C++)           │   │                                       │  │   websockets.serve(:5000)          │   │
│  │  useFrameProcessor (worklet) │   │  ◄─────────────────────────────────  │  │                                    │   │
│  └──────────────────────────────┘   │   Comando JSON ← handler.send()     │  └────────────────┬───────────────────┘   │
│             │ Worklets bridge        │                                       │                  │ frame_queue            │
│             ▼                        │                                       │                  ▼                       │
│  ┌──────────────────────────────┐   │                                       │  ┌───────────────────────────────────┐   │
│  │  WebSocket (JS thread)       │   │                                       │  │  OpenCV: base64 → JPEG → BGR Mat │   │
│  │  ws.current (useRef)         │   │                                       │  └───────────────┬───────────────────┘   │
│  └──────────────────────────────┘   │                                       │                  │                        │
│                                     │                                       │         ┌────────┴───────────┐           │
│  Estado controlado remotamente:     │                                       │         │                    │           │
│  • cameraPosition (front/back)      │                                       │  ┌──────▼──────┐   ┌────────▼──────────┐ │
│  • flash (on/off)                   │                                       │  │ Tkinter GUI │   │  pyvirtualcam     │ │
│  • zoom (1.0 – 5.0)                 │                                       │  │ (preview)   │   │  (OBS VirtualCam) │ │
│  • cameraActive + micActive         │                                       │  └─────────────┘   └───────────────────┘ │
└─────────────────────────────────────┘                                       └──────────────────────────────────────────┘
```

### Detalles del Pipeline de Video (Servidor)

El servidor Python implementa un pipeline de procesamiento de frames con las siguientes etapas:

1. **Recepción async**: El handler `websockets` recibe el mensaje. Si tiene más de 1000 bytes, se trata como un frame de video; de lo contrario, como un comando JSON (telemetría).
2. **Decodificación**: `base64.b64decode` → `np.frombuffer` → `cv2.imdecode` produce un array BGR de NumPy.
3. **Buffer con descarte inteligente**: `queue.Queue(maxsize=1)` garantiza que siempre se muestra el frame más reciente, descartando los anteriores para minimizar la latencia percibida.
4. **Rotación**: Soporte para 4 orientaciones (0°, 90°, 180°, 270°) con `cv2.rotate`.
5. **Letterboxing para cámara virtual**: El frame se escala con aspect ratio preservado y se centra con bordes negros sobre un canvas `1280×720` antes de enviarlo a `pyvirtualcam` — evitando imágenes distorsionadas en Zoom/Meet.
6. **Renderizado en GUI**: El mismo frame se redimensiona de forma independiente para ajustarse al `Label` de Tkinter, con recálculo dinámico del tamaño del widget.

### Protocolo de Transporte

- **Transporte**: TCP vía WebSocket (texto para comandos JSON, texto Base64 para frames)
- **Puerto**: `5000` (configurable)
- **Dirección de frames**: Móvil → PC (flujo unidireccional de datos pesados)
- **Dirección de comandos**: PC → Móvil (bidireccional ligero)
- **Reconexión automática**: El cliente implementa un retry con `setTimeout(connectWebSocket, 2000)` ante cierre del socket.
- **Latencia objetivo**: ~100–200 ms en red Wi-Fi local estable

---

## 🚀 Instalación Local

### Requisitos Previos
- Node.js ≥ 18 y npm
- Python 3.10+
- Expo CLI: `npm install -g expo-cli`
- [OBS Studio](https://obsproject.com/) con el plugin **OBS Virtual Camera** instalado (necesario para `pyvirtualcam`)
- Dispositivo Android/iOS físico en la **misma red Wi-Fi** que la PC

---

### 1. App Móvil (React Native / Expo)

```bash
# Clonar el repositorio
git clone <url-del-repo>
cd WebcamPro

# Instalar dependencias JS
npm install

# Preparar build nativo (necesario para react-native-vision-camera)
npx expo run:android   # Para Android
# o
npx expo run:ios       # Para iOS (requiere macOS + Xcode)
```

> **Importante**: Esta app utiliza **módulos nativos** (`react-native-vision-camera` con el plugin de Frame Processor). No funciona con `expo start` + Expo Go; se requiere un **development build** o una release APK.

#### Configurar la IP del servidor
Editar la constante `PC_IP` en `App.js` (si se usa la versión legacy):
```js
const PC_IP = '192.168.1.XX'; // Reemplazar con la IP local de la PC
```
En la versión principal (`app/index.tsx`), la IP se ingresa directamente desde la UI de la app.

---

### 2. Servidor Python (Desktop)

```bash
cd Python

# Crear entorno virtual (recomendado)
python -m venv .venv
.venv\Scripts\activate   # Windows
source .venv/bin/activate # macOS/Linux

# Instalar dependencias
pip install websockets opencv-python numpy pillow pyvirtualcam
```

> `pyvirtualcam` requiere que **OBS Studio** esté instalado con el módulo de cámara virtual activo. En Windows, activarlo desde: `Herramientas → VirtualCam → Iniciar`.

```bash
# Iniciar el servidor
python server_gui.py
```

La GUI mostrará la IP local de la PC (ej. `192.168.1.5`). Ingresar esa IP en la app móvil y presionar **CONECTAR CÁMARA**.

---

## 📋 Estado del Proyecto — Roadmap

| Funcionalidad | Estado |
|---|---|
| Streaming de video 720p @ 24 FPS | ✅ Estable |
| Control remoto (Flash, Zoom, Flip, Video ON/OFF) | ✅ Estable |
| Telemetría de batería del móvil | ✅ Implementado |
| Inyección como cámara virtual (vía OBS + pyvirtualcam) | ✅ Funcional |
| Modo ahorro de energía (pantalla oscura) | ✅ Implementado |
| Persistencia de IP (AsyncStorage) | ✅ Implementado |
| Streaming de audio real bidireccional | 🚧 En investigación (WebRTC vs. UDP) |
| Descubrimiento automático por mDNS/Bonjour | 📋 Planificado (v2.0) |
| Transporte UDP para menor jitter | 📋 Planificado (v2.0) |
| Driver de cámara virtual propio (sin OBS) | 📋 Investigación (firma digital EV) |
| Bitrate adaptativo por calidad de red | 📋 Planificado (v2.0) |
| Encriptación del stream (WSS/TLS) | 📋 Planificado (v2.0) |

---

## 👤 Autor

Desarrollado por **Martín Lugo** — [@luuguin](https://x.com/luuguin)

¿Te resulta útil? [☕ Invitame un café](https://paypal.me/lugomartin)