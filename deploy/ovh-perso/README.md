# OVH Web Hosting Perso — logowanie przez `.htaccess` (Basic Auth)

Ten wariant działa na hostingu współdzielonym (OVH Perso) bez Node.

## Co wgrać na serwer

1) Z katalogu `pwa/` wgraj **wszystkie pliki** do katalogu WWW Twojej subdomeny (Multisite), np.:
- `index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.webmanifest`, `assets/`, `pages/` itd.
 - `whoami.php` (pozwala aplikacji rozdzielić dane per użytkownik Basic Auth)

2) Do tego samego katalogu WWW wgraj:
- `.htaccess` (z tego folderu)
- `.htpasswd` (wygenerowany lokalnie — patrz niżej)

## Generowanie `.htpasswd` (WSL / bash)

Wykonaj lokalnie:

```bash
cd /mnt/c/Users/jw224/Documents/DEV/trainee_management/deploy/ovh-perso
chmod +x ./make-htpasswd.sh
./make-htpasswd.sh .htpasswd
```

Skrypt poprosi o hasła i zrobi plik `.htpasswd` dla użytkowników:
- Arek
- Justyna

Potem wgraj `.htpasswd` na serwer (FTP) do katalogu WWW subdomeny.

## Ustawienie poprawnej ścieżki `AuthUserFile`

W pliku `.htaccess` musisz ustawić absolutną ścieżkę do `.htpasswd` na serwerze, np. coś w stylu:
`/homez.XXX/login/www/.htpasswd`

Najprostszy sposób na poznanie ścieżki:
1) Wgraj na chwilę plik `path.php` do katalogu WWW z treścią:
   `<?php echo __DIR__;`
2) Otwórz `https://twoja-subdomena/path.php` i skopiuj wynik (to jest ścieżka katalogu WWW).
3) Ustaw w `.htaccess`:
   `AuthUserFile /SKOPIOWANA_SCIEZKA/.htpasswd`
4) Usuń `path.php` z serwera.

## Ważne

- Włącz HTTPS na subdomenie (Basic Auth bez HTTPS nie ma sensu).
- Basic Auth nie ma "wyloguj" w aplikacji: przeglądarka pamięta dane logowania. Żeby wylogować, zamknij wszystkie karty dla tej domeny albo usuń zapisane hasło dla strony.
- Po testach zmień hasła na dłuższe i unikalne (Basic Auth na hostingu współdzielonym zwykle nie ma rate-limit).
- Ten wariant zabezpiecza stronę na poziomie serwera WWW. Aplikacja dalej trzyma dane w przeglądarce (IndexedDB) na urządzeniu.
  Dane są rozdzielone per użytkownik (po loginie) przez osobną bazę IndexedDB na każdy login.
