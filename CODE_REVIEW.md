# Application review — 6 October 2026

The findings below describe the original review snapshot. The application has since been updated; remediation and verification are recorded at the end of this document.

Reviewed the current working tree: all JavaScript modules, page flows, IndexedDB storage, PHP authentication and synchronization, service worker, launch scripts, and deployment configuration. This includes the recent group counts, person editor, and session cancellation changes. No application code or user data was changed during this review.

P1 means a security or data-loss issue to address first. P2 means a functional or reliability issue. Business-rule assumptions and verification limits are called out below.

## Findings

### 1. P1 — The static launcher exposes data and PHP source

Location: `serve.sh:60`; `deploy/ovh-perso-php-login/.htaccess:1`.

The static launcher serves the entire `pwa` directory with Python's HTTP server. It does not process PHP or Apache access rules. Consequently, `/data/users.json`, synchronization backups containing personal information, and PHP source are downloadable. `--listen-all` exposes this to other computers on the network. This is a concrete property of the launcher, not a claim that the production site currently exposes these files.

Use the PHP launcher for this repository, or give the static preview a separate directory containing only public assets. Move private storage outside the document root. Production access protection should fail closed rather than depend entirely on an optional rewrite module.

### 2. P1 — Distinct accounts can share the same storage namespace

Location: `pwa/api/_auth.php:99`; `pwa/db.js:99`.

Authentication compares usernames exactly, but both local database names and server filenames lowercase and replace punctuation in usernames. `Alice` and `alice`, or `A-B` and `A_B`, authenticate as distinct accounts but map to the same data. The account creation script does not reject these collisions. This can expose or overwrite another account's information if such accounts are provisioned.

Use a stable unique account ID for storage, with a migration that preserves existing databases and backups. At minimum, reject colliding normalized usernames when accounts are created. Do not change filename normalization alone without migrating existing files.

### 3. P1 — Push synchronization loses pending-change tracking and retries

Location: `pwa/app.js:79`, `pwa/app.js:104`, `pwa/app.js:115`.

A local edit made after a push snapshot is taken is marked dirty, but the successful response clears that flag unconditionally. The pending timer may then run within the 2.5-second backoff and return without scheduling another attempt. Failed requests have the same timing problem: their retry is scheduled after 1.2 seconds, then blocked by the 2.5-second backoff. Local changes can remain unsent, and clearing the dirty flag makes them eligible to be overwritten by a pull.

Both failure paths were reproduced against the actual synchronization functions in a VM harness. Track a local change generation; acknowledge only the generation included in the snapshot. Schedule retries for the remaining backoff and clear dirty state only after the corresponding changes are acknowledged. Show a persistent unsynced/error status rather than swallowing failures.

### 4. P1 — A pending pull can overwrite edits made while it downloads

Location: `pwa/app.js:138–154`.

The clean-state check happens before the network request. If the user changes attendance or edits a person while the request is pending, the response still calls `replaceAll`, then clears the dirty flag. This overwrites the newer local change. Reproduced with a delayed response and an intervening local edit.

Recheck the local change generation after receiving the response, immediately before applying it. Coordinate local writes and replacement so there is no further gap. Startup also needs to respect dirty state: the current empty-trainee check can pull over locally created groups or settings on a device without trainees.

### 5. P1 — Multi-device synchronization has no conflict detection

Location: `pwa/api/sync_push.php:26–59`; `pwa/app.js:146`.

Every push replaces the complete server snapshot without checking which revision the client edited. Two devices can silently overwrite each other's independent changes. The revision is a timestamp in whole seconds, so two different snapshots saved during the same second are indistinguishable to the client's `updatedAt <= lastAppliedUpdatedAt` check.

Introduce a monotonic server revision and conditional writes against the client's base revision. Return a conflict response instead of silently replacing newer data. A full-record merge can follow if needed; revision checking is the smaller first step.

### 6. P1 — Incomplete or malformed imports can erase valid data

Location: `pwa/logic.js:123–149`; `pwa/db.js:89–95`; `pwa/pages/settings.js:215`.

