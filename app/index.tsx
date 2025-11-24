import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Battery from 'expo-battery';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { Camera, runAtTargetFps, useCameraDevice, useCameraFormat, useFrameProcessor, VisionCameraProxy } from 'react-native-vision-camera';
import { useSharedValue, Worklets } from 'react-native-worklets-core';

// Plugin Nativo
const plugin = VisionCameraProxy.initFrameProcessorPlugin('getBase64');

export default function App() {
  // Estado de la UI
  const [ipAddress, setIpAddress] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [screenDark, setScreenDark] = useState(false); // Ahorro de batería

  // Estado de la Cámara (Controlado por PC)
  const [cameraActive, setCameraActive] = useState(true);
  const [flash, setFlash] = useState<'on' | 'off'>('off');
  const [zoom, setZoom] = useState(1.0);
  const [position, setPosition] = useState<'front' | 'back'>('back');

  const device = useCameraDevice(position);
  const format = useCameraFormat(device, [{ videoResolution: { width: 1280, height: 720 } }, { fps: 30 }]);

  const ws = useRef<WebSocket | null>(null);
  const isSocketOpen = useSharedValue(false);

  // 1. Cargar IP guardada y permisos al inicio
  useEffect(() => {
    (async () => {
      const p = await Camera.requestCameraPermission();
      setHasPermission(p === 'granted');

      const savedIp = await AsyncStorage.getItem('saved_ip');
      if (savedIp) setIpAddress(savedIp);
    })();
  }, []);

  // 2. Loop de Batería
  useEffect(() => {
    if (!isConnected) return;
    const interval = setInterval(async () => {
      if (ws.current?.readyState === WebSocket.OPEN) {
        const level = await Battery.getBatteryLevelAsync();
        ws.current.send(JSON.stringify({ type: 'BATTERY', value: Math.round(level * 100) }));
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [isConnected]);

  // --- LÓGICA DE CONEXIÓN ---
  const handleConnect = async () => {
    if (!ipAddress) return;
    setIsConnecting(true);
    Keyboard.dismiss();

    // Guardar IP para la próxima
    await AsyncStorage.setItem('saved_ip', ipAddress);

    try {
      console.log(`Conectando a ws://${ipAddress}:5000`);
      ws.current = new WebSocket(`ws://${ipAddress}:5000`);

      ws.current.onopen = () => {
        setIsConnecting(false);
        setIsConnected(true);
        isSocketOpen.value = true;
      };

      ws.current.onmessage = (e) => {
        try {
          const cmd = JSON.parse(e.data);
          switch (cmd.type) {
            case 'FLASH': setFlash(cmd.value); break;
            case 'FLIP': setPosition(cmd.value); break;
            case 'VIDEO_TOGGLE': setCameraActive(cmd.value); break;
            case 'ZOOM': setZoom(cmd.value); break;
          }
        } catch (err) { }
      };

      ws.current.onclose = () => {
        handleDisconnect();
      };

      ws.current.onerror = () => {
        setIsConnecting(false);
        alert("No se pudo conectar. Revisa la IP y el Firewall de la PC.");
      };

    } catch (e) {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    isSocketOpen.value = false;
    ws.current?.close();
    setIsConnected(false);
    setIsConnecting(false);
    setCameraActive(true); // Resetear estado
  };

  // --- FRAME PROCESSOR ---
  const sendFrame = Worklets.createRunOnJS((b64: string) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(b64);
  });

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (!isSocketOpen.value) return;
    runAtTargetFps(30, () => {
      if (plugin && cameraActive) {
        const b64 = plugin.call(frame) as string;
        if (b64) sendFrame(b64);
      }
    });
  }, [cameraActive]); // Dependencia importante: si cameraActive es false, deja de procesar

  // --- RENDER ---
  if (!hasPermission) return <View style={styles.center}><Text style={styles.text}>Faltan permisos</Text></View>;

  // VISTA 1: FORMULARIO DE CONEXIÓN
  if (!isConnected) {
    return (
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.container}>
          <StatusBar barStyle="light-content" />
          <Text style={styles.title}>WebcamPro</Text>
          <Text style={styles.subtitle}>Convierte tu celular en una webcam HD</Text>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>IP de la PC:</Text>
            <TextInput
              style={styles.input}
              placeholder="Ej: 192.168.1.5"
              placeholderTextColor="#666"
              keyboardType="numeric"
              value={ipAddress}
              onChangeText={setIpAddress}
            />
          </View>

          <TouchableOpacity style={styles.btn} onPress={handleConnect} disabled={isConnecting}>
            {isConnecting ? <ActivityIndicator color="black" /> : <Text style={styles.btnText}>CONECTAR</Text>}
          </TouchableOpacity>

          <Text style={styles.hint}>Asegúrate de que ambos estén en el mismo Wi-Fi</Text>
        </View>
      </TouchableWithoutFeedback>
    );
  }

  // VISTA 2: CÁMARA ACTIVA
  return (
    <View style={[styles.container, screenDark && styles.darkContainer]}>
      <StatusBar hidden />

      {/* Si screenDark es true, ocultamos la cámara visualmente pero sigue corriendo de fondo */}
      {!screenDark && device && (
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          format={format}
          isActive={true} // Siempre activa para el procesador, aunque no mandemos data
          frameProcessor={frameProcessor}
          pixelFormat="yuv"
          torch={flash}
          zoom={zoom}
          enableZoomGesture={true}
        />
      )}

      {/* Interfaz Sobrepuesta */}
      <View style={styles.overlay}>
        <View style={styles.statusRow}>
          <View style={[styles.dot, isConnected ? styles.dotGreen : styles.dotRed]} />
          <Text style={styles.statusText}>{cameraActive ? "Transmitiendo" : "Solo Audio / Standby"}</Text>
        </View>

        <View style={styles.controlsRow}>
          <TouchableOpacity style={styles.controlBtn} onPress={() => setScreenDark(!screenDark)}>
            <Text style={styles.controlText}>{screenDark ? "💡 Ver" : "🌑 Oscurecer"}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.controlBtn, styles.btnDisconnect]} onPress={handleDisconnect}>
            <Text style={styles.controlText}>Desconectar</Text>
          </TouchableOpacity>
        </View>
      </View>

      {screenDark && (
        <View style={styles.center}>
          <Text style={styles.text}>Ahorro de Batería Activo</Text>
          <Text style={{ color: '#666', marginTop: 10 }}>Toca "💡 Ver" para restaurar</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212', justifyContent: 'center', alignItems: 'center' },
  darkContainer: { backgroundColor: 'black' },
  center: { justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 32, fontWeight: 'bold', color: 'white', marginBottom: 10 },
  subtitle: { fontSize: 16, color: '#888', marginBottom: 40 },
  inputContainer: { width: '80%', marginBottom: 20 },
  label: { color: 'white', marginBottom: 5, marginLeft: 5 },
  input: { backgroundColor: '#222', color: 'white', borderRadius: 10, padding: 15, fontSize: 18, borderWidth: 1, borderColor: '#333' },
  btn: { backgroundColor: '#00ff00', paddingVertical: 15, paddingHorizontal: 40, borderRadius: 25, width: '80%', alignItems: 'center' },
  btnDisconnect: { backgroundColor: '#ff4444' },
  btnText: { fontSize: 18, fontWeight: 'bold', color: 'black' },
  hint: { color: '#555', marginTop: 20, fontSize: 12 },
  text: { color: 'white' },

  // Overlay Styles
  overlay: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, backgroundColor: 'rgba(0,0,0,0.6)' },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  dotGreen: { backgroundColor: '#00ff00' },
  dotRed: { backgroundColor: 'red' },
  statusText: { color: 'white', fontWeight: 'bold' },
  controlsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  controlBtn: { padding: 10, backgroundColor: '#333', borderRadius: 8, minWidth: 100, alignItems: 'center' },
  controlText: { color: 'white', fontWeight: 'bold' }
});