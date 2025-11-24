import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';

// RECUERDA: Cambia esto por la IP de tu PC
const PC_IP = '192.168.1.XX';
const PORT = 5000;

export default function App() {
    // 1. Estados controlados remotamente
    const [cameraPosition, setCameraPosition] = useState('back');
    const [flash, setFlash] = useState('off');
    const [isActive, setIsActive] = useState(true); // Prender/Apagar cámara
    const [zoom, setZoom] = useState(1.0);

    // Audio placeholder (lo implementaremos después)
    const [micActive, setMicActive] = useState(true);

    const device = useCameraDevice(cameraPosition);
    const [hasPermission, setHasPermission] = useState(false);
    const ws = useRef(null);

    useEffect(() => {
        (async () => {
            const status = await Camera.requestCameraPermission();
            setHasPermission(status === 'granted');
        })();
        connectWebSocket();
        return () => ws.current?.close();
    }, []);

    const connectWebSocket = () => {
        ws.current = new WebSocket(`ws://${PC_IP}:${PORT}`);

        ws.current.onopen = () => console.log("Conectado a PC");

        // 2. ESCUCHAR ÓRDENES DE LA PC
        ws.current.onmessage = (e) => {
            try {
                const command = JSON.parse(e.data);
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
                console.error("Error interpretando comando", err);
            }
        };

        ws.current.onclose = () => setTimeout(connectWebSocket, 2000);
    };

    if (!hasPermission) return <Text>Sin permisos</Text>;
    if (device == null) return <ActivityIndicator />;

    return (
        <View style={styles.container}>
            {/* Si isActive es false, ocultamos la cámara o mostramos pantalla negra */}
            {isActive && (
                <Camera
                    style={StyleSheet.absoluteFill}
                    device={device}
                    isActive={isActive}
                    torch={flash} // Control del Flash
                    zoom={zoom}   // Control del Zoom
                // FrameProcessor irá aquí luego
                />
            )}

            {!isActive && (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: 'black', justifyContent: 'center', alignItems: 'center' }]}>
                    <Text style={{ color: 'white' }}>Cámara Pausada (Solo Audio)</Text>
                </View>
            )}

            <View style={styles.overlay}>
                <Text style={styles.text}>Estado: {isActive ? "VIDEO ON" : "VIDEO OFF"}</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: 'black' },
    overlay: { position: 'absolute', bottom: 50, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: 10 },
    text: { color: 'white' }
});