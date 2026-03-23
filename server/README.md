# Klub — serwer + logowanie

Ten serwer:
- serwuje pliki z `../pwa/`
- wymaga logowania (bez rejestracji)
- ma 2 domyślnych użytkowników:
  - Arek / EarlGrey011
  - Justyna / EarlGrey011

## Start lokalnie

```bash
cd server
cp .env.example .env
npm install
npm start
```

Otwórz: `http://localhost:3000/`

## Produkcja (ważne)

- Ustaw `JWT_SECRET` na długi losowy sekret.
- Postaw HTTPS (np. Nginx + Let's Encrypt) i ustaw proxy do `http://127.0.0.1:3000`.
- Cookie w trybie produkcyjnym jest `Secure` (wymaga HTTPS).

