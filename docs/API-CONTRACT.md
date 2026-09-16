# API-Contract — Entwurf — noch nicht implementiert

> **Status: PLANUNG.** Dieses Dokument beschreibt eine zukünftige REST-API,
> die den aktuellen reinen Client-/localStorage-Zustand (siehe
> `api-client.js`) ersetzen könnte. **Es gibt aktuell keinen Server, keinen
> Endpoint und keine Datenbank** — die App läuft vollständig im Browser,
> alle Daten liegen in `localStorage`. Nichts in diesem Dokument ist
> implementiert oder wird durch diesen Branch implementiert. Ziel ist ein
> Java-/Spring-Boot-freundlicher Entwurf (JSON-Bodies, Standard-HTTP-Verben,
> Ressourcen-Substantive, konventionelle Status-Codes), damit ein künftiges
> Backend-Team eine klare Zielarchitektur hat.

## Warum dieses Dokument existiert

`api-client.js` (siehe dortiger Datei-Header) ist die Bridge/"Seam", hinter
der aktuell noch reiner `localStorage`-Zugriff steckt. Ein künftiges Backend
würde die Funktionen in `api-client.js` 1:1 durch `fetch()`-Aufrufe gegen
die hier skizzierten Endpoints ersetzen, ohne dass Aufrufer (index.html,
shop.html, idle.js, garage.js, ...) sich ändern müssten — das ist der ganze
Sinn der Bridge.

## Konventionen (für alle Endpoints)

- Basis-Pfad: `/api`
- Format: JSON-Request-/Response-Bodies (`Content-Type: application/json`)
- Auth: `Authorization: Bearer <token>` (Details siehe Abschnitt „Auth",
  noch nicht final entschieden — Platzhalter)
- Standard-Statuscodes: `200 OK` (Erfolg, Body vorhanden), `201 Created`
  (Ressource neu angelegt), `204 No Content` (Erfolg, kein Body, z. B.
  reines Update ohne Rückgabewert), `400 Bad Request` (ungültiger Body),
  `401 Unauthorized` (kein/ungültiger Token), `404 Not Found` (Ressource
  existiert nicht), `409 Conflict` (z. B. doppelte Review desselben Nutzers)
- Fehler-Body-Schema (Entwurf): `{ "error": "string-code", "message": "..." }`
- Ressourcen-Substantive im Pfad (keine Verben), Verben über HTTP-Methode
- Pagination/Filter (falls später nötig): Query-Parameter, nicht Teil
  dieses ersten Entwurfs

---

## 1. Auth

### `POST /api/auth/login`
Ersetzt den aktuellen Login-Platzhalter-Dialog in der Navbar
(`navbar.js` `ensureLoginDialog()` — zeigt bisher nur "Login folgt bald.",
keine echte Authentifizierung).

**Request Body:**
```json
{ "email": "string", "password": "string" }
```
**Response `200 OK`:**
```json
{ "token": "string (JWT o. ä.)", "userId": "string" }
```
**Fehlerfälle:** `401 Unauthorized` bei falschen Credentials.

---

## 2. Motorräder

### `GET /api/bikes`
Ersetzt den statischen `SHARED_BIKES`-Datensatz aus `bikes-data.js`
(aktuell rein clientseitig, kein Nutzer-spezifischer Zustand).

**Response `200 OK`:**
```json
[
  { "id": "z900", "name": "Kawasaki Z900", "category": "Naked",
    "license": "A2", "ps": 125, "kw": 92, "torque": 98.6, "weight": 212,
    "vmax": 235, "accel": 3.1, "price": 9800 }
]
```

---

## 3. Warenkorb / Shop-Konfiguration

Aktuell: **kein echter Warenkorb**, sondern zwei unabhängige Konfigurator-
Zustände in `localStorage` (`kawasaki_shop_config` für den
Tuning-Teile-Konfigurator, `vroooom_config_state` für den
Farbe/Addon-Konfigurator) — `mcAddToCart()` in `shop.html` ist bewusst nur
visuelles Placebo-Feedback ohne Persistenz. Ein künftiges Backend würde
daraus einen echten Warenkorb machen:

