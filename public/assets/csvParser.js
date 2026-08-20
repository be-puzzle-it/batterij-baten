// Parser voor Fluvius "Mijn Fluvius" verbruikshistoriek-exports.
// Alles gebeurt hier client-side op de inhoud die FileReader al in het
// geheugen heeft — er wordt nooit iets verstuurd.
//
// Beide exporttypes delen hetzelfde CSV-format (';'-gescheiden, NL-komma als
// decimaalteken, EAN als Excel-forced-text ="..."), geverifieerd tegen twee
// echte exportbestanden:
//  - kwartiertotalen: 2 rijen per kwartier (Afname <Dag|Nacht> + Injectie <Dag|Nacht>), Volume in kWh
//  - piekvermogen: 1 rij per kalendermaand (Register=Piekvermogen), Volume al in kW
const FluviusCsv = (() => {
  const REQUIRED_HEADERS = ['Van (datum)', 'Van (tijdstip)', 'Register', 'Volume', 'Eenheid', 'Validatiestatus'];

  function splitLines(text) {
    return text.split(/\r\n|\r|\n/);
  }

  function buildHeaderIndex(headerFields) {
    const index = {};
    headerFields.forEach((h, i) => { index[h.trim()] = i; });
    const missing = REQUIRED_HEADERS.filter((h) => !(h in index));
    if (missing.length > 0) {
      throw new Error(
        `Onverwacht CSV-formaat, ontbrekende kolommen: ${missing.join(', ')}. ` +
        'Dit lijkt geen Fluvius-verbruikshistoriek-export te zijn.'
      );
    }
    return index;
  }

  // Fluvius laat Volume soms leeg bij een ontbrekende meteropname (communicatiegap) —
  // dat is geen parsefout, gewoon geen waarde voor die periode. Geeft null terug i.p.v. te gooien.
  function parseVolume(raw) {
    const trimmed = String(raw).trim();
    if (trimmed === '') return null;
    const normalized = trimmed.replace(',', '.');
    const value = parseFloat(normalized);
    if (Number.isNaN(value)) {
      throw new Error(`Kon volumewaarde niet interpreteren: '${raw}'`);
    }
    return value;
  }

  function parseTimestamp(dateStr, timeStr) {
    const dateMatch = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(dateStr).trim());
    const timeMatch = /^(\d{2}):(\d{2}):(\d{2})$/.exec(String(timeStr).trim());
    if (!dateMatch || !timeMatch) {
      throw new Error(`Kon datum/tijd niet interpreteren: '${dateStr} ${timeStr}'`);
    }
    const [, dd, mm, yyyy] = dateMatch;
    const [, HH, MI, SS] = timeMatch;
    // Lokale wandkloktijd van de meter, geen tijdzoneconversie nodig — puur als sorteer-/groepeersleutel gebruikt.
    return `${yyyy}-${mm}-${dd}T${HH}:${MI}:${SS}`;
  }

  function eachRow(text, callback) {
    const lines = splitLines(text);
    let headerIndex = null;
    for (const line of lines) {
      if (line.trim() === '') continue;
      const fields = line.split(';');
      if (headerIndex === null) {
        headerIndex = buildHeaderIndex(fields);
        continue;
      }
      callback({
        van_datum: fields[headerIndex['Van (datum)']] ?? '',
        van_tijdstip: fields[headerIndex['Van (tijdstip)']] ?? '',
        register: String(fields[headerIndex['Register']] ?? '').trim(),
        volume: fields[headerIndex['Volume']] ?? '',
        validatiestatus: String(fields[headerIndex['Validatiestatus']] ?? '').trim(),
      });
    }
    if (headerIndex === null) {
      throw new Error('Leeg of onleesbaar CSV-bestand.');
    }
  }

  // Een lege Volume met Validatiestatus "Geen verbruik" betekent letterlijk 0,
  // geen ontbrekende meting — enkel een andere/onbekende status bij een lege
  // waarde is een echte gap die we niet stilzwijgend op 0 mogen zetten.
  function resolveVolume(row) {
    const volume = parseVolume(row.volume);
    if (volume !== null) return volume;
    return row.validatiestatus === 'Geen verbruik' ? 0 : null;
  }

  // -> [{timestamp: "YYYY-MM-DDTHH:MM:SS", afname_kwh, injectie_kwh}], oplopend gesorteerd.
  // Heeft ook .skippedRows (aantal genegeerde rijen met een echt onbekende Volume-waarde).
  function parseKwartiertotalen(text) {
    const intervals = new Map();
    let skippedRows = 0;
    eachRow(text, (row) => {
      const volume = resolveVolume(row);
      if (volume === null) {
        skippedRows += 1;
        return;
      }
      const ts = parseTimestamp(row.van_datum, row.van_tijdstip);
      let entry = intervals.get(ts);
      if (!entry) {
        entry = { timestamp: ts, afname_kwh: 0, injectie_kwh: 0 };
        intervals.set(ts, entry);
      }
      if (row.register.startsWith('Afname')) {
        entry.afname_kwh += volume;
      } else if (row.register.startsWith('Injectie')) {
        entry.injectie_kwh += volume;
      }
    });
    if (intervals.size === 0) {
      throw new Error('Geen Afname/Injectie-kwartierwaarden gevonden in dit bestand.');
    }
    const result = Array.from(intervals.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    result.skippedRows = skippedRows;
    return result;
  }

  // -> [{month: "YYYY-MM", peak_kw, provisional}], oplopend gesorteerd. Heeft ook .skippedRows.
  function parsePiekvermogen(text) {
    const months = new Map();
    let skippedRows = 0;
    eachRow(text, (row) => {
      if (row.register !== 'Piekvermogen') return;
      const volume = resolveVolume(row);
      if (volume === null) {
        skippedRows += 1;
        return;
      }
      const ts = parseTimestamp(row.van_datum, row.van_tijdstip);
      const monthKey = ts.slice(0, 7);
      months.set(monthKey, {
        month: monthKey,
        peak_kw: volume,
        provisional: row.validatiestatus === 'Voorlopig',
      });
    });
    if (months.size === 0) {
      throw new Error("Geen 'Piekvermogen'-rijen gevonden in dit bestand — is dit wel een piekvermogen-export?");
    }
    const result = Array.from(months.values()).sort((a, b) => a.month.localeCompare(b.month));
    result.skippedRows = skippedRows;
    return result;
  }

  return { parseKwartiertotalen, parsePiekvermogen };
})();