Import validation only checks whether a `data` property exists. A JSON file with only `data.trainees` is accepted, clears every store, and removes pricing settings. Payments and settings then dereference missing pricing. This destructive replacement was reproduced.

There is a second failure path: all `clear` requests are queued before iterating imported rows. If a store contains a non-iterable value or a synchronous `put` error occurs, the transaction runner throws. The transaction helper rejects its Promise but does not explicitly abort the transaction. Queued operations can still commit. The missing-abort behavior was verified with a transaction simulation; native IndexedDB execution remains unverified.

Validate the complete versioned payload, required settings, records, field types, and relationships before opening a write transaction. Handle supported older formats explicitly. Abort transactions when the runner throws. Keep existing data intact on validation or storage failure.

### 7. P2 — Deleting a schedule entry can remove the wrong entry

Location: `pwa/pages/groups.js:137–152`.

The displayed schedule is sorted, but the delete handler applies the displayed index to the original unsorted array. Add Friday first and Monday second; deleting the first displayed Monday row removes Friday. Reproduced using the current sorting and deletion logic.

Preserve the original index while sorting, or give schedule entries stable IDs and delete by ID. Add a regression test with entries added out of chronological order.

### 8. P2 — Person and membership saves are not atomic

Location: `pwa/pages/people.js:172–201`.

The person is saved in one operation and group memberships in a separate transaction. If membership persistence fails, the person remains saved while the form appears unfinished. Saving again during new-person creation generates another person ID. There is also no pending-save guard, so repeated clicks can create duplicate people or conflicting memberships.

Save the person and membership changes in one transaction, disable submission while it is pending, and retain the form with a controlled error when saving fails. Test membership failure and repeated clicks using native IndexedDB or a faithful test substitute.

### 9. P2 — Payment rendering races with month and filter changes

Location: `pwa/pages/payments.js:117–187`.

Every change starts another asynchronous `renderList`, without cancelling or invalidating its predecessor. The function reads mutable `selectedMonth` across awaits and appends into the same list. Older renders can append stale or mixed-month results. Row click handlers also use the current global month rather than the month of the rendered payment. Concurrent renders can race while creating the same uniquely indexed payment.

Capture the month and filters per render, use a render generation to discard stale results, and bind actions to the rendered payment's month. Make payment creation atomic. Rendering should preferably read data rather than create payment records for every person on every filter change.

### 10. P2 — Input constraints are not enforced by save handlers

Location: `pwa/pages/settings.js:107–109`; `pwa/pages/people.js:178`; `pwa/pages/groups.js:288`, `pwa/pages/groups.js:438`.

Several handlers convert inputs with `Number` without validating finite values, nonnegative amounts, integer session counts, or the minimum training duration. Save buttons are `type="button"`, so HTML `min` and `step` attributes do not automatically prevent those handlers from saving invalid values. Negative fees and session counts can reach pricing calculations; invalid numbers can become `null` during JSON export.

Validate values in the handlers and shared logic. Keep the already implemented payment-amount validation consistent across the other forms. Validate dates and schedule times too, including imported values.

Related business-rule decision: `computeAutoFee(0, defaultPricing)` returns the lowest paid tier, currently 120. Reproduced. If a person without any weekly sessions should owe zero, add an explicit zero-session rule. If a minimum membership fee is intended, document and test it instead.

### 11. P2 — Attendance statistics do not respect membership history

Location: `pwa/pages/stats.js:108–149`, `pwa/pages/stats.js:618`.

Expected attendance uses today's memberships for every day in the chosen historical range, ignoring membership `createdAt`. A person assigned today is counted as absent for earlier sessions; the reproduced last-month example counted five sessions. Removing a membership also changes historical denominators. Individual presence counts use stored rows without requiring the same schedule/membership criteria as the denominator, so a removed membership can leave positive presence with a zero denominator.

Apply membership start/end dates consistently to both numerator and denominator, or store session roster snapshots if accurate history is required. Clarify what happens when weekly schedules change. Overdue payments also assume liability for all previous five months even for a newly added person; use an explicit billing start date or established payable records.

### 12. P2 — Chart labels treat user input as markup

