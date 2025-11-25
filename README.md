📸 AirwiLens

Transforma tu Android en una Webcam de Alta Definición para PC vía Wi-Fi.
Cero cables. Baja latencia. Control total.

💡 ¿Qué es AirwiLens?

AirwiLens es una solución de código abierto que convierte tu smartphone en una cámara web inalámbrica de alto rendimiento. A diferencia de otras apps, AirwiLens se enfoca en la transmisión de baja latencia utilizando procesamiento nativo (C++/Kotlin) en el dispositivo móvil y un servidor ligero en Python para la PC.

✨ Características Principales

🚀 High Performance: Procesamiento de imagen nativo usando JSI y Worklets (evitando el puente de JS).

📡 100% Inalámbrico: Transmisión vía Wi-Fi (TCP/WebSockets) con reconexión automática.

🎛️ Centro de Control en PC: Panel de escritorio para controlar el celular remotamente:

Zoom Digital.

Flash (Linterna).

Giro de cámara (Frontal/Trasera).

Rotación de vista (0°, 90°, 180°, 270°).

🔋 Modo Ahorro de Energía: "Modo Oscuro" real que apaga los píxeles de la pantalla del celular sin cortar la transmisión.

🎙️ Modo Solo Micrófono: Opción para transmitir solo audio y datos, ahorrando ancho de banda.

📊 Monitoreo en Tiempo Real: Visualización del estado de la batería del celular desde la PC.

🛠️ Stack Tecnológico

📱 Cliente Móvil (Android)

Framework: React Native (Expo Dev Client).

Cámara: react-native-vision-camera (V4).

Motor de Procesamiento: Plugin nativo personalizado escrito en Kotlin para compresión YUV -> JPEG en memoria RAM (Cero disco I/O).

Multithreading: react-native-worklets-core para separar el hilo de UI del hilo de video.

💻 Servidor PC (Windows)

Lenguaje: Python 3.x.

GUI: Tkinter (con diseño responsivo y manejo de hilos seguro).

Red: websockets (Asyncio).

Video: OpenCV (cv2) + Pillow para renderizado de alta velocidad.

Arquitectura: Patrón Productor-Consumidor con colas (Queue) para desacoplar la recepción de red del renderizado de video y evitar "congelamientos".

🚀 Instalación y Uso

Prerrequisitos

Node.js y NPM.

Python 3.10 o superior.

Un dispositivo Android conectado a la misma red Wi-Fi que la PC.

1. Configurar el Servidor (PC)

cd Python
pip install -r requirements.txt  # (Asegúrate de tener opencv-python, websockets, pillow)
python server_gui.py


Verás tu dirección IP en la pantalla. Anótala.

2. Configurar la App (Móvil)

# Instalar dependencias
npm install

# Compilar la versión nativa (Necesario la primera vez)
npx expo run:android


Abre la App AirwiLens en tu celular.

Ingresa la IP que muestra el servidor de Python.

¡Disfruta!

🤝 Contribuciones

¡Las contribuciones son bienvenidas! Si tienes ideas para mejorar la latencia usando UDP o crear un driver virtual para Windows, abre un Issue o un Pull Request.

📄 Licencia

Este proyecto está bajo la Licencia MIT - siéntete libre de usarlo y modificarlo.

Desarrollado con ❤️ por Martín Lugo