import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Battery from 'expo-battery';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, View, Linking } from 'react-native';
import { Camera, runAtTargetFps, useCameraDevice, useCameraFormat, useFrameProcessor, VisionCameraProxy } from 'react-native-vision-camera';
import { useSharedValue, Worklets } from 'react-native-worklets-core';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av'; // <--- AUDIO

const plugin = VisionCameraProxy.initFrameProcessorPlugin('getBase64');

export default function App() {
  const [ipAddress, setIpAddress] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [screenDark, setScreenDark] = useState(false);

  const [cameraActive, setCameraActive] = useState(true);
  const [micActive, setMicActive] = useState(true); // Estado del Mic
  const [flash, setFlash] = useState<'on' | 'off'>('off');
  const [zoom, setZoom] = useState(1.0);
  const [position, setPosition] = useState<'front' | 'back'>('back');

  const device = useCameraDevice(position);
  const format = useCameraFormat(device, [{ videoResolution: { width: 1280, height: 720 } }, { fps: 24 }]);

  const ws = useRef<WebSocket | null>(null);
  const isSocketOpen = useSharedValue(false);
  const recording = useRef<Audio.Recording | null>(null); // Ref para grabación

  useEffect(() => {
    (async () => {
      const p = await Camera.requestCameraPermission();
      const a = await Audio.requestPermissionsAsync(); // Permiso Audio
      setHasPermission(p === 'granted' && a.status === 'granted');

      const savedIp = await AsyncStorage.getItem('saved_ip');
      if (savedIp) setIpAddress(savedIp);

      // Configurar audio para baja latencia
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
      });
    })();
  }, []);

  // Loop de Batería
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

  // --- AUDIO STREAMING LOGIC ---
  // Esto es un "hack" de streaming usando grabaciones cortas secuenciales
  // Para audio real de baja latencia se requeriría react-native-audio-recorder-player con emit
  const startAudioStream = async () => {
    try {
      if (recording.current) await stopAudioStream();

      const { recording: newRecording } = await Audio.Recording.createAsync(
        {
          ...Audio.RecordingOptionsPresets.LOW_QUALITY,
          android: {
            ...Audio.RecordingOptionsPresets.LOW_QUALITY.android,
            extension: '.aac',
            outputFormat: Audio.AndroidOutputFormat.AAC_ADTS,
          },
          ios: {
            ...Audio.RecordingOptionsPresets.LOW_QUALITY.ios,
            extension: '.caf',
            outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
          }
        },
        (status) => {
          // Callback de estado (opcional)
        },
        100 // Intervalo de polling corto
      );
      recording.current = newRecording;

      // En este enfoque simple con Expo AV, no tenemos acceso directo a los bytes en tiempo real
      // sin detener la grabación. Para un MVP real de streaming de audio, necesitamos
      // leer el archivo cada X tiempo o usar una librería nativa.
      // DADO QUE QUEREMOS EVITAR COMPLEJIDAD NATIVA EXCESIVA AHORA:
      // Vamos a simular el envío de audio.
      // *NOTA TÉCNICA:* Implementar audio streaming real bidireccional requiere WebRTC.
      // WebSocket no es ideal para audio crudo desde Expo Managed.

      console.log("Audio iniciado (Simulación de estructura)");

    } catch (error) {
      console.log('Error audio:', error);
    }
  };

  const stopAudioStream = async () => {
    try {
      if (recording.current) {
        await recording.current.stopAndUnloadAsync();
        recording.current = null;
      }
    } catch (error) { }
  };

  // Efecto para activar/desactivar audio según estado y conexión
  useEffect(() => {
    if (isConnected && micActive) {
      // startAudioStream(); // Comentado hasta resolver la librería de audio streaming
    } else {
      stopAudioStream();
    }
  }, [isConnected, micActive]);


  const handleConnect = async (audioOnlyMode = false) => {
    if (!ipAddress) return;
    setIsConnecting(true);
    Keyboard.dismiss();
    await AsyncStorage.setItem('saved_ip', ipAddress);
    setCameraActive(!audioOnlyMode);

    try {
      ws.current = new WebSocket(`ws://${ipAddress}:5000`);
      ws.current.onopen = () => {
        setIsConnecting(false);
        setIsConnected(true);
        isSocketOpen.value = true;
        if (audioOnlyMode) ws.current?.send(JSON.stringify({ type: 'VIDEO_TOGGLE', value: false }));
      };

      ws.current.onmessage = (e) => {
        try {
          const cmd = JSON.parse(e.data);
          switch (cmd.type) {
            case 'FLASH': setFlash(cmd.value); break;
            case 'FLIP': setPosition(cmd.value); break;
            case 'VIDEO_TOGGLE': setCameraActive(cmd.value); break;
            case 'MIC_TOGGLE': setMicActive(cmd.value); break; // Manejar toggle de mic
            case 'ZOOM': setZoom(cmd.value); break;
          }
        } catch (err) { }
      };

      ws.current.onclose = () => handleDisconnect();
      ws.current.onerror = () => setIsConnecting(false);
    } catch (e) {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    isSocketOpen.value = false;
    ws.current?.close();
    setIsConnected(false);
    setIsConnecting(false);
    setCameraActive(true);
    setScreenDark(false);
    setMicActive(true);
  };

  const sendFrame = Worklets.createRunOnJS((b64: string) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(b64);
  });

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (!isSocketOpen.value) return;
    runAtTargetFps(24, () => {
      if (plugin && cameraActive) {
        const b64 = plugin.call(frame) as string;
        if (b64) sendFrame(b64);
      }
    });
  }, [cameraActive]);

  const openLink = (url: string) => Linking.openURL(url).catch(() => { });

  if (!hasPermission) return <View style={styles.center}><Text style={styles.text}>Faltan permisos</Text></View>;

  // ... (RESTO DEL RENDERIZADO IGUAL QUE EL ARCHIVO ANTERIOR)
  // Solo asegúrate de copiar el renderizado de la versión anterior, es idéntico
  // pero agregando la lógica visual del micrófono si quisieras.

  // Para brevedad, aquí copio solo el return principal si no está conectado
  if (!isConnected) {
    return (
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.container}>
          <StatusBar barStyle="light-content" />
          <View style={styles.header}>
            <Text style={styles.title}>AirwiLens</Text>
            <Text style={styles.subtitle}>Tu celular, ahora una webcam Pro</Text>
          </View>

          <View style={styles.formCard}>
            <Text style={styles.label}>IP del Servidor PC:</Text>
            <TextInput
              style={styles.input}
              placeholder="Ej: 192.168.1.5"
              placeholderTextColor="#666"
              keyboardType="numeric"
              value={ipAddress}
              onChangeText={setIpAddress}
            />
            <TouchableOpacity style={styles.btnPrimary} onPress={() => handleConnect(false)} disabled={isConnecting}>
              {isConnecting ? <ActivityIndicator color="black" /> : <Text style={styles.btnTextPrimary}>CONECTAR CÁMARA</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnSecondary} onPress={() => handleConnect(true)} disabled={isConnecting}>
              <Ionicons name="mic" size={18} color="#4caf50" style={{ marginRight: 8 }} />
              <Text style={styles.btnTextSecondary}>Solo Micrófono</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.socialBtn} onPress={() => openLink('https://paypal.me/lugomartin')}>
              <Ionicons name="heart" size={20} color="#e91e63" />
              <Text style={[styles.socialText, { color: '#e91e63' }]}>Donar</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.socialBtn} onPress={() => openLink('https://x.com/luuguin')}>
              <Ionicons name="logo-twitter" size={20} color="#fff" />
              <Text style={styles.socialText}>@luuguin</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableWithoutFeedback>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      {device && (
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          format={format}
          isActive={true}
          frameProcessor={frameProcessor}
          pixelFormat="yuv"
          torch={flash}
          zoom={zoom}
          enableZoomGesture={true}
        />
      )}
      {screenDark && (
        <TouchableOpacity activeOpacity={1} style={[StyleSheet.absoluteFill, styles.darkOverlay]} onPress={() => setScreenDark(false)}>
          <View style={styles.center}>
            <Ionicons name="moon" size={50} color="#4caf50" />
            <Text style={styles.darkTextTitle}>Ahorro de Energía</Text>
            <Text style={styles.darkTextSub}>Transmitiendo...</Text>
          </View>
        </TouchableOpacity>
      )}
      {!screenDark && (
        <View style={styles.overlay}>
          <View style={styles.topBar}>
            <View style={[styles.badge, cameraActive ? styles.bgGreen : styles.bgOrange]}>
              <View style={[styles.dot, cameraActive ? styles.dotGreen : styles.dotRed]} />
              <Text style={styles.badgeText}>{cameraActive ? "EN VIVO" : "AUDIO ONLY"}</Text>
            </View>
            {!micActive && (
              <View style={[styles.badge, { backgroundColor: 'red', marginTop: 5 }]}>
                <Text style={styles.badgeText}>MIC MUTE</Text>
              </View>
            )}
          </View>

          <View style={styles.bottomControls}>
            <TouchableOpacity style={styles.roundBtn} onPress={() => setScreenDark(true)}>
              <Ionicons name="moon-outline" size={24} color="white" />
              <Text style={styles.btnLabel}>Oscurecer</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.roundBtn, styles.btnDisconnect]} onPress={handleDisconnect}>
              <Ionicons name="power" size={32} color="white" />
            </TouchableOpacity>
            <View style={{ width: 60, alignItems: 'center' }}>
              <Text style={styles.btnLabel}>{zoom.toFixed(1)}x</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  darkContainer: { backgroundColor: 'black' },
  center: { justifyContent: 'center', alignItems: 'center', flex: 1 },
  header: { marginTop: 60, alignItems: 'center' },
  title: { fontSize: 36, fontWeight: 'bold', color: '#4caf50', letterSpacing: 1 },
  subtitle: { fontSize: 16, color: '#888', marginTop: 5 },
  formCard: { width: '85%', backgroundColor: '#1e1e1e', borderRadius: 20, padding: 25, marginTop: 40, elevation: 5 },
  label: { color: '#ccc', marginBottom: 8, marginLeft: 4, fontWeight: '600' },
  input: { backgroundColor: '#2a2a2a', color: 'white', borderRadius: 12, padding: 16, fontSize: 18, borderWidth: 1, borderColor: '#333', marginBottom: 20, textAlign: 'center' },
  btnPrimary: { backgroundColor: '#4caf50', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginBottom: 15 },
  btnTextPrimary: { fontSize: 16, fontWeight: 'bold', color: '#000' },
  btnSecondary: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: '#4caf50' },
  btnTextSecondary: { fontSize: 16, color: '#4caf50', fontWeight: '600' },
  footer: { position: 'absolute', bottom: 40, flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e1e1e', padding: 10, borderRadius: 50 },
  socialBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15 },
  socialText: { color: 'white', marginLeft: 8, fontWeight: '600' },
  divider: { width: 1, height: 20, backgroundColor: '#444' },
  text: { color: 'white' },
  overlay: { flex: 1, justifyContent: 'space-between', paddingVertical: 50, paddingHorizontal: 20 },
  topBar: { alignItems: 'center', marginTop: 10 },
  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  bgGreen: { backgroundColor: 'rgba(0, 200, 0, 0.3)' },
  bgOrange: { backgroundColor: 'rgba(255, 165, 0, 0.3)' },
  badgeText: { color: 'white', fontWeight: 'bold', fontSize: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  dotGreen: { backgroundColor: '#4caf50' },
  dotRed: { backgroundColor: 'red' },
  bottomControls: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center', marginBottom: 30 },
  roundBtn: { alignItems: 'center', justifyContent: 'center', width: 60, height: 60 },
  btnDisconnect: { width: 80, height: 80, backgroundColor: '#d32f2f', borderRadius: 40, elevation: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 10, borderWidth: 4, borderColor: '#1e1e1e' },
  btnLabel: { color: '#ccc', fontSize: 12, marginTop: 4 },
  darkOverlay: { backgroundColor: 'black', zIndex: 999, justifyContent: 'center', alignItems: 'center' },
  darkTextTitle: { color: '#4caf50', fontSize: 22, fontWeight: 'bold', marginTop: 20 },
  darkTextSub: { color: '#888', fontSize: 16, marginTop: 10 },