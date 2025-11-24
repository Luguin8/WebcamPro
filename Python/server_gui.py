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
import socket
import webbrowser

# --- CONFIGURACIÓN ---
PORT = 5000
frame_queue = queue.Queue(maxsize=1)

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "127.0.0.1"

class WebcamControlApp:
    def __init__(self, root):
        self.root = root
        self.root.title("WebcamPro")
        
        # 1. FORMATO VERTICAL (TIPO CELULAR)
        # 550px ancho x 950px alto
        self.root.geometry("400x600") 
        self.root.configure(bg="#121212")

        # Estado
        self.flash_on = False
        self.camera_front = False 
        self.video_active = True
        self.mic_active = True
        self.rotation_index = 0
        self.battery_level = "--"
        self.connected_client = None
        self.loop = None
        self.local_ip = get_local_ip()

        self.create_interface()
        
        self.server_thread = threading.Thread(target=self.start_server_thread, daemon=True)
        self.server_thread.start()

        self.update_video_frame()

    def create_interface(self):
        # --- 1. PANEL DE CONTROL (FIJO ABAJO) ---
        # Aumentamos altura para que quepan todos los botones y el de X
        self.control_frame = tk.Frame(self.root, bg="#1f1f1f", height=240) 
        self.control_frame.pack(side=tk.BOTTOM, fill=tk.X)
        self.control_frame.pack_propagate(False) 

        # --- 2. HEADER (ARRIBA) ---
        header_frame = tk.Frame(self.root, bg="#121212")
        header_frame.pack(side=tk.TOP, fill=tk.X, pady=10, padx=10)
        
        # Info IP (Izquierda)
        ip_frame = tk.Frame(header_frame, bg="#121212")
        ip_frame.pack(side=tk.LEFT)
        tk.Label(ip_frame, text="Tu IP:", bg="#121212", fg="#666", font=("Segoe UI", 8)).pack(anchor="w")
        tk.Label(ip_frame, text=f"{self.local_ip}", bg="#121212", fg="#00ff00", font=("Segoe UI", 16, "bold")).pack(anchor="w")

        # BOTÓN DONACIONES (Derecha) + Animación
        self.btn_donate = tk.Button(header_frame, text="♥ Donaciones", bg="#e91e63", fg="white", 
                                    font=("Segoe UI", 10, "bold"), relief="flat", cursor="hand2",
                                    command=lambda: webbrowser.open("https://paypal.me/lugomartin"))
        self.btn_donate.pack(side=tk.RIGHT, pady=5)
        
        # Animación Hover (Simple pero efectiva)
        self.btn_donate.bind("<Enter>", lambda e: self.btn_donate.config(bg="#ff4081")) # Color más claro al pasar mouse
        self.btn_donate.bind("<Leave>", lambda e: self.btn_donate.config(bg="#e91e63")) # Color original al salir

        # --- 3. AREA DE VIDEO (RESTO) ---
        self.video_container = tk.Frame(self.root, bg="black", bd=1, relief="solid")
        self.video_container.pack(side=tk.TOP, expand=True, fill="both", padx=10, pady=(0, 10))
        
        self.video_label = tk.Label(self.video_container, text="[ CONECTANDO... ]", bg="black", fg="#333", font=("Segoe UI", 12))
        self.video_label.pack(expand=True, fill="both")

        # --- CONTENIDO DEL PANEL DE CONTROL ---
        
        # Status Bar
        status_frame = tk.Frame(self.control_frame, bg="#1f1f1f")
        status_frame.pack(side=tk.TOP, fill=tk.X, padx=20, pady=5)
        self.status_label = tk.Label(status_frame, text="● DESCONECTADO", bg="#1f1f1f", fg="red", font=("Segoe UI", 9, "bold"))
        self.status_label.pack(side=tk.LEFT)
        self.battery_label = tk.Label(status_frame, text="Batería: --%", bg="#1f1f1f", fg="#888", font=("Segoe UI", 9))
        self.battery_label.pack(side=tk.RIGHT)

        # Contenedor de Botones (Grid 2x2 para formato vertical)
        btns_container = tk.Frame(self.control_frame, bg="#1f1f1f")
        btns_container.pack(expand=True, fill=tk.X, padx=20)

        self.btn_video = self.create_btn(btns_container, "Cámara", self.toggle_video, "#d32f2f", 0, 0)
        self.btn_mic = self.create_btn(btns_container, "Micrófono", self.toggle_mic, "#d32f2f", 0, 1)
        self.btn_flash = self.create_btn(btns_container, "Flash", self.toggle_flash, "#0288d1", 1, 0)
        self.btn_rotate = self.create_btn(btns_container, "Rotar 90°", self.rotate_view, "#8e44ad", 1, 1)
        # El botón de girar (Flip) lo muevo a una fila pequeña o lo quito si no entra, 
        # pero en vertical entra bien como fila 3 o junto al zoom. Lo pongo fila 2, col 0.
        self.btn_flip = self.create_btn(btns_container, "Frontal/Trasera", self.toggle_camera, "#fbc02d", 2, 0, colspan=2)

        # Zoom
        zoom_frame = tk.Frame(self.control_frame, bg="#1f1f1f")
        zoom_frame.pack(side=tk.TOP, fill=tk.X, padx=30, pady=5)
        tk.Label(zoom_frame, text="🔍", bg="#1f1f1f", fg="white").pack(side=tk.LEFT)
        self.zoom_slider = tk.Scale(zoom_frame, from_=1.0, to=5.0, orient=tk.HORIZONTAL, resolution=0.1, 
                                    bg="#1f1f1f", fg="white", highlightthickness=0, command=self.send_zoom, troughcolor="#444", showvalue=0)
        self.zoom_slider.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=10)

        # BOTÓN X (Twitter) - AL FINAL
        btn_x = tk.Button(self.control_frame, text="Seguir en 𝕏", bg="black", fg="white", 
                          font=("Segoe UI", 9, "bold"), relief="flat", cursor="hand2", bd=0,
                          command=lambda: webbrowser.open("https://x.com/luuguin"))
        btn_x.pack(side=tk.BOTTOM, fill=tk.X, pady=5)

        # Configuración de columnas para que se expandan
        btns_container.columnconfigure(0, weight=1)
        btns_container.columnconfigure(1, weight=1)

    def create_btn(self, parent, text, command, color, r, c, colspan=1):
        btn = tk.Button(parent, text=text, bg=color, fg="white", font=("Segoe UI", 9, "bold"), 
                        command=command, relief="flat", pady=6, cursor="hand2")
        btn.grid(row=r, column=c, padx=5, pady=3, sticky="ew", columnspan=colspan)
        return btn

    def update_video_frame(self):
        if not self.video_active:
            self.video_label.configure(image="", text="🎙\nMODO MICRÓFONO", fg="#00ff00", font=("Segoe UI", 16, "bold"))
            while not frame_queue.empty():
                try: frame_queue.get_nowait()
                except: pass
        else:
            try:
                frame = None
                while not frame_queue.empty():
                    frame = frame_queue.get_nowait()
                
                if frame is not None:
                    # Rotaciones
                    if self.rotation_index == 1: frame = cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
                    elif self.rotation_index == 2: frame = cv2.rotate(frame, cv2.ROTATE_180)
                    elif self.rotation_index == 3: frame = cv2.rotate(frame, cv2.ROTATE_90_COUNTERCLOCKWISE)
                    
                    target_w = self.video_container.winfo_width()
                    target_h = self.video_container.winfo_height()

                    if target_w > 10 and target_h > 10:
                        h, w = frame.shape[:2]
                        # "Contain" logic: Ajustar para que entre completo
                        scale = min(target_w/w, target_h/h)
                        new_w, new_h = int(w * scale), int(h * scale)
                        
                        frame = cv2.resize(frame, (new_w, new_h))
                        
                        canvas = np.zeros((target_h, target_w, 3), dtype=np.uint8)
                        y_off = (target_h - new_h) // 2
                        x_off = (target_w - new_w) // 2
                        canvas[y_off:y_off+new_h, x_off:x_off+new_w] = frame

                        cv2image = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB)
                        img = Image.fromarray(cv2image)
                        imgtk = ImageTk.PhotoImage(image=img)
                        
                        self.video_label.imgtk = imgtk 
                        self.video_label.configure(image=imgtk, text="")
            except Exception: pass
        
        self.root.after(15, self.update_video_frame)

    # --- COMANDOS ---
    def send_command(self, cmd):
        if self.connected_client and self.loop:
            asyncio.run_coroutine_threadsafe(self.connected_client.send(json.dumps(cmd)), self.loop)

    def toggle_flash(self):
        self.flash_on = not self.flash_on
        self.btn_flash.config(bg="#4caf50" if self.flash_on else "#0288d1")
        self.send_command({"type": "FLASH", "value": "on" if self.flash_on else "off"})

    def toggle_camera(self):
        self.camera_front = not self.camera_front
        self.send_command({"type": "FLIP", "value": "front" if self.camera_front else "back"})

    def toggle_video(self):
        self.video_active = not self.video_active
        self.btn_video.config(bg="#4caf50" if not self.video_active else "#d32f2f")
        if not self.video_active:
            self.video_label.configure(image="", text="🎙\nMODO MICRÓFONO", fg="#00ff00")
        else:
            self.video_label.configure(text="Iniciando video...")
        self.send_command({"type": "VIDEO_TOGGLE", "value": self.video_active})

    def toggle_mic(self):
        self.mic_active = not self.mic_active
        self.btn_mic.config(bg="#4caf50" if not self.mic_active else "#d32f2f")
        self.send_command({"type": "MIC_TOGGLE", "value": self.mic_active})

    def send_zoom(self, v): self.send_command({"type": "ZOOM", "value": float(v)})
    def rotate_view(self): self.rotation_index = (self.rotation_index + 1) % 4
    
    def update_battery(self, val):
        self.root.after(0, lambda: self.battery_label.config(text=f"Batería: {val}%", fg="#4caf50" if val > 20 else "red"))

    def start_server_thread(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)

        async def handler(websocket):
            self.connected_client = websocket
            self.root.after(0, lambda: self.status_label.config(text="● CONECTADO", fg="#4caf50"))
            try:
                async for msg in websocket:
                    if len(msg) > 1000: 
                        try:
                            if self.video_active:
                                dat = base64.b64decode(msg.strip(), validate=False)
                                nparr = np.frombuffer(dat, np.uint8)
                                frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                                if frame is not None and not frame_queue.full():
                                    frame_queue.put(frame)
                        except: pass
                    else: 
                        try:
                            d = json.loads(msg)
                            if d.get('type') == 'BATTERY': self.update_battery(d['value'])
                        except: pass
            except: pass
            finally:
                self.connected_client = None
                self.root.after(0, lambda: self.status_label.config(text="● DESCONECTADO", fg="red"))
                self.root.after(0, lambda: self.battery_label.config(text="Batería: --%", fg="#888"))

        async def main():
            async with websockets.serve(handler, "0.0.0.0", PORT, max_size=None, ping_interval=None):
                await asyncio.Future()
        
        self.loop.run_until_complete(main())

if __name__ == "__main__":
    root = tk.Tk()
    app = WebcamControlApp(root)
    root.mainloop()