import tkinter as tk
from tkinter import ttk
import asyncio
import websockets
import threading
import json
import base64
import cv2
import numpy as np
import queue
from PIL import Image, ImageTk

# --- CONFIGURACIÓN ---
PORT = 5000
frame_queue = queue.Queue(maxsize=2)

class WebcamControlApp:
    def __init__(self, root):
        self.root = root
        self.root.title("WebcamPro - Centro de Mando")
        self.root.geometry("1000x800")
        self.root.configure(bg="#121212")

        # Variables de Estado
        self.flash_on = False
        self.camera_front = False 
        self.video_active = True
        self.mic_active = True
        self.loop = None
        self.connected_client = None
        
        # Estado de Rotación (0=0°, 1=90°, 2=180°, 3=270°)
        self.rotation_index = 0 

        # Construir Interfaz
        self.create_interface()
        
        # Hilos
        self.server_thread = threading.Thread(target=self.start_server_thread, daemon=True)
        self.server_thread.start()

        # Inicio Loop GUI
        self.update_video_frame()

    def create_interface(self):
        # --- 1. PANEL DE CONTROL (Fijo Abajo) ---
        self.control_frame = tk.Frame(self.root, bg="#1f1f1f", height=150) # Aumentamos un poco la altura para comodidad
        self.control_frame.pack(side=tk.BOTTOM, fill=tk.X)
        self.control_frame.pack_propagate(False)

        self.status_label = tk.Label(self.control_frame, text="Estado: ESPERANDO...", bg="#1f1f1f", fg="orange", font=("Segoe UI", 10, "bold"))
        self.status_label.pack(side=tk.TOP, pady=5)

        btns_container = tk.Frame(self.control_frame, bg="#1f1f1f")
        btns_container.pack(expand=True)

        # Fila 1: Controles Básicos
        self.btn_video = self.create_btn(btns_container, "Apagar Cámara", self.toggle_video, "#d32f2f", 0, 0)
        self.btn_mic = self.create_btn(btns_container, "Mute Mic", self.toggle_mic, "#d32f2f", 0, 1)
        self.btn_flash = self.create_btn(btns_container, "Flash: OFF", self.toggle_flash, "#0288d1", 0, 2)
        self.btn_flip = self.create_btn(btns_container, "Girar Cámara", self.toggle_camera, "#fbc02d", 0, 3)
        
        # NUEVO BOTÓN: Rotar 90 Grados
        self.btn_rotate = self.create_btn(btns_container, "Rotar 90°", self.rotate_view, "#8e44ad", 0, 4)

        # Fila 2: Zoom
        zoom_frame = tk.Frame(self.control_frame, bg="#1f1f1f")
        zoom_frame.pack(side=tk.BOTTOM, fill=tk.X, padx=50, pady=10)
        tk.Label(zoom_frame, text="Zoom:", bg="#1f1f1f", fg="#cccccc").pack(side=tk.LEFT)
        self.zoom_slider = tk.Scale(zoom_frame, from_=1.0, to=5.0, orient=tk.HORIZONTAL, resolution=0.1, 
                                    bg="#1f1f1f", fg="white", highlightthickness=0, command=self.send_zoom, troughcolor="#444444")
        self.zoom_slider.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=10)

        # --- 2. AREA DE VIDEO ---
        self.video_container = tk.Frame(self.root, bg="black")
        self.video_container.pack(side=tk.TOP, fill=tk.BOTH, expand=True)

        self.video_label = tk.Label(self.video_container, text="[ SIN SEÑAL ]", bg="black", fg="#444444", font=("Segoe UI", 20))
        self.video_label.pack(expand=True, fill=tk.BOTH)

    def create_btn(self, parent, text, command, color, r, c):
        btn = tk.Button(parent, text=text, bg=color, fg="white", font=("Segoe UI", 9, "bold"), 
                        command=command, relief="flat", padx=15, pady=8, cursor="hand2")
        btn.grid(row=r, column=c, padx=5, pady=5)
        return btn

    # --- HILO PRINCIPAL (GUI) ---
    def update_video_frame(self):
        try:
            frame = None
            while not frame_queue.empty():
                frame = frame_queue.get_nowait()
            
            if frame is not None:
                # 1. APLICAR ROTACIÓN (Nuevo paso)
                if self.rotation_index == 1:
                    frame = cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
                elif self.rotation_index == 2:
                    frame = cv2.rotate(frame, cv2.ROTATE_180)
                elif self.rotation_index == 3:
                    frame = cv2.rotate(frame, cv2.ROTATE_90_COUNTERCLOCKWISE)
                
                # 2. Obtener tamaño ventana
                target_w = self.video_container.winfo_width()
                target_h = self.video_container.winfo_height()

                if target_w > 10 and target_h > 10:
                    # Calcular aspect ratio para no deformar (opcional, aquí hacemos 'contain')
                    h, w = frame.shape[:2]
                    scale = min(target_w/w, target_h/h)
                    new_w, new_h = int(w * scale), int(h * scale)
                    
                    frame_resized = cv2.resize(frame, (new_w, new_h))

                    cv2image = cv2.cvtColor(frame_resized, cv2.COLOR_BGR2RGB)
                    img = Image.fromarray(cv2image)
                    imgtk = ImageTk.PhotoImage(image=img)
                    
                    self.video_label.imgtk = imgtk 
                    self.video_label.configure(image=imgtk, text="")
                
        except Exception as e:
            pass
        
        self.root.after(15, self.update_video_frame)

    # --- ACCIONES ---
    def rotate_view(self):
        # Incrementamos 0 -> 1 -> 2 -> 3 -> 0
        self.rotation_index = (self.rotation_index + 1) % 4
        # Feedback visual opcional en consola
        print(f"Rotación actual: {self.rotation_index * 90}°")

    def toggle_flash(self):
        self.flash_on = not self.flash_on
        self.btn_flash.config(text="Flash: ON" if self.flash_on else "Flash: OFF", bg="#388e3c" if self.flash_on else "#0288d1")
        self.send_command({"type": "FLASH", "value": "on" if self.flash_on else "off"})

    def toggle_camera(self):
        self.camera_front = not self.camera_front
        self.send_command({"type": "FLIP", "value": "front" if self.camera_front else "back"})

    def toggle_video(self):
        self.video_active = not self.video_active
        self.btn_video.config(text="Encender Cámara" if not self.video_active else "Apagar Cámara", bg="#388e3c" if not self.video_active else "#d32f2f")
        self.send_command({"type": "VIDEO_TOGGLE", "value": self.video_active})

    def toggle_mic(self):
        self.mic_active = not self.mic_active
        self.btn_mic.config(text="Activar Mic" if not self.mic_active else "Mute Mic", bg="#388e3c" if not self.mic_active else "#d32f2f")
        self.send_command({"type": "MIC_TOGGLE", "value": self.mic_active})

    def send_zoom(self, value):
        self.send_command({"type": "ZOOM", "value": float(value)})

    # --- SERVIDOR ---
    def send_command(self, command_dict):
        if self.connected_client and self.loop:
            try:
                msg = json.dumps(command_dict)
                asyncio.run_coroutine_threadsafe(self.connected_client.send(msg), self.loop)
            except Exception: pass

    def start_server_thread(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)

        async def server_handler(websocket):
            self.connected_client = websocket
            self.root.after(0, lambda: self.status_label.config(text=f"CONECTADO: {websocket.remote_address[0]}", fg="#4caf50"))
            print(f"--> Nuevo cliente: {websocket.remote_address}")

            try:
                async for message in websocket:
                    if isinstance(message, str) and len(message) > 1000:
                        try:
                            clean_b64 = message.strip()
                            img_bytes = base64.b64decode(clean_b64, validate=False)
                            nparr = np.frombuffer(img_bytes, np.uint8)
                            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

                            if frame is not None:
                                if not frame_queue.full():
                                    frame_queue.put(frame)
                        except Exception: pass
            except Exception: pass
            finally:
                self.connected_client = None
                self.root.after(0, lambda: self.status_label.config(text="Estado: ESPERANDO...", fg="orange"))
                self.root.after(0, lambda: self.video_label.config(image="", text="[ SEÑAL PERDIDA ]"))

        async def main():
            print(f"Escuchando en puerto {PORT}...")
            async with websockets.serve(server_handler, "0.0.0.0", PORT, max_size=None, ping_interval=None):
                await asyncio.Future()

        self.loop.run_until_complete(main())

if __name__ == "__main__":
    root = tk.Tk()
    app = WebcamControlApp(root)
    root.mainloop()