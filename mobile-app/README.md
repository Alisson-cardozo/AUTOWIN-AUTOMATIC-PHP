# Autowin Android (Capacitor)

App shell do portal Autowin.

## Config

- **URL do portal:** `https://alisson-projetos.fun` (`capacitor.config.json` → `server.url`)
- **App ID:** `com.autowin.app`
- **JDK:** 21 (`C:\Users\Aliss\dev-tools\jdk-21-extract\jdk-21.0.11+10`)
- **Android SDK:** `C:\Users\Aliss\dev-tools\android-sdk`

## APK debug

Arquivo gerado:

```
mobile-app/dist/Autowin-debug.apk
```

(também em `android/app/build/outputs/apk/debug/app-debug.apk`)

### Instalar no celular

1. Copie o APK para o Android (USB / Drive / WhatsApp).
2. Em **Configurações → Segurança**, permita instalar apps de fontes desconhecidas.
3. Abra o APK e instale.
4. Ao abrir, o app carrega o portal em **https://alisson-projetos.fun**.

## Rebuild

```powershell
$env:JAVA_HOME = "C:\Users\Aliss\dev-tools\jdk-21-extract\jdk-21.0.11+10"
$env:ANDROID_HOME = "C:\Users\Aliss\dev-tools\android-sdk"
cd c:\Users\Aliss\Desktop\autowin-php-cp\mobile-app
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

## Observação (fase 1)

Este APK é o **shell**: abre o portal no WebView.  
A aposta Bac Bo REAL no dispositivo (motor local anti-Akamai) é a **fase 2**.
