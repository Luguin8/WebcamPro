import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import * as RNFS from 'react-native-fs';
import { Camera, CameraPosition, useCameraDevice, useCameraFormat } from 'react-native-vision-camera'; // <--- IMPORTANTE: Agregamos useCameraFormat

// ⚠️ IMPORTANTE: TU IP
const PC_IP = '192.168.1.2';
const PORT = 5000;

type Command =
  | { type: 'FLASH'; value: 'on' | 'off' }
  | { type: 'FLIP'; value: CameraPosition }
  | { type: 'VIDEO_TOGGLE'; value: boolean }
  | { type: 'ZOOM'; value: number };

export default function WebcamApp() {
  const [cameraPosition, setCameraPosition] = useState<CameraPosition>('back');
  const [flash, setFlash] = useState<'on' | 'off'>('off');
  const [isActive, setIsActive] = useState<boolean>(true);
  const [zoom, setZoom] = useState<number>(1.0);
  const [hasPermission, setHasPermission] = useState<boolean>(false);

  const device = useCameraDevice(cameraPosition);

  // --- NUEVO: BUSCAR FORMATO 720p a 60FPS ---
  // Esto hace que la cámara funcione nativamente en HD, no en 4K
  const format = useCameraFormat(device, [
    { videoResolution: { width: 1280, height: 720 } },
    { fps: 60 }
  ]);

  const ws = useRef<WebSocket | null>(null);
  const camera = useRef<Camera>(null);

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
    })();
    connectWebSocket();
    return () => { ws.current?.close(); };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const startStreaming = async () => {
      if (!isMounted || !isActive || !camera.current || !ws.current || ws.current.readyState !== WebSocket.OPEN) {
        if (isMounted && isActive) setTimeout(startStreaming, 50); // Bajamos espera a 50ms para más fluidez
        return;
      }

      try {
        const photo = await camera.current.takePhoto({
          qualityPrioritization: 'speed',
          flash: 'off',
          enableShutterSound: false,
          quality: 85, // Calidad JPEG
          skipMetadata: true
        });

        const base64 = await RNFS.readFile(photo.path, 'base64');

        if (ws.current.readyState === WebSocket.OPEN) {
          ws.current.send(base64);
        }
        await RNFS.unlink(photo.path);

      } catch (e) {
        console.log("Error en stream:", e);
      }

      if (isMounted && isActive) {
        // requestAnimationFrame intenta ir a los fps de la pantalla (60fps)
        requestAnimationFrame(startStreaming);
      }
    };

    if (isActive) startStreaming();
    return () => { isMounted = false; };
  }, [isActive]);

  const connectWebSocket = () => {
    console.log(`Intentando conectar a ws://${PC_IP}:${PORT}...`);
    ws.current = new WebSocket(`ws://${PC_IP}:${PORT}`);

    ws.current.onopen = () => console.log("✅ Conectado a la PC");

    ws.current.onmessage = (e) => {
      try {
        const command: Command = JSON.parse(e.data);
        console.log("CMD:", command);
        switch (command.type) {
          case 'FLASH': setFlash(command.value); break;
          case 'FLIP': setCameraPosition(command.value); break;
          case 'VIDEO_TOGGLE': setIsActive(command.value); break;
          case 'ZOOM': setZoom(command.value); break;
        }
      } catch (err) { }
    };

    ws.current.onclose = () => setTimeout(connectWebSocket, 2000);
  };

  if (!hasPermission || device == null) return <ActivityIndicator size="large" style={styles.center} />;

  return (
    <View style={styles.container}>
      {isActive ? (
        <Camera
          ref={camera}
          style={StyleSheet.absoluteFill}
          device={device}
          format={format} // <--- AQUI APLICAMOS EL FORMATO OPTIMIZADO
          isActive={isActive}
          torch={flash}
          zoom={zoom}
          photo={true}
          video={false}
          enableZoomGesture={true}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.blackScreen]}>
          <Text style={styles.text}>Pausado</Text>
        </View>
      )}

      <View style={styles.overlay}>
        <Text style={styles.overlayText}>
          {isActive ? `🟢 ONLINE` : "🔴 OFFLINE"}
        </Text>
        <Text style={styles.overlaySubText}>
          {format?.videoWidth}x{format?.videoHeight} @ {Math.round(format?.maxFps || 0)} FPS
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  center: { flex: 1, backgroundColor: 'black', justifyContent: 'center', alignItems: 'center' },
  blackScreen: { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  text: { color: 'white', fontSize: 18, fontWeight: 'bold' },
  overlay: { position: 'absolute', bottom: 50, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.6)', padding: 10, borderRadius: 20, alignItems: 'center' },
  overlayText: { color: '#00ff00', fontWeight: 'bold', fontSize: 16 },
  overlaySubText: { color: 'white', fontSize: 12 },
});