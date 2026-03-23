# OVH Web Hosting Perso — logowanie w aplikacji (PHP sesje)

Ten wariant daje logowanie w oknie strony (nasz `login.html`) i działa na OVH Perso bez Node.

## Co wgrać

Do katalogu WWW subdomeny wgraj **cały** `pwa/` (w tym folder `api/` i plik `gate.php`).

## `.htaccess` (ważne)

Wgraj do katalogu WWW subdomeny plik `.htaccess` z tego folderu.
On sprawia, że wejście na `/` i odświeżenia zawsze przechodzą przez `gate.php` (czyli: pokaż login albo aplikację).

## Użytkownicy

Przy pierwszym logowaniu serwer utworzy plik `pwa/data/users.json` z domyślnymi kontami:
- Arek / EarlGrey011
- Justyna / EarlGrey011

Po testach zmień hasła (wygeneruję Ci nowy `users.json` albo dopiszę endpoint admina — jak wolisz).

## Bezpieczeństwo

- Koniecznie włącz HTTPS na subdomenie.
- Pliki w `pwa/data/` są blokowane przez `.htaccess`.

