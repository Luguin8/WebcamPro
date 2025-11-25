🚀 AirwiLens - Roadmap hacia la versión 2.0

Este documento detalla las mejoras planificadas, la deuda técnica y las investigaciones necesarias para llevar AirwiLens al siguiente nivel.

✅ Estado Actual (v1.0)

Video: Funcional estable a 24 FPS (720p) vía TCP/WebSockets.

Latencia: Baja (~100-200ms) gracias al buffer agresivo y procesamiento nativo.

Control: Bidireccional (Zoom, Flash, Rotación) desde PC.

Audio: Interfaz lista, pero sin transmisión real de audio.

Drivers: Dependencia externa de OBS Studio.

🛠️ Mejoras Técnicas Necesarias (v2.0)

1. Transmisión de Audio Real 🎙️

Objetivo: Lograr que el audio del micrófono del celular suene en el "CABLE Input" de la PC con < 200ms de latencia.

Estrategia A (Difícil pero ideal): Implementar WebRTC. WebRTC maneja audio y video sincronizados y se adapta al ancho de banda.

Desafío: Requiere un servidor de señalización (Signaling Server) más complejo que el WebSocket actual.

Estrategia B (Hack): Usar un socket UDP paralelo solo para audio. Enviar paquetes PCM crudos (Raw Bytes) desde Kotlin/Java directo al socket, saltando el puente de JS.

2. Eliminación de la Dependencia de OBS 🚫

Objetivo: Que el usuario instale AirwiLens y listo. Sin instalar OBS aparte.

Solución: Integrar un driver de cámara virtual ligero y propio.

Candidato: AkVirtualCamera o UnityCapture.

Tarea: Crear un instalador .msi o Inno Setup que instale y registre este driver .sys silenciosamente.

3. Protocolo de Transporte: UDP vs TCP ⚡

Problema actual: TCP (WebSockets) reintenta paquetes perdidos, causando "jitter" (acelerones) si el Wi-Fi es inestable.

Mejora: Cambiar a UDP.

UDP no reintenta. Si se pierde un frame, se pierde y ya. Esto elimina el lag acumulado y los acelerones.

Implementación: Requiere usar react-native-udp en el móvil y socket (DGRAM) en Python.

4. Descubrimiento Automático (Zeroconf) 🔍

Problema actual: El usuario debe escribir la IP manualmente.

Mejora: Implementar mDNS/Bonjour.

El celular debería "escanear" la red y encontrar la PC automáticamente.

Al abrir la app, mostraría una lista: "PC de Martín encontrada". Tocar y conectar.

5. Calidad Adaptativa (Bitrate Control) 📉

Mejora: Si la red está lenta, bajar automáticamente la calidad del JPEG (de 70 a 50) o la resolución, en lugar de perder frames.

Cómo: El servidor Python mide cuántos frames llegan por segundo. Si bajan de 20, le manda un comando al celular: {"type": "QUALITY", "value": "LOW"}.

❓ Dudas Técnicas a Investigar (R&D)

¿Es posible usar USB Tethering (ADB) como fallback automático?

Duda: Si el Wi-Fi es malo, ¿podemos detectar si se conecta el cable USB y enrutar el tráfico por ahí (adb reverse) automáticamente sin que el usuario configure nada?

¿Cómo firmar digitalmente un Driver en Windows?

Duda: Para crear nuestro propio driver de cámara virtual (sin OBS), Microsoft exige una firma digital (EV Certificate) que cuesta dinero anual. ¿Existe alguna forma open-source legal de saltar esto o usar un driver genérico pre-firmado?

Sincronización A/V (Lip Sync)

Duda: Si el video va por TCP y el audio por UDP, llegarán desfasados. ¿Cómo implementamos un buffer de sincronización (Jitter Buffer) en Python para que la boca coincida con la voz? (Esto es difícil, WebRTC lo resuelve gratis).

Background Service en Android

Duda: Actualmente, si minimizas la app, el sistema operativo puede matar la cámara para ahorrar energía. ¿Necesitamos implementar un "Foreground Service" con notificación persistente en Android nativo para garantizar que la transmisión no se corte nunca, incluso con la pantalla bloqueada?

📝 Notas de Desarrollo

Código Nativo: Cualquier cambio en android/ requiere npx expo run:android.

Puertos: El puerto 5000 a veces está ocupado por AirPlay en Mac. Considerar moverlo al 5555 o hacerlo configurable.

Seguridad: Actualmente la transmisión no está encriptada. Cualquiera en el Wi-Fi podría "ver" el stream si sabe la IP y puerto. Para v2.0, considerar WSS (WebSocket Secure) con certificados autofirmados.