### `GET /api/cart`
**Response `200 OK`:**
```json
{ "bikeId": "zx10r", "partIds": ["ecu-remap", "quickshifter"],
  "color": "Metallic Blue", "addonIds": ["abs"], "totalPrice": 12200 }
```

### `POST /api/cart/items`
Fügt ein Teil/Addon zum Warenkorb hinzu (ersetzt das bisherige reine
`selectedParts`/`mcSelectedAddons`-Set im Browser-Speicher).

**Request Body:**
```json
{ "type": "part | addon | color", "id": "quickshifter" }
```
**Response `201 Created`:** aktualisierter Warenkorb (Schema wie
`GET /api/cart`).

---

## 4. Favoriten

Ersetzt `vroooom_favorites` (aktuell: `index.html` Favorites-IIFE
schreibend+lesend, `navbar.js`/`achievements.js` nur lesend — Details siehe
`api-client.js`-JSDoc).

### `GET /api/favorites`
**Response `200 OK`:** `["z900", "versys650"]` (Array von Bike-IDs)

### `PUT /api/favorites`
Ersetzt die gesamte Favoritenliste (idempotent, passend zum bisherigen
"ganze Liste speichern"-Verhalten von `Store.set`).

**Request Body:** `["z900", "versys650", "klr650"]`
**Response `204 No Content`**

---

## 5. Reviews

Ersetzt `vroooom_reviews` (aktuell: `index.html` Reviews-IIFE
schreibend+lesend, `achievements.js` nur lesend).

### `GET /api/reviews?bikeId=z900`
**Response `200 OK`:**
```json
[{ "bikeId": "z900", "rating": 5, "text": "...", "createdAt": "..." }]
```

### `POST /api/reviews`
**Request Body:**
```json
{ "bikeId": "z900", "rating": 5, "text": "Klasse Bike!" }
```
**Response `201 Created`:** die angelegte Review.
**Fehlerfälle:** `409 Conflict`, falls ein Nutzer pro Bike nur eine Review
abgeben darf (Policy noch offen).

---

## 6. Idle-Game-Zustand

Ersetzt `vroooom_idle_state` (aktuell: ein zentraler, versionierter
State-Blob, siehe `idle-core.js` `loadState()`/`saveState()`,
`IDLE_STATE_VERSION`).

### `GET /api/idle/state`
**Response `200 OK`:** der komplette Idle-State-Blob (Geld, Garage,
Fortschritt, Parts, Rechnungen/Sparschweine, ...) — Schema entspricht 1:1
dem aktuellen `vroooom_idle_state`-JSON-Objekt.

