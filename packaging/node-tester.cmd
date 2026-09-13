@echo off
setlocal
node.exe "%~dp0package\dist\cli.js" %*
exit /b %errorlevel%
