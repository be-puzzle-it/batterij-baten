// Stacked-bar maandgrafieken voor de batterij-detailweergave. Puur SVG,
// geen library — kleuren gevalideerd met de dataviz-skill se validator
// (CVD-separatie in de legale 6-8-band, gemitigeerd met een 2px-gap tussen
// segmenten, een legende en een hover/focus-tooltip per staaf).
const BatteryCharts = (() => {
  const BAR_MAX_WIDTH = 24;
  const GAP_PX = 2;

  const MONTH_ABBR_NL = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const MONTH_FULL_NL = [
    'januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december',
  ];

  function monthAbbrLabel(monthKey) {
    const [y, m] = monthKey.split('-');
    return `${MONTH_ABBR_NL[parseInt(m, 10) - 1]} '${y.slice(2)}`;
  }

  function monthFullLabel(monthKey) {
    const [y, m] = monthKey.split('-');
    return `${MONTH_FULL_NL[parseInt(m, 10) - 1]} ${y}`;
  }

  function niceStep(maxValue) {
    if (maxValue <= 0) return 1;
    const roughStep = maxValue / 4;
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const residual = roughStep / magnitude;
    let niceResidual;
    if (residual > 5) niceResidual = 10;
    else if (residual > 2) niceResidual = 5;
    else if (residual > 1) niceResidual = 2;
    else niceResidual = 1;
    return niceResidual * magnitude;
  }

  function fmtNumber(v) {
    return Number(v).toLocaleString('nl-BE', { maximumFractionDigits: 1 });
  }

  function roundedTopRectPath(x, y, w, h, radius) {
    if (h <= 0) return '';
    const r = Math.min(radius, h, w / 2);
    if (r <= 0) {
      return `M${x},${y + h} L${x},${y} L${x + w},${y} L${x + w},${y + h} Z`;
    }
    return (
      `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} ` +
      `L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`
    );
  }

  let nextChartId = 0;

  /**
   * @param {object} opts
   * @param {string} opts.title
   * @param {Array<{month:string, base:number, extra:number}>} opts.data
   * @param {string} opts.unit
   * @param {string} opts.baseLabel
   * @param {string} opts.extraLabel
   */
  function renderStackedBarChart(opts) {
    const { title, data, unit, baseLabel, extraLabel } = opts;
    const containerId = `chart-${nextChartId++}`;

    const width = 720;
    const height = 300;
    const marginLeft = 52;
    const marginRight = 12;
    const marginTop = 16;
    const marginBottom = 34;
    const plotWidth = width - marginLeft - marginRight;
    const plotHeight = height - marginTop - marginBottom;

    const maxTotal = Math.max(1, ...data.map((d) => d.base + d.extra));
    const step = niceStep(maxTotal);
    const tickCount = Math.max(1, Math.ceil(maxTotal / step));
    const axisMax = tickCount * step;

    const n = Math.max(1, data.length);
    const slotWidth = plotWidth / n;
    const barWidth = Math.min(BAR_MAX_WIDTH, slotWidth * 0.6);
    const baselineY = marginTop + plotHeight;

    let gridlines = '';
    let yTicks = '';
    for (let i = 0; i <= tickCount; i++) {
      const value = i * step;
      const y = baselineY - (value / axisMax) * plotHeight;
      gridlines += `<line x1="${marginLeft}" y1="${y}" x2="${width - marginRight}" y2="${y}" class="chart-gridline" />`;
      yTicks += `<text x="${marginLeft - 8}" y="${y + 4}" class="chart-tick" text-anchor="end">${fmtNumber(value)}</text>`;
    }

    let bars = '';
    let xLabels = '';
    data.forEach((d, i) => {
      const slotX = marginLeft + i * slotWidth;
      const barX = slotX + (slotWidth - barWidth) / 2;
      const hasBase = d.base > 0.001;
      const hasExtra = d.extra > 0.001;
      const baseH = (d.base / axisMax) * plotHeight;
      const extraH = (d.extra / axisMax) * plotHeight;
      const baseY = baselineY - baseH;
      const extraY = baseY - (hasBase && hasExtra ? GAP_PX : 0) - extraH;

      let segPaths = '';
      if (hasBase) {
        const radius = hasExtra ? 0 : 4;
        segPaths += `<path d="${roundedTopRectPath(barX, baseY, barWidth, baseH, radius)}" class="chart-fill-base" />`;
      }
      if (hasExtra) {
        segPaths += `<path d="${roundedTopRectPath(barX, extraY, barWidth, extraH, 4)}" class="chart-fill-extra" />`;
      }

      bars += `<g class="chart-bar-group" tabindex="0" role="img"
        aria-label="${monthFullLabel(d.month)}: ${fmtNumber(d.base)} ${unit} ${baseLabel}, ${fmtNumber(d.extra)} ${unit} ${extraLabel}"
        data-month="${monthFullLabel(d.month)}" data-base="${d.base}" data-extra="${d.extra}" data-total="${d.base + d.extra}">
        <rect x="${barX - 6}" y="${marginTop}" width="${barWidth + 12}" height="${plotHeight}" class="chart-hit" />
        ${segPaths}
      </g>`;

      xLabels += `<text x="${slotX + slotWidth / 2}" y="${height - marginBottom + 16}" class="chart-tick" text-anchor="middle">${monthAbbrLabel(d.month)}</text>`;
    });

    const svg = `<svg viewBox="0 0 ${width} ${height}" class="chart-svg" role="img" aria-label="${title}">
      ${gridlines}
      <line x1="${marginLeft}" y1="${baselineY}" x2="${width - marginRight}" y2="${baselineY}" class="chart-baseline" />
      ${yTicks}
      ${bars}
      ${xLabels}
    </svg>`;

    return `<div class="chart-block" id="${containerId}" data-unit="${unit}" data-base-label="${baseLabel}" data-extra-label="${extraLabel}">
      <div class="chart-header">
        <h4>${title}</h4>
        <div class="chart-legend">
          <span class="legend-item"><span class="legend-swatch swatch-base"></span>${baseLabel}</span>
          <span class="legend-item"><span class="legend-swatch swatch-extra"></span>${extraLabel}</span>
        </div>
      </div>
      <div class="chart-wrap">
        ${svg}
        <div class="chart-tooltip" hidden></div>
      </div>
    </div>`;
  }

  /**
   * Lijngrafiek: drie rechte lijnen (cumulatief is lineair, want gebaseerd op
   * een vast jaarlijks gemiddelde per bron) tegenover de initiële kost
   * (horizontale referentielijn) — apart voor piekaftopping en zelfverbruik,
   * plus hun gecombineerde totaal-netto (na jaarlijkse kosten). Het snijpunt
   * van die laatste met de kostlijn is exact de terugverdientijd uit de
   * resultatentabel (evaluateBattery in calculators.js).
   * @param {object} opts
   * @param {string} opts.title
   * @param {number} opts.upfrontCost
   * @param {number} opts.peakBenefit jaarlijkse baten uit piekaftopping (capaciteitstarief)
   * @param {number} opts.selfConsumptionBenefit jaarlijkse baten uit extra zelfverbruik
   * @param {number} opts.netAnnualBenefit totaal jaarlijks netto voordeel (na jaarlijkse kosten)
   * @param {number|null} opts.paybackYears
   * @param {boolean} opts.profitable
   * @param {number} [opts.warrantyYears]
   * @param {number} [opts.lifespanYears] fabrikants-opgave levensduur, zie expected_lifespan_years in batteries.json
   */
  function renderPaybackChart(opts) {
    const { title, upfrontCost, peakBenefit, selfConsumptionBenefit, netAnnualBenefit, paybackYears, profitable, warrantyYears, lifespanYears } = opts;
    const containerId = `chart-${nextChartId++}`;

    const width = 720;
    const height = 320;
    const marginLeft = 64;
    const marginRight = 16;
    const marginTop = 16;
    const marginBottom = 34;
    const plotWidth = width - marginLeft - marginRight;
    const plotHeight = height - marginTop - marginBottom;

    const safeWarranty = warrantyYears ?? 0;
    const safeLifespan = lifespanYears ?? 0;
    const horizonYears = BatteryCalculators.computePaybackHorizonYears({ paybackYears, profitable, warrantyYears, lifespanYears });

    const endPeak = peakBenefit * horizonYears;
    const endSelf = selfConsumptionBenefit * horizonYears;
    const endTotal = netAnnualBenefit * horizonYears;
    const yMax = Math.max(upfrontCost, endPeak, endSelf, endTotal, 0) * 1.08 || 1;
    const yMin = Math.min(0, endPeak, endSelf, endTotal) * 1.08;
    const yRange = (yMax - yMin) || 1;

    const xForYear = (y) => marginLeft + (y / horizonYears) * plotWidth;
    const yForValue = (v) => marginTop + plotHeight - ((v - yMin) / yRange) * plotHeight;

    const step = niceStep(yRange);
    let gridlines = '';
    let yTicks = '';
    for (let t = Math.ceil(yMin / step) * step; t <= yMax + 1e-9; t += step) {
      const y = yForValue(t);
      gridlines += `<line x1="${marginLeft}" y1="${y}" x2="${width - marginRight}" y2="${y}" class="chart-gridline" />`;
      yTicks += `<text x="${marginLeft - 8}" y="${y + 4}" class="chart-tick" text-anchor="end">€ ${fmtNumber(t)}</text>`;
    }

    const xTickStep = horizonYears <= 10 ? 1 : horizonYears <= 20 ? 2 : 5;
    let xLabels = '';
    for (let y = 0; y <= horizonYears + 1e-9; y += xTickStep) {
      xLabels += `<text x="${xForYear(y)}" y="${height - marginBottom + 16}" class="chart-tick" text-anchor="middle">${Math.round(y)}</text>`;
    }

    const zeroY = yForValue(0);
    const baseline = `<line x1="${marginLeft}" y1="${zeroY}" x2="${width - marginRight}" y2="${zeroY}" class="chart-baseline" />`;

    const costY = yForValue(upfrontCost);
    const costLine = `<line x1="${xForYear(0)}" y1="${costY}" x2="${xForYear(horizonYears)}" y2="${costY}" class="chart-line-cost" />`;

    const line = (endValue, cssClass) =>
      `<path d="M${xForYear(0)},${yForValue(0)} L${xForYear(horizonYears)},${yForValue(endValue)}" class="${cssClass}" />`;
    const peakLine = line(endPeak, 'chart-line-peak');
    const selfLine = line(endSelf, 'chart-line-self');
    const totalLine = line(endTotal, 'chart-line-total');

    let intersection = '';
    if (profitable && paybackYears <= horizonYears) {
      const ix = xForYear(paybackYears);
      const iy = yForValue(upfrontCost);
      intersection = `
        <line x1="${ix}" y1="${iy}" x2="${ix}" y2="${zeroY}" class="chart-guide" />
        <circle cx="${ix}" cy="${iy}" r="5" class="chart-point-payback" />
        <text x="${ix}" y="${iy - 10}" class="chart-tick" text-anchor="middle">na ${fmtNumber(paybackYears)} jaar</text>
      `;
    }

    // Garantie en verwachte levensduur vallen typisch niet samen (bv. 10 vs.
    // 15 jaar) — apart gelabeld zodat duidelijk is welke grens waar ligt.
    // Label boven voor garantie, onderaan voor levensduur, zodat de tekst
    // niet overlapt als beide dicht bij elkaar liggen.
    let warrantyMarker = '';
    if (safeWarranty > 0 && safeWarranty <= horizonYears) {
      const wx = xForYear(safeWarranty);
      warrantyMarker = `
        <line x1="${wx}" y1="${marginTop}" x2="${wx}" y2="${marginTop + plotHeight}" class="chart-guide-warranty" />
        <text x="${wx}" y="${marginTop + 12}" class="chart-tick" text-anchor="middle">einde garantie (${fmtNumber(safeWarranty)}j)</text>
      `;
    }

    let lifespanMarker = '';
    if (safeLifespan > 0 && safeLifespan <= horizonYears) {
      const lx = xForYear(safeLifespan);
      lifespanMarker = `
        <line x1="${lx}" y1="${marginTop}" x2="${lx}" y2="${marginTop + plotHeight}" class="chart-guide-lifespan" />
        <text x="${lx}" y="${marginTop + plotHeight - 6}" class="chart-tick" text-anchor="middle">verwachte levensduur (${fmtNumber(safeLifespan)}j)</text>
      `;
    }

    const summary = (profitable
      ? `Totaal netto terugverdiend na ${fmtNumber(paybackYears)} jaar. `
      : `Wordt niet terugverdiend binnen de weergegeven ${horizonYears} jaar bij de huidige aannames. `) +
      `Waarvan piekaftopping € ${fmtNumber(peakBenefit)}/jaar en extra zelfverbruik € ${fmtNumber(selfConsumptionBenefit)}/jaar ` +
      `(samen € ${fmtNumber(netAnnualBenefit)}/jaar netto na jaarlijkse kosten).`;

    const svg = `<svg viewBox="0 0 ${width} ${height}" class="chart-svg" role="img" aria-label="${title}">
      ${gridlines}
      ${baseline}
      ${yTicks}
      ${warrantyMarker}
      ${lifespanMarker}
      ${costLine}
      ${peakLine}
      ${selfLine}
      ${totalLine}
      ${intersection}
      ${xLabels}
    </svg>`;

    const warrantyLegend = safeWarranty > 0 && safeWarranty <= horizonYears
      ? `<span class="legend-item"><span class="legend-line legend-line-warranty"></span>Einde garantie</span>`
      : '';
    const lifespanLegend = safeLifespan > 0 && safeLifespan <= horizonYears
      ? `<span class="legend-item"><span class="legend-line legend-line-lifespan"></span>Verwachte levensduur</span>`
      : '';

    return `<div class="chart-block" id="${containerId}">
      <div class="chart-header">
        <h4>${title}</h4>
        <div class="chart-legend">
          <span class="legend-item"><span class="legend-line legend-line-cost"></span>Initiële kost</span>
          <span class="legend-item"><span class="legend-line legend-line-peak"></span>Piekaftopping</span>
          <span class="legend-item"><span class="legend-line legend-line-self"></span>Zelfverbruik</span>
          <span class="legend-item"><span class="legend-line legend-line-total"></span>Totaal netto</span>
          ${warrantyLegend}
          ${lifespanLegend}
        </div>
      </div>
      <div class="chart-wrap">
        ${svg}
      </div>
      <p class="field-hint">${summary}</p>
    </div>`;
  }

  function attachInteractivity(rootEl) {
    rootEl.querySelectorAll('.chart-block').forEach((block) => {
      const unit = block.dataset.unit;
      const baseLabel = block.dataset.baseLabel;
      const extraLabel = block.dataset.extraLabel;
      const wrap = block.querySelector('.chart-wrap');
      const tooltip = block.querySelector('.chart-tooltip');

      block.querySelectorAll('.chart-bar-group').forEach((g) => {
        const show = () => {
          tooltip.innerHTML = '';
          const titleEl = document.createElement('div');
          titleEl.className = 'tooltip-title';
          titleEl.textContent = g.dataset.month;
          tooltip.appendChild(titleEl);

          for (const [label, value] of [[baseLabel, g.dataset.base], [extraLabel, g.dataset.extra]]) {
            const row = document.createElement('div');
            row.className = 'tooltip-row';
            const val = document.createElement('strong');
            val.textContent = `${fmtNumber(value)} ${unit}`;
            const lbl = document.createElement('span');
            lbl.textContent = label;
            row.appendChild(val);
            row.appendChild(lbl);
            tooltip.appendChild(row);
          }

          const totalRow = document.createElement('div');
          totalRow.className = 'tooltip-row tooltip-total';
          totalRow.textContent = `Totaal: ${fmtNumber(g.dataset.total)} ${unit}`;
          tooltip.appendChild(totalRow);

          tooltip.hidden = false;
          g.classList.add('chart-bar-hover');

          const rect = g.getBoundingClientRect();
          const wrapRect = wrap.getBoundingClientRect();
          let left = rect.left - wrapRect.left + rect.width / 2;
          left = Math.max(60, Math.min(wrapRect.width - 60, left));
          tooltip.style.left = `${left}px`;
          tooltip.style.top = `${rect.top - wrapRect.top}px`;
        };
        const hide = () => {
          tooltip.hidden = true;
          g.classList.remove('chart-bar-hover');
        };
        g.addEventListener('pointerenter', show);
        g.addEventListener('pointerleave', hide);
        g.addEventListener('focus', show);
        g.addEventListener('blur', hide);
      });
    });
  }

  return { renderStackedBarChart, renderPaybackChart, attachInteractivity };
})();
