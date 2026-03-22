# Klub — prosta aplikacja mobilna (PWA)

To jest prosta aplikacja typu **PWA** (działa w przeglądarce na telefonie i można ją „zainstalować” na ekranie głównym).

## Najważniejsze funkcje

- Osoby: imię, nazwisko, telefon, e-mail
- Grupy + harmonogram
- Przypisywanie osób do grup + treningi/tydzień (suma po grupach)
- Obecność: **1 klik** na osobę w wybranej grupie i dacie
- Płatności: **1 klik** na osobę w danym miesiącu

## Uruchomienie lokalnie

W katalogu repo uruchom:

```powershell
.\serve.ps1 -Port 5173
```

Albo w WSL (bash):

```bash
chmod +x ./serve.sh
./serve.sh --port 5173
```

Potem otwórz w przeglądarce: `http://localhost:5173/`

Na telefonie (w tej samej sieci Wi‑Fi) wejdź na `http://<IP_twojego_komputera>:5173/`.

Jeśli chcesz wejść z telefonu bez hostingu zewnętrznego, spróbuj:

```powershell
.\serve.ps1 -Port 5173 -ListenAll
```

(Tryb `-ListenAll` może wymagać dodatkowych uprawnień/urlacl w Windows.)

W WSL odpowiednik:

```bash
./serve.sh --port 5173 --listen-all
```