### `PUT /api/idle/state`
Ersetzt den kompletten State (passend zum bisherigen "ganzen State
überschreiben"-Verhalten von `saveState()`).

**Request Body:** kompletter State-Blob (wie oben).
**Response `204 No Content`**

---

## 7. Garage

Ersetzt `vroooom_garage_recentlyViewed` und `vroooom_garage_dreamBike`
(aktuell: `garage.js` + eine bewusst duplizierte Schreib-Logik in
`index.html`, siehe `api-client.js`-JSDoc zu diesem Risiko).

### `GET /api/garage/recently-viewed`
**Response `200 OK`:** `["z900", "h2", "versys650"]` (max. 8 Einträge,
neueste zuerst — wie bisher clientseitig gecappt)

### `POST /api/garage/recently-viewed`
**Request Body:** `{ "bikeId": "z900" }`
**Response `204 No Content`**

### `GET /api/garage/dream-bike`
**Response `200 OK`:** `{ "bikeId": "h2" }` oder `204 No Content` falls
keins gesetzt ist.

### `PUT /api/garage/dream-bike`
**Request Body:** `{ "bikeId": "h2" }`
**Response `204 No Content`**

---

## 8. Statistiken

Ersetzt `vroooom_stats_v1` und `vroooom_stats_visitedPages` (`stats.js`).

### `GET /api/stats`
**Response `200 OK`:** Schema entspricht dem aktuellen Stats-Objekt aus
`stats.js` (besuchte Seiten, gezählte Aktionen, ...).

### `POST /api/stats/events`
Ersetzt das bisherige `recordStat(...)`-Pattern (Ereignis-basiertes
Hochzählen statt vollständigen State zu überschreiben).

**Request Body:** `{ "type": "string", "payload": { } }`
**Response `204 No Content`**

---

## 9. Achievements

Ersetzt `vroooom_achievements` (`achievements.js`).

### `GET /api/achievements`
**Response `200 OK`:**
```json
[{ "id": "first-favorite", "unlockedAt": "2026-09-15T12:00:00Z" }]
```

### `POST /api/achievements/{id}/unlock`
**Response `201 Created`** (neu freigeschaltet) oder `200 OK` (war schon
freigeschaltet, idempotent).

---

## 10. Rennsimulator-Rekorde

Ersetzt `kawasaki_records` und `raceHighscore` (`race.html`).

### `GET /api/race/records`
**Response `200 OK`:**
```json
{ "records": [ { "mode": "sprint", "timeMs": 12340 } ],
  "highscore": 4200 }
```

### `POST /api/race/records`
**Request Body:** `{ "mode": "sprint", "timeMs": 12340 }`
**Response `201 Created`**, falls es einen neuen persönlichen Rekord/
Highscore darstellt, sonst `200 OK` mit unverändertem Datensatz.

---

## 11. Wartungsrechner (Maintenance)

Ersetzt `vroooom_maint_state` (eigenständiges Feature in `index.html`).

### `GET /api/maintenance/state`
**Response `200 OK`:** aktueller Wartungsrechner-Zustand (Schema wie
bisheriges `vroooom_maint_state`-JSON).

### `PUT /api/maintenance/state`
**Request Body:** kompletter Zustand (wie oben).
**Response `204 No Content`**

---

## Bewusst NICHT Teil dieser API (bleiben rein clientseitig)

- Theme/Helligkeit/A11y-Einstellungen (`settings.js`: `theme`,
  `vroooom_brightness`, `vroooom_a11y_contrast`, `vroooom_a11y_text`,
  `vroooom_a11y_motion`) — reine UI-Präferenz, muss synchron vor dem
  ersten Render feststehen (Flash-of-wrong-theme-Risiko bei einem
  asynchronen API-Call), keine fachliche/Server-Relevanz.
- `theme-toggle.js`, `navbar.js`-Theme-Fallback — dieselbe Begründung.
- SoundCheck-eigene Keys (`soundcheckFavorites`, `soundcheckVolume` in
  `soundcheck.js`) — `soundcheck.js`/`soundcheck.html` sind laut
  `GOLDEN_PRINCIPLES_KE.md` Regel 6 geschützt und bewusst außerhalb des
  Scopes dieser Planung.
- `openclaw-test/*` — separates, nicht verlinktes Altsystem mit eigenem
  Key-Schema, außerhalb des Hauptapp-Datenmodells.

## Mapping zur aktuellen Bridge (`api-client.js`)

Jede Funktion in `api-client.js` (`getFavorites`/`setFavorites`,
`getAllReviews`/`addReview`, `getShopConfig`/`setShopConfig`,
`getConfiguratorState`/`setConfiguratorState`, `loadIdleState`/
`saveIdleState`, `getRecentlyViewed`/`addRecentlyViewed`, `getDreamBike`/
`setDreamBike`, `getStats`/`recordStat`, `getAchievements`/
`unlockAchievement`, `getRaceRecords`/`saveRaceRecord`,
`getMaintenanceState`/`setMaintenanceState`) entspricht genau einem oder
zwei der obigen Endpoints. Eine künftige Migration tauscht in
`api-client.js` nur den `readJSON`/`writeJSON`-`localStorage`-Zugriff
gegen `fetch()`-Aufrufe gegen diese Endpoints aus — die Aufrufer
(index.html, shop.html, idle.js, garage.js, race.html, stats.js,
achievements.js) bleiben unverändert, solange die Funktionssignaturen
gleich bleiben.
