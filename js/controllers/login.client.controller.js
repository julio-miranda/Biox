"use strict";

const loginForm = document.getElementById("login-form");
const emailInput = document.getElementById("login-email");
const passwordInput = document.getElementById("login-password");
const forgotPasswordButton = document.getElementById("btn-forgot-password");
const loginMessage = document.getElementById("login-message");

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    loginMessage.textContent = "";

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
        loginMessage.textContent =
            "Ingresa tu correo electrónico y contraseña.";
        return;
    }

    const submitButton = loginForm.querySelector(
        'button[type="submit"]'
    );

    submitButton.disabled = true;
    submitButton.textContent = "Ingresando...";

    try {
        const response = await fetch("/api/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            credentials: "same-origin",
            body: JSON.stringify({
                email,
                password
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.message || "No se pudo iniciar sesión."
            );
        }

        loginMessage.textContent = data.message;
        loginMessage.dataset.type = "success";

        window.location.assign("/dashboard.html");

    } catch (error) {
        loginMessage.textContent =
            error.message || "Error al conectar con el servidor.";

        loginMessage.dataset.type = "error";
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Ingresar";
    }
});

forgotPasswordButton.addEventListener("click", () => {
    loginMessage.textContent =
        "La recuperación de contraseña todavía no está configurada.";
    loginMessage.dataset.type = "info";
});