Location: `pwa/pages/stats.js:189`, `pwa/pages/stats.js:452`, `pwa/pages/stats.js:569`.

Group names are interpolated directly into SVG strings and inserted with `insertAdjacentHTML`. A name such as `<g>` becomes an SVG element instead of literal text; this markup injection was reproduced. Name truncation and the deployed CSP limit straightforward script execution, so executable XSS has not been demonstrated. Rendering user input as markup remains unsafe and can corrupt the chart DOM.

Build SVG elements with DOM APIs and set labels through `textContent`, or correctly escape every textual interpolation. Keep the CSP as an additional protection, not the input-rendering mechanism.

### 13. P1 — Server persistence can report success without saving

Location: `pwa/api/sync_push.php:43–62`.

The write result is checked, but `rename` failure is ignored and the endpoint still returns success. The client then marks its data as synchronized although the final file may not have changed. Every request also uses the same `.tmp` filename; writes from separate device sessions can interfere because locking the temporary write does not lock the complete replacement sequence.

Lock the whole revision-check/write/replace operation, use a unique temporary file, check replacement success, and acknowledge only the committed revision. Test write failure, rename failure, and overlapping device requests on PHP.

### 14. P2 — Runtime data and default credentials are tracked with source

Location: tracked `pwa/data/users.json`, tracked `pwa/data/sync_justyna.json`, and `pwa/api/_auth.php:22`.

Git tracks account/password-hash storage and a synchronization data file. The application also contains shared default passwords, and deployment documentation repeats them. No personal records or credential values are reproduced here. Repository sharing or deploying the full tracked directory can carry runtime data and known account configuration with it. The deployment instructions also incorrectly say production automatically seeds default users, while the implementation restricts that to its local-runtime check.

Exclude runtime storage from version control, provide synthetic fixtures, and provision credentials explicitly. Check whether the tracked credentials/data were real or shared before deciding on rotation and history cleanup. Do not delete working data as part of cleanup without a backup and migration plan. Determine local mode from trusted configuration rather than a client-controlled Host header.

## Smaller improvements

- Centralize synchronization. Settings implements its own push/pull calls and updates localStorage independently of the app's in-memory revision and dirty flags.
- Extract a minimal shared DOM test harness and provide one test command. Current regression scripts duplicate mocks and do not exercise browser event propagation or native IndexedDB transaction behavior.
- Batch payment data reads. Current payment rendering does sequential membership and payment requests for every person, repeated on every search keystroke.
- Roll back optimistic attendance/payment toggles when writes fail, and report actionable errors. Several UI handlers update the display before awaiting storage without recovery.
- Delete related `sessionScopes` when deleting a group; removing only the group, memberships, and attendance leaves orphaned session metadata.
- Handle nested controls in `bigListItem` keyboard events. Enter/Space on the payment edit button bubbles to the row's key handler and can also toggle payment state.
- Remove the unused `importAll` function if it is not intended as a supported public integration point, and define the store-name list once instead of repeating it.
- Correct references to the absent `serve.ps1` file. Align the launcher and deployment documentation with the currently supported PHP setup.
- Decide explicitly whether logout should preserve personal data in IndexedDB on shared devices. It currently clears caches but retains the local database.

## Verification and suggested order

Both regression scripts pass: `scripts/test_people_editor.mjs` and `scripts/test_session_cancellation.mjs`. All JavaScript modules pass Node syntax checks. Targeted probes reproduced push dirty-state loss, stalled retry, pull overwrite, namespace collisions, incomplete-import clearing, wrong schedule deletion, pre-membership absences, zero-session pricing, and chart markup injection. The transaction exception path was checked with a simulated transaction.

PHP was unavailable in this environment, so PHP syntax/runtime tests were not performed. No production requests, credential changes, database migrations, or native browser tests were performed. Static-server exposure is based on launcher/configuration inspection; the deployed server's access rules were not tested.

Fix data exposure, namespace isolation, synchronization, import safety, and server save acknowledgement first. Then fix schedule deletion, atomic person saves, payment render races, validation, and reporting history. Follow with shared test infrastructure and documentation cleanup. The existing tests passing does not establish coverage for these newly identified failure paths.

