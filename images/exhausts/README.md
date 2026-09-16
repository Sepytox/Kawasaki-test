# images/exhausts/ — Foto-Konvention (Scaffold, noch nicht angebunden)

Analog zu `images/bikes/` (siehe dortige README) — dieses Verzeichnis ist
absichtlich leer und enthält **keine** externen/heruntergeladenen Bilder.
Es dient als vorbereitetes Scaffold für eine spätere Erweiterung; es gibt
aktuell noch KEIN Manifest-Objekt/keine Lade-Logik im Code, die dieses
Verzeichnis referenziert (im Unterschied zu `images/bikes/` +
`bike-image.js`). Ein späterer Task müsste analog zu `BIKE_PHOTO_MANIFEST`
in `bike-image.js` ein `EXHAUST_PHOTO_MANIFEST` (oder Vergleichbares) samt
Ladepfad/Fallback ergänzen.

## Konvention (vorgesehen)

```
images/exhausts/<part-id>.png
```

`<part-id>` ist die `id` aus dem `PARTS`-Array in `shop.html`, für die
`cat:'exhaust'` gesetzt ist. Aktuell 4 Einträge:

```
akrapovic-slip, yoshimura-race, arrow-full, sc-project
```

Beispiele: `images/exhausts/akrapovic-slip.png`,
`images/exhausts/arrow-full.png`.

## Format-Empfehlung

- Format: `.png`
- Seitenverhältnis: 16:9 (analog zu `images/bikes/`)
- Keine eingebetteten Wasserzeichen/Fremdlogos; nur Bildmaterial, an dem die
  nötigen Rechte vorliegen (kein automatisierter Download aus dem Internet).
