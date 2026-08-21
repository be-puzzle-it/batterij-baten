// Rekenmodel: één gecombineerde simulatie per batterij die piekaftopping
// (capaciteitstarief) én zelfverbruik van zonne-overschot samen behandelt,
// zoals een echte batterij dat ook doet — niet twee losse hypothesen.
// Werkt uitsluitend op de arrays die csvParser.js oplevert — alles blijft
// in het geheugen van de browser.
const BatteryCalculators = (() => {
  const QUARTER_HOURS = 0.25;

  function monthKeyOf(timestamp) {
    return timestamp.slice(0, 7);
  }

  function groupByMonth(intervals) {
    const map = new Map();
    for (const iv of intervals) {
      const key = monthKeyOf(iv.timestamp);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(iv);
    }
    return map;
  }

  // Aantal dagen dat de dataset dekt, gebaseerd op het aantal kwartieren zelf
  // (niet op kalenderspanne) zodat ontbrekende dagen de extrapolatie niet
  // kunstmatig optimistisch maken.
  function daysCovered(intervals) {
    return (intervals.length * QUARTER_HOURS) / 24;
  }

  function roundUpPeakKw(kw) {
    return Math.max(Math.ceil(kw - 1e-9), 2.5);
  }

  // Beperkt kwartierdata tot de 12 volledige kalendermaanden voorafgaand aan
  // de huidige maand (de lopende/onvolledige maand telt niet mee). Zo weegt
  // recent verbruiksgedrag mee i.p.v. een resultaat te vermengen met data van
  // jaren geleden wanneer de CSV een langere historiek bevat, en sluit dit
  // exact aan bij filterToLastYearMonths hieronder (zelfde maandgrenzen).
  function filterToLastYear(intervals, now = new Date()) {
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const windowStart = new Date(currentMonthStart);
    windowStart.setMonth(windowStart.getMonth() - 12);
    const filtered = intervals.filter((iv) => {
      const t = new Date(iv.timestamp);
      return t >= windowStart && t < currentMonthStart;
    });
    filtered.skippedRows = intervals.skippedRows ?? 0;
    filtered.windowStart = windowStart;
    filtered.windowEnd = currentMonthStart;
    return filtered;
  }

  // Zelfde idee voor de maandelijkse piekvermogen-data: laat de lopende
  // (onvolledige) maand vallen en hou hoogstens de laatste 12 afgesloten
  // maanden over.
  function filterToLastYearMonths(months, now = new Date()) {
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const completed = months.filter((m) => m.month < currentMonthKey);
    const filtered = completed.slice(-12);
    filtered.skippedRows = months.skippedRows ?? 0;
    return filtered;
  }

  function evaluateBattery(battery, annualBenefitEur) {
    const upfrontCost = (battery.current_price_eur ?? 0) + (battery.one_time_costs_eur ?? 0);
    const netAnnualBenefit = annualBenefitEur - (battery.recurring_costs_eur_per_year ?? 0);
    if (battery.current_price_eur == null) {
      return { paybackYears: null, profitable: null, netAnnualBenefit, reason: 'geen prijs bekend' };
    }
    if (netAnnualBenefit <= 0) {
      return { paybackYears: null, profitable: false, netAnnualBenefit };
    }
    return { paybackYears: upfrontCost / netAnnualBenefit, profitable: true, netAnnualBenefit };
  }

  // Een stekkerbatterij mag in België wettelijk (Synergrid C10/26) tot 2500W
  // leveren; 800W is enkel de grens waarboven aanmelding bij Fluvius verplicht
  // wordt (mijn.fluvius.be, binnen 30 dagen), geen technisch maximum. Het echte
  // laad-/ontlaadvermogen uit de (Tweakers/fabrikant-geverifieerde) batterijdata
  // wordt daarom rechtstreeks gebruikt in de berekening; de UI toont apart een
  // aanmeldingsnotitie zodra dat vermogen deze drempel overschrijdt.
  const BE_REGISTRATION_THRESHOLD_KW = 0.8;

  // --- Gecombineerde piek-/zelfverbruiksimulatie ------------------------------
  //
  // Eén batterij, één gedrag: ontladen zodra het verbruik boven een
  // maandelijkse drempel piekt (voor capaciteitstarief), en laden zodra er
  // ruimte onder die drempel is — bij voorkeur met zonne-overschot, anders
  // vanaf het net (om klaar te staan voor de volgende piek). Zo wordt geen
  // capaciteit "verspild" aan gewoon dagverbruik als er nog een piek moet
  // komen — precies wat een slim batterijsysteem ook zou doen.

  function simulateMonthFeasible(monthIntervals, thresholdKw, battery, allowGridCharging) {
    let soc = battery.usable_capacity_kwh;
    const efficiency = battery.roundtrip_efficiency_pct / 100;
    for (const iv of monthIntervals) {
      const loadKw = iv.afname_kwh / QUARTER_HOURS;
      if (loadKw > thresholdKw) {
        const overshootKw = loadKw - thresholdKw;
        const dischargeKw = Math.min(overshootKw, battery.max_discharge_kw);
        if (dischargeKw < overshootKw - 1e-9) return false; // ontlaadvermogen ontoereikend
        const neededEnergy = dischargeKw * QUARTER_HOURS;
        if (soc < neededEnergy - 1e-9) return false; // te weinig opgeslagen energie
        soc -= neededEnergy;
      } else {
        // Zonne-overschot eerst: die stroom gaat rechtstreeks van de panelen
        // naar de batterij en komt dus NIET van het net — de piekdrempel
        // (die enkel netafname begrenst) is hier niet van toepassing. Enkel
        // het laadvermogen en de resterende accuruimte begrenzen dit.
        const maxChargeKwh = battery.max_charge_kw * QUARTER_HOURS;
        const fromInjectie = Math.min(maxChargeKwh, iv.injectie_kwh, (battery.usable_capacity_kwh - soc) / efficiency);
        soc += fromInjectie * efficiency;
        // Pas daarna eventueel bijladen vanaf het net — dát is wél netafname
        // en moet dus onder de piekdrempel blijven. Enkel als de gebruiker dit
        // toestaat (zie de "laden vanaf het net"-optie); staat die uit, dan
        // kan de batterij enkel op zonne-overschot rekenen om pieken op te
        // vangen, wat de haalbare piekdrempel in zonarme maanden kan verhogen.
        if (allowGridCharging) {
          const gridHeadroomKwh = (thresholdKw - loadKw) * QUARTER_HOURS;
          const fromGrid = Math.min(maxChargeKwh - fromInjectie, gridHeadroomKwh, (battery.usable_capacity_kwh - soc) / efficiency);
          soc += fromGrid * efficiency;
        }
      }
    }
    return true;
  }

  function findLowestFeasiblePeakKw(monthIntervals, battery, allowGridCharging) {
    const currentPeakKw = Math.max(...monthIntervals.map((iv) => iv.afname_kwh / QUARTER_HOURS));
    let lo = 0;
    let hi = currentPeakKw;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (simulateMonthFeasible(monthIntervals, mid, battery, allowGridCharging)) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    return { currentPeakKw, simulatedNewPeakKw: hi };
  }

  // Tweede pas over dezelfde maand bij de al-gevonden haalbare drempel, nu
  // met bronregistratie: welk deel van het laden kwam gratis uit
  // zonne-overschot, en welk deel was nodig vanaf het net? Eager laden
  // (zoals simulateMonthFeasible doet — grijp elke gelegenheid onder de
  // drempel aan) zou de batterij 's nachts al volladen vóór het middagoverschot
  // van de volgende dag ooit een kans krijgt, en dus zelfverbruik verdringen
  // zonder dat dat nodig was. Deze pas laadt daarom "net op tijd": eerst een
  // achterwaartse doorgang die per kwartier berekent hoeveel lading er
  // minstens nodig is om alle latere pieken in de maand nog te kunnen
  // afvlakken (met maximaal laadvermogen vanaf dat punt), gevolgd door een
  // voorwaartse doorgang die telkens eerst gratis zonne-overschot gebruikt en
  // pas daarna, enkel indien nodig om die reserve te halen, van het net
  // bijlaadt. Dat verandert niets aan de haalbaarheid van de drempel (dezelfde
  // maximale laadcapaciteit blijft beschikbaar, enkel later ingezet) — wel aan
  // wélke bron elke geladen kWh toegeschreven krijgt.
  function simulateMonthDetailed(monthIntervals, thresholdKw, battery, allowGridCharging) {
    const efficiency = battery.roundtrip_efficiency_pct / 100;
    const n = monthIntervals.length;

    const minRequiredAtStart = new Array(n + 1);
    minRequiredAtStart[n] = 0;
    for (let i = n - 1; i >= 0; i--) {
      const iv = monthIntervals[i];
      const loadKw = iv.afname_kwh / QUARTER_HOURS;
      if (loadKw > thresholdKw) {
        const overshootKw = loadKw - thresholdKw;
        const dischargeKw = Math.min(overshootKw, battery.max_discharge_kw);
        const dischargeEnergy = dischargeKw * QUARTER_HOURS;
        minRequiredAtStart[i] = Math.min(minRequiredAtStart[i + 1] + dischargeEnergy, battery.usable_capacity_kwh);
      } else {
        // Zelfde laadcapaciteit als in de voorwaartse doorgang: zon eerst
        // (niet begrensd door de drempel), daarna net binnen de drempel.
        // Deze reserve stuurt enkel hoeveel er nog vrij is voor zelfverbruik
        // (stap 2 hieronder) — dat mag niet veranderen naargelang "laden
        // vanaf het net" aan- of uitstaat (dat raakt enkel de piekaftopping,
        // niet het zelfverbruik), dus hier wordt altijd verondersteld dat
        // bijladen vanaf het net mogelijk is. Stap 3 hieronder is waar
        // `allowGridCharging` de effectieve netlading al dan niet toelaat.
        const maxChargeKwh = battery.max_charge_kw * QUARTER_HOURS;
        const injectiePotential = Math.min(maxChargeKwh, iv.injectie_kwh);
        const gridHeadroomKwh = Math.max(thresholdKw - loadKw, 0) * QUARTER_HOURS;
        const gridPotential = Math.min(maxChargeKwh - injectiePotential, gridHeadroomKwh);
        const maxChargeEnergyStored = (injectiePotential + gridPotential) * efficiency;
        minRequiredAtStart[i] = Math.max(minRequiredAtStart[i + 1] - maxChargeEnergyStored, 0);
      }
    }

    const startSoc = battery.usable_capacity_kwh;
    let soc = startSoc;
    let totalAfnameKwh = 0;
    let dischargedKwh = 0;
    let avoidedInjectieKwh = 0;
    let gridChargeKwh = 0;

    for (let i = 0; i < n; i++) {
      const iv = monthIntervals[i];
      totalAfnameKwh += iv.afname_kwh;
      const loadKw = iv.afname_kwh / QUARTER_HOURS;
      const reserveKwh = minRequiredAtStart[i + 1]; // nodig voor latere pieken
      const maxChargeKwh = battery.max_charge_kw * QUARTER_HOURS;

      // 1. Zonne-overschot altijd maximaal opvangen: gratis energie die anders
      //    geïnjecteerd zou worden. Gaat niet via het net, dus enkel begrensd
      //    door laadvermogen en resterende accuruimte — NIET door de piekdrempel.
      const fromInjectie = Math.min(maxChargeKwh, iv.injectie_kwh, (battery.usable_capacity_kwh - soc) / efficiency);
      soc += fromInjectie * efficiency;
      avoidedInjectieKwh += fromInjectie;

      // 2. Ontladen om netafname te dekken. Een echte batterij wacht niet tot
      //    het verbruik boven de piekdrempel uitkomt: elke kWh die ze levert
      //    is een kWh die je niet van het net koopt, aan hetzelfde tarief.
      //    Ze ontlaadt dus zo veel mogelijk van de actuele afname, maar houdt
      //    wel minstens `reserveKwh` over om de resterende pieken van de maand
      //    nog te kunnen afvlakken (anders zou zelfverbruik de piekaftopping
      //    kapotmaken). Het verplichte deel (boven de drempel) gaat altijd door.
      if (loadKw > 0 && soc > 0) {
        const mandatoryKwh = Math.min(Math.max(loadKw - thresholdKw, 0), battery.max_discharge_kw) * QUARTER_HOURS;
        const wantedKwh = Math.min(loadKw, battery.max_discharge_kw) * QUARTER_HOURS;
        const spareKwh = Math.max(soc - reserveKwh, 0);
        const dischargeKwh = Math.min(soc, Math.max(mandatoryKwh, Math.min(wantedKwh, spareKwh)));
        soc -= dischargeKwh;
        dischargedKwh += dischargeKwh;
      }

      // 3. Enkel indien nodig bijladen vanaf het net om de volgende piek nog te
      //    kunnen afvlakken ("just in time"). Dit is wél netafname en moet dus
      //    binnen de piekdrempel blijven. Voor gewoon zelfverbruik wordt nooit
      //    van het net geladen: bij een vlak tarief is dat per definitie
      //    verlieslatend (round-trip-verlies). Dit is de enige stap die
      //    `allowGridCharging` respecteert — staat die uit, dan wordt de
      //    piekdrempel zelf al hoger gevonden (zie findLowestFeasiblePeakKw)
      //    en gebeurt hier gewoon geen netlading, zonder stap 1/2 te raken.
      const stillNeededStored = allowGridCharging ? Math.max(reserveKwh - soc, 0) : 0;
      if (stillNeededStored > 0) {
        const gridHeadroomKwh = Math.max(thresholdKw - loadKw, 0) * QUARTER_HOURS;
        const remainingPower = Math.max(maxChargeKwh - fromInjectie, 0);
        const remainingRoom = (battery.usable_capacity_kwh - soc) / efficiency;
        const fromGrid = Math.min(stillNeededStored / efficiency, remainingPower, gridHeadroomKwh, remainingRoom);
        soc += fromGrid * efficiency;
        gridChargeKwh += fromGrid;
      }
    }

    // Energiebalans. Twee correcties op de bruto ontlading:
    //  (a) Grid-laden is gewone afname die je betaalt (zelfde tarief), dus die
    //      moet eraf — anders zou de simulatie energie uit het niets creëren.
    //      Bij een vlak tarief is laden-vanaf-net per definitie licht
    //      verlieslatend (round-trip-verlies); het blijft wel zinvol omdat het
    //      de máándpiek verlaagt, en dát voordeel telt apart mee.
    //  (b) Elke maand start hier met een volle batterij (nodig om de piek van
    //      de eerste dagen realistisch te kunnen afvlakken), maar die
    //      beginlading is nooit betaald. Zakt de batterij over de maand netto
    //      leeg, dan is dat verschil dus gratis energie die niet als besparing
    //      mag tellen — anders krijg je 12x per jaar een gratis volle accu.
    const freeInitialChargeKwh = Math.max(startSoc - soc, 0);
    const avoidedAfnameKwh = dischargedKwh - gridChargeKwh - freeInitialChargeKwh;
    return { totalAfnameKwh, avoidedAfnameKwh, dischargedKwh, gridChargeKwh, freeInitialChargeKwh, avoidedInjectieKwh };
  }

  // Per-maand combinatie van piekvergelijking én zelfverbruik — herbruikt
  // door combinedCalculate en door de twee grafieken in de
  // batterij-detailweergave, zodat beide exact dezelfde simulatie tonen.
  function computeMonthlyCombined(kwartierIntervals, piekvermogenMonths, battery, allowGridCharging = true) {
    const byMonth = groupByMonth(kwartierIntervals);
    let months = Array.from(byMonth.keys()).sort();
    if (months.length === 0) {
      throw new Error('Geen bruikbare kwartierdata gevonden.');
    }

    const officialByMonth = new Map((piekvermogenMonths ?? []).map((m) => [m.month, m]));
    const warnings = [];

    // Huidige en nieuwe piek moeten over exact dezelfde maanden gemiddeld
    // worden, anders vergelijk je appels met peren. Bij een officiële
    // baseline beperken we ons daarom tot de maanden die in ZOWEL de
    // kwartiertotalen als de piekvermogen-CSV voorkomen.
    let usingOfficialBaseline = piekvermogenMonths != null && piekvermogenMonths.length > 0;
    if (usingOfficialBaseline) {
      const overlapping = months.filter((m) => officialByMonth.has(m));
      if (overlapping.length === 0) {
        warnings.push(
          'De piekvermogen-CSV overlapt met geen enkele maand uit de kwartiertotalen-CSV — geschatte piek gebruikt in plaats van de officiële Fluvius-data.'
        );
        usingOfficialBaseline = false;
      } else {
        months = overlapping;
      }
    }

    const monthResults = months.map((month) => {
      const monthIntervals = byMonth.get(month);
      const { currentPeakKw: derivedPeakKw, simulatedNewPeakKw } = findLowestFeasiblePeakKw(monthIntervals, battery, allowGridCharging);
      const { totalAfnameKwh, avoidedAfnameKwh, dischargedKwh, gridChargeKwh, freeInitialChargeKwh, avoidedInjectieKwh } = simulateMonthDetailed(
        monthIntervals,
        simulatedNewPeakKw,
        battery,
        allowGridCharging
      );
      const official = officialByMonth.get(month);
      if (official && derivedPeakKw > 0) {
        const diffPct = Math.abs(official.peak_kw - derivedPeakKw) / official.peak_kw;
        if (diffPct > 0.10) {
          warnings.push(
            `${month}: uit de kwartiertotalen afgeleide piek (${derivedPeakKw.toFixed(2)} kW) wijkt >10% af ` +
            `van de officiële Fluvius-piek (${official.peak_kw.toFixed(2)} kW) — mogelijk ontbreekt een register in de CSV.`
          );
        }
      }
      return {
        month,
        derivedCurrentPeakKw: derivedPeakKw,
        officialCurrentPeakKw: official ? official.peak_kw : null,
        officialProvisional: official ? official.provisional : false,
        simulatedNewPeakKw,
        totalAfnameKwh,
        avoidedAfnameKwh,
        dischargedKwh,
        gridChargeKwh,
        freeInitialChargeKwh,
        avoidedInjectieKwh,
      };
    });

    return { monthResults, monthsUsed: months.length, usingOfficialBaseline, warnings };
  }

  /**
   * @param {Array} kwartierIntervals uit FluviusCsv.parseKwartiertotalen()
   * @param {Array|null} piekvermogenMonths uit FluviusCsv.parsePiekvermogen(), of null
   * @param {object} battery
   * @param {{capaciteitstarief_eur_per_kw_jaar:number, afname_tarief_eur_kwh:number, injectie_vergoeding_eur_kwh:number, allowGridCharging?:boolean}} params
   */
  function combinedCalculate(kwartierIntervals, piekvermogenMonths, battery, params) {
    const allowGridCharging = params.allowGridCharging !== false;
    const { monthResults, monthsUsed, usingOfficialBaseline, warnings } = computeMonthlyCombined(
      kwartierIntervals,
      piekvermogenMonths,
      battery,
      allowGridCharging
    );

    // Piekaftopping / capaciteitstarief.
    const baselinePeaks = usingOfficialBaseline
      ? monthResults.map((m) => m.officialCurrentPeakKw)
      : monthResults.map((m) => m.derivedCurrentPeakKw);
    const newPeaks = monthResults.map((m) => m.simulatedNewPeakKw);
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const currentYearPeakKw = roundUpPeakKw(avg(baselinePeaks));
    const newYearPeakKw = roundUpPeakKw(avg(newPeaks));
    // currentYearPeakKw en newYearPeakKw worden allebei apart naar boven
    // afgerond (zoals Fluvius' eigen capaciteitstarief-regel) — hun verschil
    // rechtstreeks nemen kan daardoor tot bijna 1kW hoger uitkomen dan wat de
    // batterij in werkelijkheid ooit in één keer kan leveren. Begrens dus op
    // het (Tweakers/fabrikant-geverifieerde) ontlaadvermogen van de batterij:
    // die fysieke grens kan de piek sowieso nooit méér verlagen, ongeacht wat
    // de afgeronde jaarcijfers suggereren.
    const peakReductionKw = Math.min(Math.max(currentYearPeakKw - newYearPeakKw, 0), battery.max_discharge_kw);

    // Zelfverbruik — dezelfde simulatie, dus enkel wat de batterij overhield
    // ná voorrang aan piekaftopping (zie simulateMonthDetailed hierboven).
    const totalAvoidedAfnameKwh = monthResults.reduce((sum, m) => sum + m.avoidedAfnameKwh, 0);
    const totalAvoidedInjectieKwh = monthResults.reduce((sum, m) => sum + m.avoidedInjectieKwh, 0);
    const totalDischargedKwh = monthResults.reduce((sum, m) => sum + m.dischargedKwh, 0);
    const totalGridChargeKwh = monthResults.reduce((sum, m) => sum + m.gridChargeKwh, 0);
    const yearFactor = 365 / daysCovered(kwartierIntervals);
    const annualAvoidedAfnameKwh = totalAvoidedAfnameKwh * yearFactor;
    const annualAvoidedInjectieKwh = totalAvoidedInjectieKwh * yearFactor;
    const annualDischargedKwh = totalDischargedKwh * yearFactor;
    const annualGridChargeKwh = totalGridChargeKwh * yearFactor;

    // Zelfverbruik afbakenen als "welk deel van de opgevangen zonne-overschot
    // kwam later ook echt terug als vermeden afname" (na round-trip-verlies) —
    // dat hangt puur af van hoeveel zon er was, nooit van de piekdrempel of
    // van "laden vanaf het net" (dat raakt enkel de piekaftopping hieronder).
    // De rest van de vermeden afname (bv. ontlading die enkel nodig was om
    // een piek af te toppen) wordt bij de piekopbrengst geteld in plaats van
    // hier, zodat het vinkje "laden van het net" de opbrengst eigenverbruik
    // niet kan beïnvloeden — enkel de piekopbrengst.
    const efficiency = battery.roundtrip_efficiency_pct / 100;
    const annualSelfConsumptionAfnameKwh = annualAvoidedInjectieKwh * efficiency;
    const selfConsumptionBenefit =
      annualSelfConsumptionAfnameKwh * params.afname_tarief_eur_kwh -
      annualAvoidedInjectieKwh * params.injectie_vergoeding_eur_kwh;

    const peakDrivenAfnameKwh = Math.max(annualAvoidedAfnameKwh - annualSelfConsumptionAfnameKwh, 0);
    const peakBenefit =
      peakReductionKw * params.capaciteitstarief_eur_per_kw_jaar + peakDrivenAfnameKwh * params.afname_tarief_eur_kwh;

    const annualBenefit = peakBenefit + selfConsumptionBenefit;

    return {
      monthResults,
      monthsUsed,
      usingOfficialBaseline,
      currentYearPeakKw,
      newYearPeakKw,
      peakReductionKw,
      peakBenefit,
      annualAvoidedAfnameKwh,
      annualSelfConsumptionAfnameKwh,
      annualAvoidedInjectieKwh,
      annualDischargedKwh,
      annualGridChargeKwh,
      selfConsumptionBenefit,
      annualBenefit,
      warnings,
      ...evaluateBattery(battery, annualBenefit),
    };
  }

  // Hoeveel jaar de terugverdien-grafiek en -tabel weergeven: minstens tot
  // twee jaar na de terugverdientijd zelf (zodat het snijpunt niet op de
  // rand valt), en minstens tot de garantie- en levensduurmarkering, zodat
  // die altijd zichtbaar zijn. Gedeeld door renderPaybackChart (charts.js)
  // en de terugverdientabel (app.js) zodat grafiek en tabel exact dezelfde
  // jaren tonen.
  function computePaybackHorizonYears({ paybackYears, profitable, warrantyYears, lifespanYears }) {
    const safeWarranty = warrantyYears ?? 0;
    const safeLifespan = lifespanYears ?? 0;
    const horizon = profitable
      ? Math.max(Math.ceil(paybackYears) + 2, safeWarranty, safeLifespan)
      : Math.max(safeWarranty, safeLifespan, 10);
    return Math.min(25, Math.max(1, horizon));
  }

  return {
    combinedCalculate,
    evaluateBattery,
    daysCovered,
    filterToLastYear,
    filterToLastYearMonths,
    computeMonthlyCombined,
    computePaybackHorizonYears,
    BE_REGISTRATION_THRESHOLD_KW,
  };
})();
