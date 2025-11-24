import tkinter as tk
from tkinter import ttk
import asyncio
import websockets
import threading
import json
import base64
import cv2
import numpy as np

# Variable global para el loop de eventos
loop = None
# Variable para el cliente conectado
connected_client = None

class WebcamControlApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Panel de Control - WebcamPro")
        self.root.geometry("400x350")
        
        # Estado de los controles
        self.flash_on = False
        self.camera_front = False # False = Back, True = Front
        self.video_active = True
        self.mic_active = True

        self.create_widgets()
        
        # Iniciar el servidor en un hilo aparte
        server_thread = threading.Thread(target=self.start_server_loop, daemon=True)
        server_thread.start()

    def create_widgets(self):
        # Etiqueta de estado
        self.status_label = tk.Label(self.root, text="Esperando conexión...", fg="red", font=("Arial", 12))
        self.status_label.pack(pady=10)
        
        self.ip_label = tk.Label(self.root, text="IP PC: Revisa ipconfig", fg="gray", font=("Arial", 8))
        self.ip_label.pack()

        # Frame para botones
        btn_frame = tk.Frame(self.root)
        btn_frame.pack(pady=20)

        # Botón Cámara ON/OFF
        self.btn_video = tk.Button(btn_frame, text="Apagar Cámara", bg="#ffcccc", width=20, command=self.toggle_video)
        self.btn_video.grid(row=0, column=0, padx=5, pady=5)

        # Botón Micrófono ON/OFF
        self.btn_mic = tk.Button(btn_frame, text="Silenciar Micrófono", bg="#ffcccc", width=20, command=self.toggle_mic)
        self.btn_mic.grid(row=1, column=0, padx=5, pady=5)

        # Botón Flash
        self.btn_flash = tk.Button(btn_frame, text="Prender Flash", width=20, command=self.toggle_flash)
        self.btn_flash.grid(row=0, column=1, padx=5, pady=5)

        # Botón Girar Cámara
        self.btn_flip = tk.Button(btn_frame, text="Girar Cámara", width=20, command=self.toggle_camera)
        self.btn_flip.grid(row=1, column=1, padx=5, pady=5)
        
        # Control Extra: Zoom (Slider)
        tk.Label(self.root, text="Zoom").pack(pady=(10,0))
        self.zoom_slider = tk.Scale(self.root, from_=1.0, to=5.0, orient=tk.HORIZONTAL, resolution=0.1, command=self.send_zoom)
        self.zoom_slider.pack(fill=tk.X, padx=40)

    # --- Lógica de envío de comandos ---
    def send_command(self, command_dict):
        global connected_client, loop
        if connected_client and loop:
            msg = json.dumps(command_dict)
            # Enviamos el mensaje de forma segura al hilo del loop
            asyncio.run_coroutine_threadsafe(connected_client.send(msg), loop)
        else:
            print(f"Comando ignorado (No conectado): {command_dict}")

    def toggle_flash(self):
        self.flash_on = not self.flash_on
        self.btn_flash.config(text="Apagar Flash" if self.flash_on else "Prender Flash", bg="#ccffcc" if self.flash_on else "SystemButtonFace")
        self.send_command({"type": "FLASH", "value": "on" if self.flash_on else "off"})

    def toggle_camera(self):
        self.camera_front = not self.camera_front
        self.send_command({"type": "FLIP", "value": "front" if self.camera_front else "back"})

    def toggle_video(self):
        self.video_active = not self.video_active
        self.btn_video.config(text="Prender Cámara" if not self.video_active else "Apagar Cámara")
        self.send_command({"type": "VIDEO_TOGGLE", "value": self.video_active})
        
    def toggle_mic(self):
        self.mic_active = not self.mic_active
        self.btn_mic.config(text="Activar Mic" if not self.mic_active else "Silenciar Mic")
        self.send_command({"type": "MIC_TOGGLE", "value": self.mic_active})

    def send_zoom(self, value):
        self.send_command({"type": "ZOOM", "value": float(value)})

    # --- Servidor WebSocket ---
    def start_server_loop(self):
        global loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        async def main_server():
            print("Iniciando servidor en 0.0.0.0:5000...")
            async with websockets.serve(self.handler, "0.0.0.0", 5000, max_size=None, ping_interval=None):
                await asyncio.Future()

        try:
            loop.run_until_complete(main_server())
        except Exception as e:
            print(f"Error fatal en el servidor: {e}")

    async def handler(self, websocket):
        global connected_client
        print(f"Cliente conectado desde: {websocket.remote_address}")
        connected_client = websocket
        
        self.root.after(0, lambda: self.status_label.config(text=f"CONECTADO\n{websocket.remote_address}", fg="green"))
        
        cv2.namedWindow("WebcamPro Stream", cv2.WINDOW_NORMAL)
        cv2.resizeWindow("WebcamPro Stream", 1280 , 720)
        
        try:
            async for message in websocket:
                try:
                    # El App envía un STRING Base64 (porque usa react-native-fs con encoding 'base64')
                    # Usamos una heurística: Si el mensaje es texto y muy largo (> 100 caracteres), es una imagen.
                    if isinstance(message, str) and len(message) > 500:
                        
                        # 1. Decodificar Base64 a Bytes
                        img_bytes = base64.b64decode(message)
                        
                        # 2. Convertir Bytes a Numpy Array
                        nparr = np.frombuffer(img_bytes, np.uint8)
                        
                        # 3. Decodificar imagen para OpenCV
                        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                        
                        if frame is not None:
                            # 4. Mostrar en ventana
                            cv2.imshow("WebcamPro Stream", frame)
                            
                            # Necesario para refrescar la ventana (1ms)
                            if cv2.waitKey(1) & 0xFF == ord('q'):
                                break
                    else:
                        # Si es corto, asumimos que es un log o mensaje
                        print(f"Mensaje del celular: {message}")

                except Exception as e_inner:
                    # Imprimimos error pero no rompemos el bucle para seguir recibiendo frames
                    # print(f"Error procesando frame: {e_inner}") 
                    pass

        except websockets.exceptions.ConnectionClosed:
            print("Cliente desconectado")
        except Exception as e:
            print(f"Error en conexión: {e}")
        finally:
            connected_client = None
            self.root.after(0, lambda: self.status_label.config(text="Desconectado", fg="red"))
            cv2.destroyAllWindows()

if __name__ == "__main__":
    root = tk.Tk()
    app = WebcamControlApp(root)
    root.mainloop()