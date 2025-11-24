import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  CameraPosition,
  runAtTargetFps,
  useCameraDevice,
  useCameraFormat,
  useFrameProcessor,
  VisionCameraProxy
} from 'react-native-vision-camera';
import { useSharedValue, Worklets } from 'react-native-worklets-core';

// ⚠️ TU IP
const PC_IP = '192.168.1.2';
const PORT = 5000;

type Command =
  | { type: 'FLASH'; value: 'on' | 'off' }
  | { type: 'FLIP'; value: CameraPosition }
  | { type: 'VIDEO_TOGGLE'; value: boolean }
  | { type: 'ZOOM'; value: number };

// 1. Inicializamos el plugin nativo (Kotlin) fuera del componente
const plugin = VisionCameraProxy.initFrameProcessorPlugin('getBase64');

export default function WebcamApp() {
  const [cameraPosition, setCameraPosition] = useState<CameraPosition>('back');
  const [flash, setFlash] = useState<'on' | 'off'>('off');
  const [isActive, setIsActive] = useState<boolean>(true);
  const [zoom, setZoom] = useState<number>(1.0);
  const [hasPermission, setHasPermission] = useState<boolean>(false);

  const device = useCameraDevice(cameraPosition);

  // Buscamos 720p a 30fps (Estabilidad > Resolución extrema)
  const format = useCameraFormat(device, [
    { videoResolution: { width: 1280, height: 720 } },
    { fps: 30 }
  ]);

  // SharedValue permite que el hilo de UI y el hilo de la Cámara se comuniquen
  const isConnected = useSharedValue(false);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
    })();

    connectWebSocket();
    return () => { ws.current?.close(); };
  }, []);

  const connectWebSocket = () => {
    console.log(`Conectando a ws://${PC_IP}:${PORT}...`);
    ws.current = new WebSocket(`ws://${PC_IP}:${PORT}`);

    ws.current.onopen = () => {
      console.log("✅ Conectado");
      isConnected.value = true; // Avisamos al Frame Processor que puede enviar
    };

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

    ws.current.onclose = () => {
      console.log("❌ Desconectado");
      isConnected.value = false; // Frenamos el envío
      setTimeout(connectWebSocket, 1000);
    };

    ws.current.onerror = () => {
      isConnected.value = false;
    };
  };

  // --- FUNCIÓN PUENTE (Worklet -> JS) ---
  // El socket vive en JS, el procesador en Worklet. Esto los une.
  const sendFrameToSocket = Worklets.createRunOnJS((base64: string) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(base64);
    }
  });

  // --- EL MOTOR DE ALTO RENDIMIENTO (Frame Processor) ---
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (!isConnected.value) return;

    // Limitamos a 20 FPS para no saturar el Wi-Fi (ajustable)
    runAtTargetFps(20, () => {
      if (plugin == null) return;

      // Llamada directa a KOTLIN (Cero disco duro, todo RAM)
      const base64 = plugin.call(frame) as string;

      if (base64) {
        sendFrameToSocket(base64);
      }
    });
  }, []);

  if (!hasPermission || device == null) return <ActivityIndicator size="large" style={styles.center} />;

  return (
    <View style={styles.container}>
      {isActive ? (
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          format={format}
          isActive={isActive}
          torch={flash}
          zoom={zoom}
          // pixelFormat="yuv" es vital para que el plugin de Kotlin funcione rápido
          pixelFormat="yuv"
          frameProcessor={frameProcessor} // <--- AQUÍ OCURRE LA MAGIA
          enableZoomGesture={true}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.blackScreen]}>
          <Text style={styles.text}>Pausado</Text>
        </View>
      )}

      <View style={styles.overlay}>
        <Text style={styles.overlayText}>
          {isActive && isConnected.value ? `⚡ ONLINE (NATIVE)` : "🔴 OFFLINE"}
        </Text>
        <Text style={styles.overlaySubText}>
          {format?.videoWidth}x{format?.videoHeight}
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
