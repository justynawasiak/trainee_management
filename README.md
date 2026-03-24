# Trainee Management / Klub (PWA)

Prosta aplikacja mobilna do zarządzania małym klubem sportowym jest w katalogu `pwa/`.

Start lokalnie (WSL / bash):

```bash
chmod +x ./serve.sh
./serve.sh --port 5173
```

Start lokalnie z logowaniem (PHP; jak na OVH Perso):

```bash
chmod +x ./serve-php.sh
./serve-php.sh --port 5173
```

Utworzenie lokalnego uzytkownika:

```bash
chmod +x ./create-local-user.sh
./create-local-user.sh Arek EarlGrey011
```

Uwaga: dane przeglądarki są powiązane z adresem (host + port), więc trzymaj stały port (np. `5173`), jeśli chcesz widzieć te same dane.

Dokumentacja: `pwa/README.md`.
