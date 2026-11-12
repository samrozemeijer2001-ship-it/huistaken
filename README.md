# Huistaken — versie 2 (voor elk huis)

Werktitel "Huistaken". De echte naam volgt nog.

## Wat is er nieuw ten opzichte van de BR-versie
- **Geen vaste namen of taken meer in de code.** Elk huis heeft zijn eigen bewoners, klussen, huisregels en straf. Die staan in de database en zijn in de app aan te passen (tandwiel-icoon).
- **Huis maken of joinen.** Eén persoon maakt het huis aan en kiest een startpakket (Studentenhuis / Klein huis / Zelf samenstellen). De rest joint met een **code van 6 tekens** of een **uitnodigingslink** (`?code=ABC123`).
- **"Wie ben jij?"** Ben je je telefoon kwijt of gebruik je een tweede apparaat? Join opnieuw en kies jezelf.
- **Automatisch rouleren, voor altijd.** Elke maandag schuift iedereen één klus op. Meer bewoners dan klussen: iemand heeft vrij (slaperig gezichtje). Meer klussen dan bewoners: iemand krijgt er twee.
- **Afgelopen weken worden vastgelegd**, zodat de kruisjes niet veranderen als er iemand bijkomt of weggaat.
- **Kruisjes zijn optioneel**, per huis aan/uit te zetten, met een zelfgeschreven straf.
- **Eigen foto óf een grote letter** als avatar, en 8 kleuren.
- Je kunt alleen je **eigen** klus afvinken. Op iemand anders z'n scherm staat: "Ga maar even porren."
- Lettertypes en Firebase zitten **in de app zelf** (geen Google Fonts of CDN meer). Dat is nodig voor de app-store-versie en beter voor privacy.

## Meteen uitproberen (demo-modus)
Zolang `firebase-config.js` leeg is, draait de app in **demo-modus**: alles blijft in je browser.
1. Open de map in VS Code en start een lokale server, bv. de extensie *Live Server*, of `npx serve .`
2. Open de app en maak een huis.
3. Open een **tweede tabblad** met dezelfde link plus `?code=JOUWCODE` en speel een huisgenoot na.

(Dubbelklikken op `index.html` werkt níet, er is een server nodig.)

## Echt gebruiken: nieuw Firebase-project (±10 min)
Gebruik een **nieuw** project, zodat jullie huidige BR-app gewoon blijft werken.

1. https://console.firebase.google.com → **Project toevoegen** (bv. `huistaken-app`)
2. **Build → Authentication → Aan de slag → Sign-in method → Anoniem → Inschakelen**
3. **Build → Firestore Database → Database maken** → locatie `eur3 (Europe)` → *productiemodus*
4. Tabblad **Rules**: plak de inhoud van `firestore.rules` → **Publiceren**
5. **Projectinstellingen → Jouw apps → `</>`** → app registreren → plak de config in `firebase-config.js`
6. Online zetten via Firebase Hosting of GitHub Pages (zoals bij versie 1)

## Bestanden
| Bestand | Wat |
|---|---|
| `app.js` | Alle schermen en logica (rooster, kruisjes, onboarding, instellingen) |
| `backend-firebase.js` | Opslag in Firestore |
| `backend-local.js` | Demo-opslag in de browser (zelfde functies) |
| `templates.js` | Startpakketten, iconen en kleuren |
| `firestore.rules` | Beveiliging: alleen leden zien hun huis |
| `icons.js` | Illustraties: 5 nieuwe (pan, plant, shirt, cart, broom) + UI-iconen |

## Bekende beperkingen van deze versie
- **Anoniem inloggen**: app verwijderen = identiteit kwijt. Via "Wie ben jij?" kom je weer terug. Inloggen met Apple/Google komt later.
- Komt er midden in de week iemand bij, dan wordt het rooster van die week opnieuw verdeeld. Al afgevinkte klussen blijven staan.
- Iedereen in een huis heeft dezelfde rechten (ook bewoners verwijderen).

## Roadmap
**Fase 2: rest van je MVP-wensen**
- Ruilen: "Wil jij deze week mijn badkamer?" → de ander accepteert
- Afwezig/vakantie: klussen gaan die week(en) naar de anderen
- Fotobewijs bij afvinken (Firebase Storage)
- Pushmeldingen: herinnering op zaterdag + "Rick is gestrikt" (vereist de native app, zie fase 3)

**Fase 3: naar de app stores**
- Inpakken met **Capacitor** (de code blijft HTML/JS) → iOS + Android
- Inloggen met Apple/Google (Apple verplicht "Sign in with Apple" als je Google aanbiedt)
- Privacyverklaring + "account verwijderen" in de app (eis van Apple en Google)
- Apple Developer €99/jaar, Google Play eenmalig $25

**Fase 4: testen met 5–10 huizen**, daarna lancering en een keuze voor het verdienmodel.
