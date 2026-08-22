# Stekkerbatterij kosten/baten-vergelijker

Een volledig statische, client-side webapp die berekent of en wanneer het
bijplaatsen van een stekkerbatterij financieel rendabel is, op basis van je
eigen Fluvius verbruiksdata en een lijst met batterijprijzen.

**Privacy:** je Fluvius-CSV('s) worden nooit verstuurd. Alle parsing en
berekeningen gebeuren client-side in JavaScript, in je eigen browser. Er is
geen server-kant meer — enkel statische bestanden (HTML/CSS/JS + één
JSON-bestand met batterijprijzen).

## Lokaal draaien

Geen build-step nodig. Serveer de map `public/` met eender welke statische
webserver, bijvoorbeeld:

```bash
python -m http.server 8420 --directory public
```

Open <http://localhost:8420>.

## Verbruiksdata downloaden

Via [Mijn Fluvius](https://mijn.fluvius.be/verbruik) → **Historiek downloaden**:

- **Kwartiertotalen** (verplicht).
- **Piekvermogen** (optioneel, sterk aangeraden) — Fluvius' eigen
  al-berekende maandpiek, het exacte cijfer waarop capaciteitstarief
  gefactureerd wordt.

Beide bestanden delen hetzelfde CSV-format (`;`-gescheiden, NL-komma als
decimaalteken). De berekening gebruikt automatisch enkel de 12 volledige
kalendermaanden voorafgaand aan de huidige maand uit deze bestanden (de
lopende/onvolledige maand telt nooit mee, voor zowel kwartiertotalen als
piekvermogen) — ook als de CSV een langere historiek bevat, zodat oud
verbruiksgedrag recente resultaten niet vertroebelt, en zodat dezelfde
trailing-12-maanden-referentie gebruikt wordt als Fluvius' eigen
capaciteitstarief-formule.

## Het rekenmodel

Eén gecombineerde simulatie per batterij, zoals een echte batterij het ook
zou doen — geen twee losse hypotheses:

- **Piekaftopping (capaciteitstarief)**: per maand wordt de laagst haalbare
  piekdrempel gezocht die de batterij met haar eigen laad-/ontlaadvermogen
  en capaciteit kan volhouden; de batterij ontlaadt zodra het verbruik boven
  die drempel piekt. Rekent met het echte (Tweakers-/fabrikant-geverifieerde)
  vermogen — geen kunstmatige begrenzing.
- **Zelfverbruik van zonne-overschot**: telkens er onder de piekdrempel
  ruimte is om te laden, gebeurt dat bij voorrang met beschikbaar
  zonne-overschot (injectie) in plaats van vanaf het net. Zo wordt geen
  batterijcapaciteit "verspild" aan gewoon dagverbruik als er nog een piek
  moet komen — de batterij houdt capaciteit achter de hand voor de piek,
  precies zoals een slim regelalgoritme dat ook zou doen. Vereist
  injectiedata in de CSV (zonnepanelen) om baten op te leveren; zonder
  zonnepanelen valt dit onderdeel gewoon op nul terug en blijft enkel de
  piekaftopping over.

Beide baten (capaciteitstarief-besparing + vermeden afname/injectie) tellen
op tot één jaarlijkse batensom, want het zijn twee aparte, optelbare
componenten van een echte elektriciteitsfactuur (vast vermogenstarief +
energiecomponent) — geen dubbeltelling.

Resultatentabel per batterij: initiële kost, jaarlijkse kosten, extra
zelfverbruik in kWh, impact op piektarief, jaarlijkse baten, netto baten,
en terugverdientijd.

## Aanmeldplicht bij Fluvius (België)

Een stekkerbatterij mag in België wettelijk tot 2500W leveren (Synergrid
C10/26) — dat is geen technisch maximum. Wel geldt: zodra het gecombineerde
plug-and-play-vermogen (batterij + eventuele stekkerzonnepanelen) op je
aansluiting 800W of meer bedraagt, moet je dit binnen 30 dagen aanmelden via
Mijn Fluvius (geen elektricien of AREI-keuring nodig, wel de aanmelding
zelf). De batterijdetails in de app tonen daarom een duidelijke melding
zodra een batterij op of boven die 800W-drempel zit, naast haar echte
capaciteit en laad-/ontlaadvermogen.

## Batterijprijzen (`public/data/batteries.json`)

Statisch JSON-bestand, geen database. Elke stekkerbatterij-**variant**
(capaciteit/module-combinatie) is een eigen entry met een eigen
`tweakers_url`, want Tweakers prijst elke variant apart.

**Enkel Synergrid-gehomologeerde toestellen worden opgenomen, en de
Synergrid-lijst is het vertrekpunt.** De opbouw van deze lijst gebeurt in
omgekeerde richting t.o.v. een klassieke prijsvergelijker: het onderzoek
vertrekt bij de officiële
[Synergrid C10/26-lijst](https://www.synergrid.be/images/downloads/c10_26_list_of_pgu_compliant_with_c10_11_ed2_1_12_2019.xlsx)
zelf (kolom "Energy storage" = X/x/×, gefilterd op een gehomologeerd
vermogen ≤3000W om professioneel geïnstalleerde hybride-omvormersystemen
eruit te houden — zie Stap 1 hieronder voor het volledige filterrecept).
Voor elke batterij-kandidaat die zo gevonden wordt: eerst nagaan of het
product nog verkocht wordt, dan de overige specs opzoeken. Die lijst bevat
geen batterijcapaciteit (enkel het vermogen van de omvormer/PCS — Synergrid
regelt de netaansluiting, niet de accu erachter) en ook geen prijs, chemie,
cyclusgetal of garantie, dus die velden komen **bij voorkeur van de
fabrikant zelf**; enkel wanneer de fabrikant iets niet publiceert, wordt
teruggevallen op onafhankelijke sites zoals Tweakers of
[thuisbatterijengids.net](https://thuisbatterijgids.net/). `max_charge_kw`/
`max_discharge_kw` komen altijd uit de Synergrid-lijst zelf, nooit van de
fabrikant, want die lijst is het wettelijk bindende cijfer. Losse omvormers
zonder eigen batterij (bv. microomvormers die met een apart verkochte accu
werken) worden niet opgenomen — enkel toestellen die zelf energie opslaan.
Producten/varianten die niet met voldoende zekerheid nog verkocht/
teruggevonden konden worden, zijn bewust weggelaten in plaats van gegokt.

Elke entry heeft ook `chemistry` (celtype, bv. `"LiFePO4"`), `expected_cycles`
(fabrikantsopgave, afgerond) en `expected_lifespan_note` (vrije tekst:
capaciteitsbehoud na X cycli/jaar zoals de fabrikant dat zelf formuleert —
niet elke fabrikant publiceert een expliciet retentiepercentage, dus dat
verschilt qua precisie per entry). Verder ook `p1_port_support` (kan het
toestel op de P1-poort van de slimme meter sturen, voor laden op
zonne-overschot? `true`/`false`/`null` als onbevestigd) met `p1_port_note`,
en `direct_pv_input` (heeft het toestel een eigen MPPT/PV-ingang om
zonnepanelen rechtstreeks aan te sluiten, of enkel AC-gekoppeld gebruikbaar
naast een bestaande zonne-omvormer?) met `direct_pv_input_note` — beide
primair afgeleid uit de Synergrid-kolom "Power control system type" (voor
P1) en fabrikantendocumentatie (voor PV-input); `null`/onbevestigd wordt
nooit gegokt naar `true` of `false`. Deze worden in de detailweergave
getoond in een tabelletje boven `notes`, samen met `warranty_years`.

Elke entry heeft daarnaast, waar bevestigd, `price_url` — een rechtstreekse
link naar een concrete pagina waar `current_price_eur` effectief geverifieerd
is, bij voorkeur een winkel die (aantoonbaar) levert in België, anders
`tweakers_url`/de fabrikant zelf als terugval — samen met `price_source_label`
(`"shop"` | `"manufacturer_list"` — er is geen apart `"tweakers"`-label in de
praktijk, dat viel steeds samen met `"shop"` of werd niet als bron gebruikt),
`shop_name` (leesbare naam voor de link) en `delivers_to_belgium`
(`true`/`false`/`"unknown"`). **Dit veld wordt bewust leeg gelaten (geen
koopllink getoond in de detailweergave) wanneer geen enkele bron met
voldoende zekerheid een actuele prijs + geldige link kon leveren** — nooit
een onzekere/verlopen link tonen als was het een bevestigde koopoptie. Zulke
gevallen (en prijsdiscrepanties t.o.v. een eerder geregistreerde prijs)
worden wel toegelicht in `notes`.

### Prijzen verversen

Er is **geen geautomatiseerde dagelijkse scraper**.  
Om dat op te vangen: vraag me (in een Claude Code-sessie) af en toe om de
prijzen te verversen. Ik vertrek dan bij de Synergrid C10/26-lijst (zie
hierboven) om te bepalen welke batterijen er bestaan, en zoek per product
de prijs/specs op — bij voorkeur rechtstreeks bij de fabrikant of elders online (vb thuisbatterijengids.net) als
terugvalpositie wanneer de fabrikant iets niet publiceert. Ik werk daarmee
`public/data/batteries.json` bij.

Dit ververst niet enkel de prijs, maar ook `manufacturer_url` en `notes`
(specs-caveats, terugkerende/verborgen kosten, reviews, garantie- en
veiligheidsissues) — zie de bestaande entries voor het detailniveau dat
verwacht wordt (bv. `aeg-solarcube-4-8kwh` heeft een expliciete
veiligheidsvermelding uit een review).

Herbruikbare prompt daarvoor (plak in een nieuwe Claude Code-sessie in deze
projectmap):

> Ververs `public/data/batteries.json` volledig: prijzen, nieuwe/verdwenen
> varianten, en per batterij ook `manufacturer_url`, `chemistry`,
> `expected_cycles`, `expected_lifespan_note`, `p1_port_support` (+
> `p1_port_note`), `direct_pv_input` (+ `direct_pv_input_note`), `price_url`
> (+ `price_source_label`, `shop_name`, `delivers_to_belgium` — zie het
> schema hierboven; enkel invullen bij een écht geverifieerde, actuele
> prijs+link, anders leeg laten en toelichten in `notes`) en de inhoud
> van `notes` (kosten en reviews). Lees dat bestand eerst om te zien wat er
> nu in staat.
>
> **Stap 1 — vertrek van de Synergrid-lijst.** Download
> de officiële Synergrid C10/26-lijst
> (`https://www.synergrid.be/images/downloads/c10_26_list_of_pgu_compliant_with_c10_11_ed2_1_12_2019.xlsx`
> — een `.xlsx`; installeer `openpyxl` met `pip install openpyxl` als het
> nog niet beschikbaar is, dat werkt betrouwbaarder dan zelf XML parsen).
> Filter het werkblad "C10-26 power-generating units" (header op rij 10) op:
> - Kolom "Energy storage" (25e kolom, index 24 in een 0-based rij-tuple)
>   is gemarkeerd (waarde 'X', 'x' of '×' — de spreadsheet gebruikt
>   inconsistente tekens, dus vergelijk case-insensitive/niet enkel op 'X').
> - Groepeer op (merk, productserie) en hou enkel groepen over waarvan het
>   maximale gehomologeerde vermogen (`Pac,r`, kolom I) ≤3000W is — dat
>   sluit professioneel geïnstalleerde hybride-omvormersystemen (Growatt
>   SPH, GoodWe ET, FoxESS H1, enz.) grotendeels uit, al is dit een
>   heuristiek: sommige matches op stroom (bv. VARTA pulse neo, Sessy) zijn
>   toch professioneel te installeren toestellen die apart uitgesloten
>   moeten worden — controleer dit per kandidaat (zie hieronder).
> - Voor elke overgebleven (merk, serie): zoek op of het product nog actief
>   verkocht wordt (fabrikantensite, of bij twijfel Tweakers/
>   thuisbatterijengids.net). Niet meer gevonden → niet toevoegen (of
>   `active: false` zetten als het al in de lijst stond).
> - **Enkel toestellen die zelf een batterij bevatten** — sluit losse
>   omvormers/microomvormers zonder eigen opslag uit (bv. een
>   "Microinverter" of "Hybrid Inverter" die met een apart verkochte accu
>   werkt heeft weinig meerwaarde in deze vergelijker).
> - **Moet letterlijk in een stopcontact te pluggen zijn** — geen
>   professionele installatie door een elektricien. Twijfel je (bv. een
>   zwaar toestel >30kg, taal als "installation by certified installer",
>   een prijs die duidelijk een installatiekost impliceert)? Zoek dat
>   specifiek op i.p.v. aan te nemen dat lage Synergrid-homologatie
>   automatisch "plug-and-play" betekent.
>
> Voor elke bevestigde, nog verkochte batterij:
> - Staat de variant al in `batteries.json` (matchen op `id` of merk+model)?
>   Werk dan `current_price_eur`, `capacity_kwh` (indien gewijzigd) en
>   `updated_at` bij. Zoek er meteen een rechtstreekse link bij waar die
>   exacte prijs voor dat exacte model geverifieerd is — bij voorkeur een
>   winkel die aantoonbaar levert in België, anders `tweakers_url` of de
>   fabrikant zelf als terugval — en zet die in `price_url` (+
>   `price_source_label`, `shop_name`, `delivers_to_belgium`). Geen enkele
>   bron kon met voldoende zekerheid een actuele prijs+link leveren? Laat
>   `price_url` dan gewoon weg (geen koopllink tonen die niet klopt) en
>   leg uit waarom in `notes`.
> - Nieuwe variant? Gebruik voor `max_charge_kw`/`max_discharge_kw` altijd
>   het op de Synergrid-lijst gehomologeerde vermogen (nooit de
>   fabrikantwaarde als die afwijkt — let op producten die apart
>   on-grid- vs. off-grid-vermogen vermelden, enkel het on-grid-cijfer
>   telt hier). Zoek `capacity_kwh`, prijs en overige specs **bij voorkeur
>   op de site van de fabrikant zelf**; val enkel terug op Tweakers of
>   thuisbatterijengids.net als de fabrikant iets niet publiceert. Nooit
>   gokken — laat `null` met uitleg in `notes` als je iets niet kan
>   bevestigen.
> - Een variant die vroeger in de lijst stond maar niet meer verkocht
>   wordt: zet `active: false` i.p.v. verwijderen, met een notitie waarom.
> - Nog niet leverbaar/geen prijs: `active: false` en
>   `current_price_eur: null`, zoals de bestaande Growatt NOAH 2000-entry.
>
> **Stap 2 — terugkerende/verborgen kosten.** Zoek voor elke batterij (ook
> de al langer bestaande entries, niet enkel nieuwe) de officiële
> fabrikantensite op en vul/controleer `manufacturer_url`. Kijk daar
> specifiek naar: verplichte app-/cloudabonnementen, verplichte
> bijkomende hardware (smart meter, CT-klem, hub) die niet in de
> geadverteerde prijs zit, en andere terugkerende kosten. Verplicht en
> bevestigd → pas `recurring_costs_eur_per_year`/`one_time_costs_eur` aan.
> Optioneel of onbevestigd → laat de kostenvelden met rust, maar beschrijf
> het wel in `notes` (zoals nu al bij HomeWizard's optionele €11,95/jaar en
> Anker's optionele smart meter). Controleer bij diezelfde fabrikantensite
> ook `chemistry`, `expected_cycles`, `warranty_years` en
> `expected_lifespan_note` (capaciteitsbehoud na X cycli/jaar) — nooit een
> percentage of cyclusaantal verzinnen als de fabrikant het niet expliciet
> publiceert, dan liever kort noteren dat het niet gepubliceerd is.
> Controleer ook `p1_port_support` (kan het toestel via de P1-poort van de
> slimme meter sturen, voor laden op zonne-overschot? — check eerst de
> Synergrid-kolom "Power control system type", die vermeldt dit vaak
> expliciet) en `direct_pv_input` (heeft het toestel een eigen MPPT/PV-
> ingang, of is het enkel AC-gekoppeld naast een bestaande zonne-omvormer?
> let op: "AC" in de productnaam betekent niet bij elk merk hetzelfde —
> sommige "AC"-varianten hebben wél een eigen MPPT ernaast, dus per product
> verifiëren i.p.v. op de naam afgaan). Onbevestigd → `null`, nooit gokken.
>
> **Stap 3 — reviews en bekende problemen.** Zoek per batterij echte
> gebruikersreviews (Tweakers, Trustpilot, fora) op garantieklachten,
> betrouwbaarheidsproblemen, terugroepacties of veiligheidsissues. Lees
> effectief reviews, geen oppervlakkige samenvatting van een spec-sheet.
> Vind je niets noemenswaardigs na een echte zoekpoging, zeg dat expliciet
> ("geen noemenswaardige klachten gevonden") i.p.v. iets te verzinnen.
>
> **Alles in `notes` schrijf je in het Nederlands** (Vlaams register,
> zoals de rest van deze app) — geen Engelstalige toevoegingen meer. Voeg
> nieuwe bevindingen toe aan de bestaande tekst i.p.v. die te overschrijven,
> tenzij je een concrete fout corrigeert. Verzin nooit een URL, prijs,
> reviewcitaat of spec — als je iets niet kan bevestigen, zeg dat met zoveel
> woorden.
>
> Zet de top-level `updated_at` op nu. Schrijf identiek naar zowel
> `data/seed-batteries.json` als `public/data/batteries.json` (verifieer
> met `diff` dat ze byte-identiek zijn) en valideer dat de JSON geldig
> blijft. Rapporteer aan het einde: hoeveel entries toegevoegd/bijgewerkt/
> gedeactiveerd, welke velden je niet kon bevestigen (inclusief `chemistry`/
> `expected_cycles`/`expected_lifespan_note` waar de fabrikant niets
> publiceert), en een kort lijstje van noemenswaardige bevindingen
> (veiligheid, garantie, terugroepacties).

## Bekende beperkingen / mogelijke volgende stappen

- **Geen dynamisch-tarief-modus (arbitrage).** Er was een vereenvoudigd
  2-bands-model (goedkoop/duur venster met zelf ingevoerde prijzen), maar
  dat is bewust verwijderd — piekaftopping en zelfverbruik zijn nu
  samengevoegd tot één gecombineerde, realistischere simulatie. Een
  arbitrage-modus zou een geheel eigen rekenlogica en aparte marktdata
  (Belpex/Elexys) vergen; kan later terugkomen als apart onderdeel als
  daar vraag naar is.
- **VREG-tarieven automatisch invullen**
  laat de gebruiker een energieleverancier + formule kiezen uit een
  lijstje, en vul daarmee automatisch zowel het afnametarief als het
  injectietarief in (nog steeds overschrijfbaar). VREG publiceert
  maandelijks een `.xlsx`-bestand met alle V-test-producten
  (<https://www.vlaamsenutsregulator.be/cijfers/v-test-data-en-energieprijscurves>),
  geen API, handmatige download. Gezien de ervaring met Tweakers: eerst
  navragen of dat bestand wél zonder consentmuur/inlog downloadbaar is
  voor er een automatisch ververs-mechanisme voor gebouwd wordt — anders
  past hetzelfde "vraag Claude om het af en toe te verversen"-patroon als
  bij de batterijprijzen hierboven, gewoon met een nieuw statisch
  `vreg-tarieven.json`-bestand i.p.v. een PHP-endpoint.
- Geen historiek/opslag van eerdere berekeningen, geen gebruikersaccounts.
- Geen vierde connector-achtig concept nodig hier (dit is geen `single-pane`
  dashboard) — puur een eenmalige rekentool.

## Projectstructuur

```
public/                  # volledig statische document root
  index.html
  assets/
    csvParser.js           # Fluvius CSV-parsing (kwartiertotalen + piekvermogen)
    calculators.js          # de 3 rekenmodi + 365-dagen-windowing
    app.js                   # UI-orchestratie
    style.css
  data/batteries.json      # batterijprijzen/specs, af en toe handmatig ververst
data/
  seed-batteries.json       # de oorspronkelijk onderzochte startlijst (referentie)
```
