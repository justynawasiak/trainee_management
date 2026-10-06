# Klub — application behavior

- People can be assigned to several groups when created or edited. The person and assignments are saved together.
- Each group shows the number of currently assigned people.
- Attendance can be recorded for a selected date. A group can be cancelled or restored for that date. Cancellation preserves attendance records but excludes the session from statistics.
- Monthly payment lists are read-only until a payment or amount is changed. Zero weekly sessions produce a zero automatic fee. Manual fees remain supported.
- Numeric values, schedule times, and backups are validated before saving.

## History

Removing someone from a group closes their membership period instead of deleting its history. Rejoining opens another period. Group schedule changes preserve previous schedules, effective by date. Attendance statistics use these periods and schedules. Legacy history that was deleted before this update cannot be reconstructed automatically. Previously stored memberships use their creation date as the available starting point.

Monthly billing starts with a person's creation month; earlier explicit payment records remain stored. Cancelled sessions do not change the recurring fee. If a club charges a separate minimum membership fee, configure it manually rather than relying on a person having zero sessions.

## Synchronization and backup

Local changes are marked unsynchronized before writes and cleared only after the server acknowledges that snapshot. Failed requests retry. The server requires a matching revision; competing device edits create a visible conflict instead of overwriting each other.

Resolve a conflict in Settings: export the local backup, then choose which version to keep. The download action saves a backup before replacing unsynchronized local data. To retain local changes after downloading the server version, reapply them or import a deliberately reconciled complete backup. Imports also export the previous local state and reject incomplete or invalid files before any replacement.

All synchronization controls use the same coordinator. Synchronization runs quietly in the background; a status message displays errors or conflicts. Credentials and private server files are never served as static assets.

Settings offers logout, which retains the browser's local database. Unsynchronized changes must be synchronized or backed up and resolved first. Clearing server authentication is checked before leaving the page.

## Running

Use `../serve.sh` or `../serve-php.sh` from WSL/Bash. Both require PHP and start authenticated routes. See the root README for provisioning, tests, and migration. There is no PowerShell launcher or static-server mode.
