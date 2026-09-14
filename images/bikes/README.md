# images/bikes/ — Foto-Konvention

Dieses Verzeichnis ist absichtlich leer (bis auf diese README) und enthält
**keine** externen/heruntergeladenen Bilder.

## Konvention

Lege eine echte Fotografie eines Motorrads unter folgendem Pfad ab, um die
automatisch generierte SVG-Illustration für dieses Modell zu ersetzen:

```
images/bikes/<bike-id>.jpg
```

`<bike-id>` ist der Schlüssel aus `SHARED_BIKES` (siehe `bikes-data.js`),
z. B. `images/bikes/z900.jpg`, `images/bikes/versys650.jpg`,
`images/bikes/klr650.jpg`.

**Zusätzlich nötig:** Trage die `<bike-id>` in `BIKE_PHOTO_MANIFEST` am
Anfang von `bike-image.js` ein (z. B. `{ z900: true }`). Nur IDs in diesem
Manifest lösen überhaupt einen Ladeversuch für `images/bikes/<id>.jpg` aus —
so entstehen für (noch) nicht hinterlegte Fotos keine 404-Anfragen im
Browser. Beide Schritte (Datei ablegen + Manifest-Eintrag) sind für ein
neues Foto nötig; reines Ablegen der Datei ohne Manifest-Eintrag hat keine
Wirkung.

## Verhalten (siehe `bike-image.js`)

- Ist die `<bike-id>` im `BIKE_PHOTO_MANIFEST` eingetragen, wird die Datei
  geladen und beim erfolgreichen Laden sanft eingeblendet (Fade-in).
  Schlägt das Laden trotzdem fehl (z. B. Datei doch nicht vorhanden), wird
  automatisch und ohne sichtbaren Fehler auf eine selbst erzeugte,
  kategorie-spezifische SVG-Illustration zurückgefallen (Sport, Naked,
  Touring/Adventure, Retro, Offroad, Cruiser je nach Kategorie des Modells).
- Ist die `<bike-id>` NICHT im Manifest (Standardfall — `images/bikes/`
  enthält aktuell keine echten Fotos), wird direkt die SVG-Illustration
  angezeigt, ganz ohne Ladeversuch für ein Foto — keinerlei externe
  Bild-Requests, kein Broken-Image-Icon, keine 404-Konsolenmeldungen.

## Format-Empfehlung

- Format: `.jpg`
- Seitenverhältnis: 16:9 (wird per CSS zugeschnitten, `object-fit: cover`)
- Keine eingebetteten Wasserzeichen/Fremdlogos; nur Bildmaterial, an dem die
  nötigen Rechte vorliegen (kein automatisierter Download aus dem Internet).
