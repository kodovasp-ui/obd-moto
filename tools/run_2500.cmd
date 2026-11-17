@echo off
py obd_cli.py live 40 --pids 0C,11,06,07,0E,14,15 --delay 15 --banner rev2500 --out live_2500.csv
