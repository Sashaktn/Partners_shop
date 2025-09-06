@echo off
npm install > log.txt 2>&1
npm start >> log.txt 2>&1
pause
