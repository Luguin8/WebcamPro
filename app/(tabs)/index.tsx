import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import * as RNFS from 'react-native-fs'; // <--- NUEVO IMPORT
import { Camera, CameraPosition, useCameraDevice } from 'react-native-vision-camera';

// ⚠️ IMPORTANTE: Reemplaza con la IP LOCAL de tu PC
const PC_IP = '192.168.1.2';
const PORT = 5000;

// Definimos los tipos para los comandos que vienen de la PC
type Command =
  | { type: 'FLASH'; value: 'on' | 'off' }
  | { type: 'FLIP'; value: CameraPosition }
  | { type: 'VIDEO_TOGGLE'; value: boolean }
  | { type: 'ZOOM'; value: number };

export default function WebcamApp() {
  // Estados con tipos definidos explícitamente
  const [cameraPosition, setCameraPosition] = useState<CameraPosition>('back');
  const [flash, setFlash] = useState<'on' | 'off'>('off');
  const [isActive, setIsActive] = useState<boolean>(true);
  const [zoom, setZoom] = useState<number>(1.0);
  const [hasPermission, setHasPermission] = useState<boolean>(false);

  const device = useCameraDevice(cameraPosition);
  const ws = useRef<WebSocket | null>(null);
  const camera = useRef<Camera>(null); // <--- NUEVA REFERENCIA

  useEffect(() => {
    // 1. Pedir permisos al montar
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
    })();

    // 2. Conectar WebSocket
    connectWebSocket();

    // Limpieza al salir
    return () => {
      ws.current?.close();
    };
  }, []);

  // --- NUEVO: BUCLE DE TRANSMISIÓN DE VIDEO ---
  useEffect(() => {
    let isMounted = true;

    const startStreaming = async () => {
      // Condiciones para NO transmitir:
      if (!isMounted || !isActive || !camera.current || !ws.current || ws.current.readyState !== WebSocket.OPEN) {
        // Reintentar en 100ms si no está listo
        if (isMounted && isActive) setTimeout(startStreaming, 100);
        return;
      }

      try {
        // 1. Tomar foto rápida (priorizando velocidad)
        const photo = await camera.current.takePhoto({
          qualityPrioritization: 'speed',
          flash: 'off', // Forzamos flash off en la captura para no cegar, el torch es aparte
          enableShutterSound: false,
        } as any);

        // 2. Leer archivo y convertir a Base64
        const base64 = await RNFS.readFile(photo.path, 'base64');

        // 3. Enviar al PC
        if (ws.current.readyState === WebSocket.OPEN) {
          ws.current.send(base64);
        }

        // 4. Limpiar archivo temporal (muy importante para no llenar memoria)
        await RNFS.unlink(photo.path);

      } catch (e) {
        console.log("Error en stream:", e);
      }

      // Siguiente frame lo más rápido posible
      if (isMounted && isActive) {
        requestAnimationFrame(startStreaming);
      }
    };

    if (isActive) {
      startStreaming();
    }

    return () => { isMounted = false; };
  }, [isActive]); // Se reinicia si apagamos/prendemos cámara


  const connectWebSocket = () => {
    console.log(`Intentando conectar a ws://${PC_IP}:${PORT}...`);
    ws.current = new WebSocket(`ws://${PC_IP}:${PORT}`);

    ws.current.onopen = () => {
      console.log("✅ Conectado a la PC");
    };

    ws.current.onmessage = (e) => {
      try {
        const command: Command = JSON.parse(e.data);
        console.log("Comando recibido:", command);

        switch (command.type) {
          case 'FLASH':
            setFlash(command.value);
            break;
          case 'FLIP':
            setCameraPosition(command.value);
            break;
          case 'VIDEO_TOGGLE':
            setIsActive(command.value);
            break;
          case 'ZOOM':
            setZoom(command.value);
            break;
        }
      } catch (err) {
        console.error("Error al procesar comando:", err);
      }
    };

    ws.current.onclose = () => {
      console.log("❌ Desconectado. Reintentando en 2s...");
      setTimeout(connectWebSocket, 2000);
    };

    ws.current.onerror = (e) => {
      console.log("Error de conexión WebSocket");
    };
  };

  // Renderizado condicional
  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Solicitando permisos de cámara...</Text>
      </View>
    );
  }

  if (device == null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#fff" />
        <Text style={styles.text}>Cargando dispositivo de cámara...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {isActive ? (
        <Camera
          ref={camera} // <--- VINCULAMOS LA REFERENCIA
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={isActive}
          torch={flash}
          zoom={zoom}
          photo={true} // <--- IMPORTANTE: Modo foto habilitado
          video={false}
          enableZoomGesture={true}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.blackScreen]}>
          <Text style={styles.text}>Cámara Pausada</Text>
          <Text style={styles.subtext}>(Audio activo)</Text>
        </View>
      )}

      {/* Overlay con información */}
      <View style={styles.overlay}>
        <Text style={styles.overlayText}>
          {isActive ? `🟢 ONLINE: ${PC_IP}` : "🔴 OFFLINE"}
        </Text>
        <Text style={styles.overlaySubText}>
          Zoom: {zoom.toFixed(1)}x | Flash: {flash.toUpperCase()}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  center: {
    flex: 1,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
  },
  blackScreen: {
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  subtext: {
    color: '#888',
    fontSize: 14,
    marginTop: 5,
  },
  overlay: {
    position: 'absolute',
    bottom: 50,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    alignItems: 'center',
  },
  overlayText: {
    color: '#00ff00',
    fontWeight: 'bold',
    fontSize: 16,
  },
  overlaySubText: {
    color: 'white',
    fontSize: 12,
    marginTop: 4,
  },
});