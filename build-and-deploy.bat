@echo off
echo === Building frontend...
cmd /c "cd frontend && npm run build"
if errorlevel 1 (echo BUILD FAILED & exit /b 1)

echo === Copying frontend build to backend/public...
xcopy /E /Y /I frontend\dist\* backend\public\
if errorlevel 1 (echo COPY FAILED & exit /b 1)

echo === Deploying to Fly.io...
fly deploy --app trading-analyzer-affqwq
echo === Done!
