@echo off
setlocal
cd /d "%~dp0"
python etl_biox_dw_gui.py
if errorlevel 1 (
    echo.
    echo No se pudo iniciar la interfaz ELT BIOX.
    echo Verifique Python y las dependencias de requirements_dw.txt.
    pause
)
endlocal
