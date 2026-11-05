#!/usr/bin/env python3
"""Interfaz para probar conexiones y ejecutar el ETL BIOX."""

from __future__ import annotations

import queue
import threading
import tkinter as tk
from tkinter import messagebox, ttk

from etl_biox_dw import run_etl, test_connections


class BioxEtlWindow:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.events: queue.Queue[tuple[str, str]] = queue.Queue()
        self.busy = False

        root.title("BIOX · Proceso ETL")
        root.geometry("640x430")
        root.minsize(560, 360)
        root.protocol("WM_DELETE_WINDOW", self.close_window)

        container = ttk.Frame(root, padding=20)
        container.pack(fill="both", expand=True)

        ttk.Label(
            container,
            text="Data Warehouse BIOX",
            font=("Segoe UI", 18, "bold"),
        ).pack(anchor="w")

        ttk.Label(
            container,
            text="Comprueba las conexiones y ejecuta la extracción, transformación y carga de los datos.",
            wraplength=580,
        ).pack(anchor="w", pady=(4, 16))

        buttons = ttk.Frame(container)
        buttons.pack(fill="x", pady=(0, 12))

        self.check_button = ttk.Button(
            buttons,
            text="Probar conexiones",
            command=lambda: self.start_task("check"),
        )
        self.check_button.pack(side="left")

        self.run_button = ttk.Button(
            buttons,
            text="Ejecutar proceso ETL",
            command=lambda: self.start_task("run"),
        )
        self.run_button.pack(side="left", padx=(8, 0))

        self.progress = ttk.Progressbar(
            container,
            mode="indeterminate",
        )
        self.progress.pack(fill="x", pady=(0, 8))

        self.status = tk.StringVar(
            value="Listo. Requiere que biox_dw esté inicializada."
        )

        ttk.Label(
            container,
            textvariable=self.status,
        ).pack(anchor="w", pady=(0, 8))

        output_frame = ttk.LabelFrame(
            container,
            text="Resultado",
            padding=8,
        )
        output_frame.pack(fill="both", expand=True)

        self.output = tk.Text(
            output_frame,
            height=10,
            wrap="word",
            state="disabled",
        )

        scrollbar = ttk.Scrollbar(
            output_frame,
            orient="vertical",
            command=self.output.yview,
        )

        self.output.configure(yscrollcommand=scrollbar.set)

        self.output.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        self.root.after(150, self.process_events)

    def append_output(self, text: str) -> None:
        self.output.configure(state="normal")
        self.output.insert("end", text.rstrip() + "\n")
        self.output.see("end")
        self.output.configure(state="disabled")

    def start_task(self, action: str) -> None:
        if self.busy:
            return

        self.busy = True

        self.check_button.configure(state="disabled")
        self.run_button.configure(state="disabled")

        self.progress.start(10)

        message = (
            "Probando conexiones..."
            if action == "check"
            else "Ejecutando proceso ETL..."
        )

        self.status.set(message)
        self.append_output(message)

        worker = threading.Thread(
            target=self.run_task,
            args=(action,),
            daemon=True,
        )

        worker.start()

    def run_task(self, action: str) -> None:
        try:
            if action == "check":
                databases = test_connections()

                message = (
                    "Conexiones correctas:\n"
                    f"• Base operacional: {databases['OLTP']}\n"
                    f"• Data Warehouse: {databases['DW']}"
                )

                self.events.put(("success", message))
                return

            run_id = run_etl()

            self.events.put(
                ("success", f"Proceso ETL completado.\nEjecución: {run_id}")
            )

        except Exception as exc:
            self.events.put(("error", str(exc)[:2000]))

    def process_events(self) -> None:
        try:
            while True:
                level, message = self.events.get_nowait()

                self.busy = False
                self.progress.stop()

                self.check_button.configure(state="normal")
                self.run_button.configure(state="normal")

                if level == "success":
                    self.status.set("Operación completada.")
                    self.append_output(message)

                else:
                    self.status.set("La operación encontró un error.")
                    self.append_output(f"Error: {message}")

                    messagebox.showerror(
                        "ETL BIOX",
                        message,
                        parent=self.root,
                    )

        except queue.Empty:
            pass

        self.root.after(150, self.process_events)

    def close_window(self) -> None:
        if self.busy:
            messagebox.showinfo(
                "ETL BIOX",
                "Espera a que termine la operación antes de cerrar esta ventana.",
                parent=self.root,
            )
            return

        self.root.destroy()


def main() -> None:
    root = tk.Tk()
    BioxEtlWindow(root)
    root.mainloop()


if __name__ == "__main__":
    main()