## Remediation completed

| Finding | Change | Verification |
| --- | --- | --- |
| 1: static exposure | Both launchers require PHP; private storage is outside the public root; legacy data routes and internal modules are denied, including encoded/case variants. Apache rewrite protection is required. | PHP route tests and Bash checks |
| 2: namespace collision | Exact-username account hashes isolate local databases and server files. Unambiguous legacy data is copied; ambiguous migration is withheld. | PHP account-isolation tests and native IndexedDB migration tests |
| 3: push tracking/retries | Pending-change tokens survive in-flight edits; acknowledgement only clears the matching snapshot; retries are scheduled without the conflicting debounce/backoff logic. | Synchronization regression harness and full app sync |
| 4: pull overwrite | Dirty state is marked before writes and checked again before replacement; unsafe pulls are discarded. Missing/unavailable sync metadata cannot authorize automatic replacement. | Delayed-response and unavailable-metadata tests |
| 5: device conflicts | Conditional writes require a base revision; server revisions advance for every commit; conflicting clients retain local data and receive a visible conflict. | Concurrent PHP sessions and same-second revision tests |
| 6: unsafe imports | Complete payloads, relationships, settings, dates, uniqueness, and numeric values are validated before writes. Runner errors abort native transactions. Existing version 1 backups remain supported. | Invalid-import tests, real IndexedDB rollback, and a read-only compatibility check of the existing local backup |
| 7: wrong schedule deletion | Entries are removed by identity/content rather than their displayed sort index. Schedule versions are preserved by date. | Unsorted schedule regression |
| 8: partial person save | People and memberships are written atomically, using one stable draft ID. Async buttons block repeated saves and retain the form on failure. | Injected membership failure and native repeated-save/group-assignment tests |
| 9: payment races | Rendering snapshots filters/month, discards stale reads, batches data, and never creates payments. Actions bind to the displayed month; persistence uses transactions. | Controlled stale reads, concurrent payment writes, and full browser workflow |
| 10: missing validation | Numeric/time constraints are checked in save handlers and shared logic. Zero sessions produce zero auto fee; fractional amounts are displayed accurately. | Negative/nonfinite/fractional session tests and backend schema tests |
| 11: inaccurate history | Closed/reopened membership periods and schedule versions drive attendance denominators and numerators. Historical billing excludes months before enrollment unless a payment was explicitly recorded. | Historical membership/schedule tests and integrated statistics |
| 12: chart injection | Labels are escaped before SVG insertion. | Markup-label regression |
| 13: false save acknowledgement | The full revision/write/rename sequence is locked. Unique temporary files are checked, cleaned up, and acknowledged only on success. | Competing-session and injected rename-failure tests |
| 14: tracked data/default credentials | Default-password seeding and credential examples were removed. Runtime account/data files were removed from the Git index and ignored; working files remain on disk. Private account provisioning is explicit. | Source/configuration review and isolated authentication tests |

Smaller improvements are also implemented: one synchronization coordinator, a shared regression harness and test command, batched payment reads, attendance/payment UI updates after successful writes, atomic bulk attendance, related session metadata cleanup, keyboard propagation checks, removal of unused import code, corrected launcher/deployment documentation, optional local-data removal on logout, and cache cleanup restricted to this app.

The final checks pass: Node regression scripts and JavaScript syntax, PHP 7.4 syntax/runtime tests through WSL, Bash syntax/launcher checks, native Chrome transactions/dialogs/migrations, and the complete authenticated browser workflow. The full workflow verifies fresh-device pulls and recovery after logout with local-data removal. Existing local runtime files and the compatible local backup were preserved. No production deployment or Git-history rewrite was performed.

Operational follow-up remains: deploy the frontend/API and private-storage configuration together, rotate any previously shared credentials, and assess repository-history exposure. Old passwords were deliberately not changed without a chosen replacement, and old commits still contain previously tracked files. History deleted before this update cannot be reconstructed automatically; ambiguous legacy account data requires administrator reconciliation. These limits are explained in the deployment documentation.
