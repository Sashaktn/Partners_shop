@echo off
cd /d "%~dp0partner-shop\server"
call npm install
start http://localhost:3025
call npm start
pause