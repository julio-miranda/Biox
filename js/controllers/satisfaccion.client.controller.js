"use strict";

(() => {
    const form = document.getElementById("encuesta-form");
    const mensaje = document.getElementById("mensaje");
    const boton = document.getElementById("btnEnviarEncuesta");

    if (!form || !mensaje || !boton) {
        return;
    }

    const CALIFICACIONES = [
        "ambiente",
        "musica",
        "atencion",
        "seguridad",
        "limpieza",
        "tiempo_espera",
        "recomendacion"
    ];

    function mostrarMensaje(texto, tipo) {
        mensaje.textContent = texto;
        mensaje.className = `message show ${tipo}`;
    }

    form.addEventListener("submit", async evento => {
        evento.preventDefault();

        const formulario = new FormData(form);
        const datos = Object.fromEntries(formulario.entries());

        datos.mesa_numero = Number(datos.mesa_numero);

        for (const campo of CALIFICACIONES) {
            datos[campo] = Number(datos[campo]);
        }

        datos.comentario = datos.comentario.trim() || null;

        boton.disabled = true;
        boton.textContent = "Enviando...";

        try {
            const respuesta = await fetch("/api/satisfaccion", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                credentials: "same-origin",
                body: JSON.stringify(datos)
            });

            const resultado = await respuesta.json().catch(() => ({}));

            if (!respuesta.ok) {
                throw new Error(
                    resultado.message || "No fue posible enviar la encuesta."
                );
            }

            form.reset();

            mostrarMensaje(
                resultado.message || "Encuesta enviada correctamente. Gracias por tu opinión.",
                "success"
            );
        } catch (err) {
            mostrarMensaje(err.message, "error");
        } finally {
            boton.disabled = false;
            boton.textContent = "Enviar encuesta";
        }
    });
})();