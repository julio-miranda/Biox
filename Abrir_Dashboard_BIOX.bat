@echo off
setlocal
cd /d "%~dp0"

python -m streamlit run dashboard_biox_dw.py

if errorlevel 1 (
    echo.
    echo No se pudo iniciar el dashboard. Comprueba Python y las dependencias.
    echo Instala las dependencias con: python -m pip install -r requirements_dw.txt
    pause
)

endlocal
