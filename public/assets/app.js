(() => {
  let batteries = [];
  // Gegevens van de laatste geslaagde berekening, herbruikt om per batterij
  // op-aanvraag de detailgrafieken te bouwen zonder de CSV opnieuw te lezen.
  let lastKwartierIntervals = null;
  let lastPiekvermogenMonths = null;
  let lastResultsByBatteryId = new Map();
  let expandedBatteryId = null;
  const detailCache = new Map();

  const eurFmt2 = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
  const kwFmt = (v) => `${v.toFixed(2)} kW`;
  const kwhFmt = (v) => `${v.toFixed(0)} kWh`;

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file, 'utf-8');
    });
  }

  async function loadBatteries() {
    const res = await fetch('data/batteries.json', { cache: 'no-store' });
    const data = await res.json();
    batteries = (data.batteries ?? []).filter((b) => b.active !== false);
    const updatedAtEl = document.getElementById('prices-updated-at');
    updatedAtEl.textContent = data.updated_at ? new Date(data.updated_at).toLocaleDateString('nl-BE') : 'onbekend (testdata)';
  }

  function readParams() {
    return {
      capaciteitstarief_eur_per_kw_jaar: Number(document.getElementById('capaciteitstarief').value),
      afname_tarief_eur_kwh: Number(document.getElementById('afname-tarief').value),
      injectie_vergoeding_eur_kwh: Number(document.getElementById('injectie-vergoeding').value),
      allowGridCharging: document.getElementById('allow-grid-charging').checked,
    };
  }

  function paybackCell(result) {
    if (result.profitable === null) return '—';
    if (!result.profitable) return '<span class="not-profitable">nooit rendabel</span>';
    return `<span class="profitable">${result.paybackYears.toFixed(1)} jaar</span>`;
  }

  function renderResults(rows, dataNotes) {
    const out = document.getElementById('results-output');
    let html = '<div class="panel"><h2><span class="step-badge">✓</span>Resultaat</h2>';

    for (const note of dataNotes ?? []) {
      html += `<div class="warning-box">ℹ️ ${note}</div>`;
    }

    if (rows.length > 0) {
      const baseline = rows[0].result; // currentYearPeakKw/warnings zijn batterij-onafhankelijk, identiek voor elke rij
      for (const w of baseline.warnings) {
        html += `<div class="warning-box">⚠️ ${w}</div>`;
      }
      html += `<p class="result-summary">Huidige jaarpiek: <strong>${kwFmt(baseline.currentYearPeakKw)}</strong>` +
        (baseline.usingOfficialBaseline ? ' (officiële Fluvius-data)' : ' (geschat uit kwartiertotalen)') +
        ` over ${baseline.monthsUsed} maand(en) data.</p>`;
    }

    html += `<div class="table-scroll"><table class="results results-main"><thead><tr>
      <th>Batterij</th>
      <th>Initiële kost</th>
      <th>Jaar&shy;lijkse kosten</th>
      <th>Extra zelf&shy;verbruik</th>
      <th>Impact op piek&shy;tarief</th>
      <th>Jaar&shy;lijkse baten</th>
      <th>Terug&shy;verdien&shy;tijd</th>
    </tr></thead><tbody>`;
    for (const row of rows) {
      const upfrontCost = row.battery.current_price_eur != null
        ? eurFmt2.format(row.battery.current_price_eur + (row.battery.one_time_costs_eur ?? 0))
        : 'onbekend';
      const recurringCost = eurFmt2.format(row.battery.recurring_costs_eur_per_year ?? 0);
      html += `<tr class="battery-row" data-battery-id="${row.battery.id}" tabindex="0">
        <td>${row.battery.brand} ${row.battery.model}</td>
        <td>${upfrontCost}</td>
        <td>${recurringCost}</td>
        <td>${kwhFmt(row.result.annualSelfConsumptionAfnameKwh)}</td>
        <td>${kwFmt(row.result.peakReductionKw)}</td>
        <td>${eurFmt2.format(row.result.annualBenefit)}</td>
        <td>${paybackCell(row.result)}</td>
      </tr>
      <tr class="detail-row" data-battery-id="${row.battery.id}" hidden>
        <td colspan="7"></td>
      </tr>`;
    }
    html += '</tbody></table></div>';
    html += '<p class="field-hint">Klik op een batterij voor maandgrafieken.</p>';
    html += '<p class="disclaimer">Gecombineerde simulatie (piekaftopping + zelfverbruik), indicatief — het werkelijke resultaat hangt af van het regelalgoritme van de batterij zelf.</p>';

    html += '</div>';
    out.innerHTML = html;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  function buildBatteryInfoHtml(battery) {
    const links = [];
    if (battery.tweakers_url) {
      links.push(`<a href="${escapeHtml(battery.tweakers_url)}" target="_blank" rel="noopener">Tweakers</a>`);
    }
    if (battery.manufacturer_url) {
      links.push(`<a href="${escapeHtml(battery.manufacturer_url)}" target="_blank" rel="noopener">Fabrikant</a>`);
    }
    const linksHtml = links.length ? `<p class="battery-links">${links.join(' · ')}</p>` : '';

    const specsHtml = `<p class="battery-specs">
      <span><strong>Capaciteit:</strong> ${battery.capacity_kwh} kWh (${battery.usable_capacity_kwh} kWh bruikbaar)</span>
      <span><strong>Laadvermogen:</strong> ${kwFmt(battery.max_charge_kw)}</span>
      <span><strong>Ontlaadvermogen (piekvermogen):</strong> ${kwFmt(battery.max_discharge_kw)}</span>
    </p>`;

    const needsRegistration = Math.max(battery.max_charge_kw, battery.max_discharge_kw) >= BatteryCalculators.BE_REGISTRATION_THRESHOLD_KW;
    const registrationHtml = needsRegistration
      ? `<p class="battery-registration">⚠️ Aanmelding bij Fluvius verplicht: dit vermogen zit op of boven de ${kwFmt(BatteryCalculators.BE_REGISTRATION_THRESHOLD_KW)}-drempel ` +
        `voor plug-and-play-toestellen (Synergrid C10/26) — meld dit toestel binnen 30 dagen aan via Mijn Fluvius. ` +
        `Wettelijk mag een stekkerbatterij tot 2500W, dit is geen technisch maximum, wel een meldplicht.</p>`
      : '';

    const lifespanRows = [];
    if (battery.price_url && battery.current_price_eur != null) {
      const sourceLabels = {
        shop: null,
        tweakers: '(via Tweakers)',
        manufacturer_list: '(adviesprijs fabrikant)',
        unverified: '(prijs niet onafhankelijk geverifieerd)',
      };
      const sourceNote = sourceLabels[battery.price_source_label];
      const sourceHtml = sourceNote ? ` <span class="price-source-note">${escapeHtml(sourceNote)}</span>` : '';
      lifespanRows.push([
        'Prijs',
        `${eurFmt2.format(battery.current_price_eur)} bij <a href="${escapeHtml(battery.price_url)}" target="_blank" rel="noopener">${escapeHtml(battery.shop_name ?? 'winkel')}</a>${sourceHtml}`,
      ]);
    }
    if (battery.chemistry) lifespanRows.push(['Type batterij', escapeHtml(battery.chemistry)]);
    if (battery.expected_cycles != null) lifespanRows.push(['Verwacht aantal cycli', `± ${battery.expected_cycles.toLocaleString('nl-BE')}`]);
    lifespanRows.push(['Garantie', `${battery.warranty_years} jaar`]);
    if (battery.expected_lifespan_note) lifespanRows.push(['Verwachte levensduur', escapeHtml(battery.expected_lifespan_note)]);

    const yesNo = (v) => (v === true ? 'Ja' : v === false ? 'Nee' : 'Onbevestigd');
    if (battery.p1_port_support !== undefined) {
      const note = battery.p1_port_note ? ` — ${escapeHtml(battery.p1_port_note)}` : '';
      lifespanRows.push(['P1-sturing (laden op zonne-overschot)', `${yesNo(battery.p1_port_support)}${note}`]);
    }
    if (battery.direct_pv_input !== undefined) {
      const note = battery.direct_pv_input_note ? ` — ${escapeHtml(battery.direct_pv_input_note)}` : '';
      lifespanRows.push(['Rechtstreeks zonnepanelen aansluiten', `${yesNo(battery.direct_pv_input)}${note}`]);
    }

    const lifespanHtml = lifespanRows.length
      ? `<table class="battery-lifespan">
          ${lifespanRows.map(([label, value]) => `<tr><th>${label}</th><td>${value}</td></tr>`).join('')}
        </table>`
      : '';

    const notesHtml = battery.notes
      ? `<details class="battery-notes">
          <summary>Notities (onderzoek &amp; bronnen)</summary>
          <p>${escapeHtml(battery.notes)}</p>
        </details>`
      : '';
    return `<div class="battery-info">${linksHtml}${specsHtml}${registrationHtml}${lifespanHtml}${notesHtml}</div>`;
  }

  // Cijfermatige tegenhanger van de terugverdien-grafiek, jaar per jaar, met
  // dezelfde horizon (computePaybackHorizonYears) zodat grafiek en tabel
  // exact overeenkomen. Piekvermindering/eigenverbruik en hun opbrengsten
  // zijn het jaarlijkse gemiddelde uit de simulatie en dus constant per
  // jaar — enkel de openstaande kost daalt cumulatief (nooit onder € 0).
  function buildPaybackTableHtml(battery, result, upfrontCost) {
    const horizonYears = BatteryCalculators.computePaybackHorizonYears({
      paybackYears: result.paybackYears,
      profitable: result.profitable,
      warrantyYears: battery.warranty_years,
      lifespanYears: battery.expected_lifespan_years,
    });

    let rows = '';
    for (let year = 1; year <= horizonYears; year++) {
      const outstanding = Math.max(upfrontCost - result.netAnnualBenefit * year, 0);
      rows += `<tr>
        <td>${year}</td>
        <td>${eurFmt2.format(outstanding)}</td>
        <td>${kwFmt(result.peakReductionKw)}</td>
        <td>${eurFmt2.format(result.peakBenefit)}</td>
        <td>${kwhFmt(result.annualSelfConsumptionAfnameKwh)}</td>
        <td>${eurFmt2.format(result.selfConsumptionBenefit)}</td>
      </tr>`;
    }

    return `<div class="chart-block">
      <h4>Terugverdientijd per jaar</h4>
      <div class="table-scroll">
        <table class="results payback-table">
          <thead><tr>
            <th>Jaar</th>
            <th>Openstaande kost</th>
            <th>Piekvermindering</th>
            <th>Opbrengst piek</th>
            <th>Hoger eigenverbruik</th>
            <th>Opbrengst eigenverbruik</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="field-hint">Piekvermindering, eigenverbruik en hun opbrengsten zijn het jaarlijkse gemiddelde uit de simulatie (op basis van de ingevoerde afname- en injectietarieven) en blijven ongewijzigd per jaar; enkel de openstaande kost daalt cumulatief tot € 0,00.</p>
    </div>`;
  }

  // Bouwt de info + drie grafieken voor één batterij. De eerste twee
  // (maandelijks) hergebruiken monthResults uit de al-berekende
  // combinedCalculate-uitkomst (result) die ook de resultatentabel voedt, in
  // plaats van de simulatie opnieuw te draaien — alle grafieken tonen dus
  // exact hetzelfde batterijgedrag, elk vanuit een ander oogpunt. De derde
  // (terugverdientijd) projecteert diezelfde jaarlijkse baten vooruit in de
  // tijd tegenover de initiële kost.
  function buildBatteryDetailHtml(battery, result) {
    let html = buildBatteryInfoHtml(battery);
    html += '<div class="detail-charts">';

    const hasInjectie = lastKwartierIntervals.some((iv) => iv.injectie_kwh > 0);

    if (hasInjectie) {
      const efficiency = battery.roundtrip_efficiency_pct / 100;
      const consumptionData = result.monthResults.map((m) => {
        const selfConsumptionKwh = m.avoidedInjectieKwh * efficiency;
        return {
          month: m.month,
          base: Math.max(m.totalAfnameKwh - selfConsumptionKwh, 0),
          extra: selfConsumptionKwh,
        };
      });
      html += BatteryCharts.renderStackedBarChart({
        title: 'Verbruik per maand',
        data: consumptionData,
        unit: 'kWh',
        baseLabel: 'Verbruik uit net',
        extraLabel: 'Extra zelfverbruik dankzij batterij',
      });
    } else {
      html += '<div class="chart-block"><h4>Verbruik per maand</h4><p class="field-hint">Geen injectiedata (zonnepanelen) gevonden in de geüploade CSV — extra zelfverbruik is hier niet van toepassing.</p></div>';
    }

    // Waar komt de lading vandaan? In de winter is er nauwelijks zonne-overschot,
    // dus wordt er vanaf het net geladen om de maandpiek te kunnen blijven
    // afvlakken. Die stroom betaal je wél, en dat verklaart waarom het
    // "extra zelfverbruik" in de wintermaanden bijna nul is terwijl de piek
    // toch verlaagd wordt — zonder deze grafiek lijken die twee elkaar tegen
    // te spreken.
    const chargeSourceData = result.monthResults.map((m) => ({
      month: m.month,
      base: m.gridChargeKwh,
      extra: m.avoidedInjectieKwh,
    }));
    const totalGridCharge = chargeSourceData.reduce((s, d) => s + d.base, 0);
    html += BatteryCharts.renderStackedBarChart({
      title: 'Laadbron per maand',
      data: chargeSourceData,
      unit: 'kWh',
      baseLabel: 'Vanaf het net geladen (betaald)',
      extraLabel: 'Eigen zonne-overschot (gratis)',
    });
    if (totalGridCharge > 1) {
      html += `<p class="field-hint chart-note">In maanden met weinig zon laadt de batterij vanaf het net bij om de
        maandpiek te kunnen blijven afvlakken (dit kan uitgezet worden bij stap 2 hierboven). Die kWh's betaal je aan
        het afnametarief en leveren dus géén "extra zelfverbruik" op — dat blijft voorbehouden voor opgevangen
        zonne-overschot. Netladen blijft wel zinvol omdat het de piek verder verlaagt; dat voordeel (inclusief de
        kWh's die er zelf mee afgetopt worden) staat apart bij "opbrengst piek" in de terugverdiengrafiek.</p>`;
    }

    const peakData = result.monthResults.map((m) => {
      const currentPeak = result.usingOfficialBaseline ? m.officialCurrentPeakKw : m.derivedCurrentPeakKw;
      // Begrensd op het echte ontlaadvermogen van de batterij: de simulatie
      // zocht enkel tegenover de uit kwartiertotalen afgeleide piek, dus als
      // de officiële Fluvius-piek voor deze maand hoger uitvalt, mag het
      // verschil niet groter getoond worden dan wat de batterij fysiek in
      // één keer kan leveren.
      const reduction = Math.min(Math.max(currentPeak - m.simulatedNewPeakKw, 0), battery.max_discharge_kw);
      return { month: m.month, base: Math.max(currentPeak - reduction, 0), extra: reduction };
    });
    html += BatteryCharts.renderStackedBarChart({
      title: 'Piekvermogen per maand' + (result.usingOfficialBaseline ? ' (officiële Fluvius-data)' : ' (geschat uit kwartiertotalen)'),
      data: peakData,
      unit: 'kW',
      baseLabel: 'Nieuwe piek',
      extraLabel: 'Piekverlaging dankzij batterij',
    });

    if (result.profitable === null) {
      html += '<div class="chart-block"><h4>Terugverdientijd</h4><p class="field-hint">Geen actuele prijs bekend voor deze batterij — terugverdientijd kan niet berekend worden.</p></div>';
    } else {
      const upfrontCost = (battery.current_price_eur ?? 0) + (battery.one_time_costs_eur ?? 0);
      html += BatteryCharts.renderPaybackChart({
        title: 'Terugverdientijd: baten vs. kosten',
        upfrontCost,
        peakBenefit: result.peakBenefit,
        selfConsumptionBenefit: result.selfConsumptionBenefit,
        netAnnualBenefit: result.netAnnualBenefit,
        paybackYears: result.paybackYears,
        profitable: result.profitable,
        warrantyYears: battery.warranty_years,
        lifespanYears: battery.expected_lifespan_years,
      });
      html += buildPaybackTableHtml(battery, result, upfrontCost);
    }

    html += '</div>';
    return html;
  }

  function toggleBatteryDetail(batteryId) {
    const resultsOutput = document.getElementById('results-output');
    const detailRow = resultsOutput.querySelector(`tr.detail-row[data-battery-id="${CSS.escape(batteryId)}"]`);
    const battRow = resultsOutput.querySelector(`tr.battery-row[data-battery-id="${CSS.escape(batteryId)}"]`);
    if (!detailRow || !battRow) return;

    if (expandedBatteryId === batteryId) {
      detailRow.hidden = true;
      battRow.classList.remove('expanded');
      expandedBatteryId = null;
      return;
    }

    if (expandedBatteryId) {
      const prevDetail = resultsOutput.querySelector(`tr.detail-row[data-battery-id="${CSS.escape(expandedBatteryId)}"]`);
      const prevRow = resultsOutput.querySelector(`tr.battery-row[data-battery-id="${CSS.escape(expandedBatteryId)}"]`);
      if (prevDetail) prevDetail.hidden = true;
      if (prevRow) prevRow.classList.remove('expanded');
    }

    const cell = detailRow.querySelector('td');
    if (!detailCache.has(batteryId)) {
      const battery = batteries.find((b) => b.id === batteryId);
      const result = lastResultsByBatteryId.get(batteryId);
      cell.innerHTML = battery && result ? buildBatteryDetailHtml(battery, result) : '<p class="field-hint">Batterij niet gevonden.</p>';
      BatteryCharts.attachInteractivity(cell);
      detailCache.set(batteryId, true);
    }
    detailRow.hidden = false;
    battRow.classList.add('expanded');
    expandedBatteryId = batteryId;
  }

  function setupResultsClickHandling() {
    const resultsOutput = document.getElementById('results-output');
    resultsOutput.addEventListener('click', (evt) => {
      const row = evt.target.closest('tr.battery-row');
      if (row) toggleBatteryDetail(row.dataset.batteryId);
    });
    resultsOutput.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' && evt.key !== ' ') return;
      const row = evt.target.closest('tr.battery-row');
      if (row) {
        evt.preventDefault();
        toggleBatteryDetail(row.dataset.batteryId);
      }
    });
  }

  function showError(message) {
    document.getElementById('error-output').innerHTML = `<div class="error-box">${message}</div>`;
  }

  async function handleSubmit(evt) {
    evt.preventDefault();
    document.getElementById('error-output').innerHTML = '';
    document.getElementById('results-output').innerHTML = '';
    detailCache.clear();
    lastResultsByBatteryId = new Map();
    expandedBatteryId = null;

    const kwartierFile = document.getElementById('kwartiertotalen-file').files[0];
    if (!kwartierFile) {
      showError('Upload eerst een kwartiertotalen-CSV.');
      return;
    }

    const params = readParams();

    try {
      const kwartierText = await readFileAsText(kwartierFile);
      const parsedIntervals = FluviusCsv.parseKwartiertotalen(kwartierText);
      const dataNotes = [];
      if (parsedIntervals.skippedRows > 0) {
        dataNotes.push(
          `${parsedIntervals.skippedRows} kwartier(en) met een ontbrekende meteropname in de kwartiertotalen-CSV werden genegeerd.`
        );
      }

      const kwartierIntervals = BatteryCalculators.filterToLastYear(parsedIntervals);
      if (kwartierIntervals.length === 0) {
        showError('Geen data gevonden in de 12 maanden voorafgaand aan de huidige maand — controleer of de CSV recent genoeg is.');
        return;
      }
      const monthFmt = (d) => d.toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' });
      const lastIncludedMonth = new Date(kwartierIntervals.windowEnd);
      lastIncludedMonth.setMonth(lastIncludedMonth.getMonth() - 1);
      const actualDays = BatteryCalculators.daysCovered(kwartierIntervals);
      dataNotes.push(
        `Berekening gebaseerd op de 12 maanden voorafgaand aan de huidige maand (${monthFmt(kwartierIntervals.windowStart)} t/m ${monthFmt(lastIncludedMonth)}` +
        `${actualDays < 300 ? `, waarvan slechts ${actualDays.toFixed(0)} dagen effectief data bevatten — resultaten zijn minder betrouwbaar` : ''}).`
      );

      let piekvermogenMonths = null;
      const piekFile = document.getElementById('piekvermogen-file').files[0];
      if (piekFile) {
        const piekText = await readFileAsText(piekFile);
        const parsedMonths = FluviusCsv.parsePiekvermogen(piekText);
        if (parsedMonths.skippedRows > 0) {
          dataNotes.push(
            `${parsedMonths.skippedRows} maand(en) met een ontbrekende piekwaarde in de piekvermogen-CSV werden genegeerd.`
          );
        }
        piekvermogenMonths = BatteryCalculators.filterToLastYearMonths(parsedMonths);
        if (piekvermogenMonths.length === 0) {
          showError('Geen afgesloten maanden gevonden in de piekvermogen-CSV binnen het laatste jaar.');
          return;
        }
      }

      if (batteries.length === 0) {
        showError('Geen batterijen gevonden om te berekenen.');
        return;
      }

      const rows = [];
      for (const battery of batteries) {
        const result = BatteryCalculators.combinedCalculate(kwartierIntervals, piekvermogenMonths, battery, params);
        rows.push({ battery, result });
      }
      rows.sort((a, b) => {
        // Batterijen zonder geverifieerde huidige prijs+koopllink onderaan:
        // we weten dan niet zeker of ze nog besteld kunnen worden, dus een
        // gunstige terugverdientijd zou misleidend bovenaan staan.
        const aHasLink = a.battery.price_url != null;
        const bHasLink = b.battery.price_url != null;
        if (aHasLink !== bHasLink) return aHasLink ? -1 : 1;
        const ap = a.result.paybackYears ?? Infinity;
        const bp = b.result.paybackYears ?? Infinity;
        return ap - bp;
      });

      lastKwartierIntervals = kwartierIntervals;
      lastPiekvermogenMonths = piekvermogenMonths;
      lastResultsByBatteryId = new Map(rows.map((r) => [r.battery.id, r.result]));

      renderResults(rows, dataNotes);
    } catch (err) {
      showError(err.message || String(err));
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupResultsClickHandling();
    loadBatteries().catch((err) => showError(`Kon batterijenlijst niet laden: ${err.message}`));
    document.getElementById('calc-form').addEventListener('submit', handleSubmit);
  });
})();
