# APK (opakowanie PWA jako aplikacja)

Ten katalog dodaje „opakowanie” Android APK na bazie **Capacitor**. W środku jest WebView, a pliki z `../pwa/` są kopiowane do `mobile/www/` i pakowane razem z APK — dzięki temu aplikacja działa bez komputera.

## Wymagania (Android)

- Node.js LTS + npm
- Android Studio (SDK + Build Tools)
- JDK 17 (zalecane)

## Szybki start (WSL / bash)

Z poziomu repo:

```bash
cd /mnt/c/Users/jw224/Documents/DEV/trainee_management/mobile
npm install
./scripts/sync-web.sh
npx cap add android
npx cap copy android
npx cap open android
```

W Android Studio:

- `Build` → `Build Bundle(s) / APK(s)` → `Build APK(s)`

APK będzie działać offline (dane trzymane lokalnie w WebView: IndexedDB).

## Aktualizacja wersji web

Po zmianach w `../pwa/`:

```bash
./scripts/sync-web.sh
npx cap copy android
```

## Uwagi

- Service Worker z PWA może nie być potrzebny w APK (assets są w paczce). Jeśli zobaczysz problemy, można go wyłączyć dla trybu Capacitor.
- Jeśli chcesz też iOS: da się, ale wymaga macOS/Xcode.

