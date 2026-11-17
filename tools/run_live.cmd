@echo off
py "%~dp0obd_cli.py" live 60 --pids 0C,05,04,0B,06,07,0E,11,14,15 --wait-temp 80 --phases --out live_warm.csv
