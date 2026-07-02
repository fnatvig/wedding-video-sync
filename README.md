# Bröllopsfilm – Firebase Sync

Detta är första riktiga versionen med:
- gästvy
- adminvy
- antal anslutna
- antal redo
- admin-knapp: STARTA FILMEN
- gemensam serverbaserad starttid via Firebase

Du behöver inte installera npm eller Node.js.

## Steg 1: Skapa Firebase-projekt

1. Gå till Firebase Console.
2. Skapa nytt projekt.
3. Lägg till en Web App.
4. Kopiera `firebaseConfig`.
5. Skapa Realtime Database.
6. För snabbt test: välj test mode.

## Steg 2: Klistra in config

Öppna:

firebase-config.js

Ersätt placeholder-värdena med din riktiga Firebase config.

Viktigt: `databaseURL` måste vara med.

## Steg 3: Lägg in regler

I Realtime Database > Rules kan du för test använda reglerna i:

firebase-rules-test.json

Det är öppna regler. Använd dem bara för test/bröllopet, inte för något känsligt.

## Steg 4: Lägg in video

Lägg en kort MP4 i mappen och döp den till:

video.mp4

## Steg 5: Ladda upp på Netlify Drop

Dra hela mappen till Netlify Drop.

## Steg 6: Testa

Öppna:

/admin.html

Kopiera gästlänken till flera mobiler.

På varje mobil:
- öppna gästlänken
- tryck "Jag är redo"

I admin:
- kontrollera antal anslutna/redo
- tryck "STARTA FILMEN"

## Obs

Videon är muted i prototypen för att maximera chansen att autostart fungerar på mobil.


## Version 2 ändringar

- Gästernas videokontroller är borttagna.
- Klick/touch på videon blockeras.
- Videoelementet kan inte pausas/spolas av gästen via vanliga kontroller.
- Startlogiken är något tajtare nära startögonblicket.


## Version 3 ändringar

- Adminsidan visar nu en QR-kod för gästlänken.
- Gäster kan skanna QR-koden direkt istället för att skriva in länken.
- Knappen för att kopiera länken finns kvar som backup.


## Version 4 ändringar

- När gästen trycker "Jag är redo" försöker appen låsa upp videouppspelning med ljud.
- Videon ska därefter starta med ljud när admin trycker START.
- Admin visar nu hur många enheter som faktiskt lyckades aktivera ljud.
- Om iPhone/Safari ändå blockerar autostart visas en stor fallback-knapp: "Tryck här för att starta filmen".
- Om admin redan har startat och gästen trycker redo sent startar nedräkningen direkt på den enheten.


## Version 5 ändringar

- Ljudupplåsning är separerad från huvudfilmen.
- "Jag är redo" förbereder huvudfilmen mutad och pausar den direkt.
- Gäster får ett explicit ljudtest med en kort ton.
- Gästen bekräftar själv om ljudet hördes.
- Admin visar nu:
  - anslutna
  - redo
  - video redo
  - ljud verifierat
- Detta är mer pålitligt än att försöka gissa via JavaScript om ljudet verkligen fungerar.
