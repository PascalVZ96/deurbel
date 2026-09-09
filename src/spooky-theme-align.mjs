import fs from 'node:fs';

const previousReadFileSync = fs.readFileSync.bind(fs);

const injection = String.raw`
<style id="spooky-theme-align-style">
#spookyMini{
  background:var(--panel)!important;
  border-color:var(--line)!important;
  color:var(--text);
  box-shadow:var(--shadow)!important;
}
#spookyMini .spooky-mini-metric,
#spookyStats .spooky-week-mini,
#spookyStats .spooky-hourly-summary-card,
#spookyStats .spooky-period{
  background:var(--panel2)!important;
  border-color:var(--soft)!important;
}
#spookyMini .spooky-mini-title,
#spookyMini .spooky-mini-value,
#spookyStats .spooky-week-mini b,
#spookyStats .spooky-hourly-summary-card b{
  color:var(--text)!important;
}
#view-spooky .spooky-page-hero{
  background:linear-gradient(145deg,var(--panel2),var(--panel))!important;
  border-color:var(--line)!important;
  box-shadow:var(--shadow);
}
#view-spooky .spooky-page-kicker{color:var(--muted)!important}

html[data-theme="light"] #spookyMini,
html[data-theme="light"] #spookyStats .spooky-stat,
html[data-theme="light"] #spookyStats .spooky-week-card,
html[data-theme="light"] #spookyStats .spooky-insight,
html[data-theme="light"] #spookyStats .spooky-rhythm-card,
html[data-theme="light"] #spookyStats .spooky-hourly,
html[data-theme="light"] #spookyStats .spooky-record-card,
html[data-theme="light"] #spookyStats .spooky-week-summary{
  background:#fff!important;
  border-color:#dbe4ed!important;
  box-shadow:var(--shadow);
}
html[data-theme="light"] #spookyMini .spooky-mini-metric,
html[data-theme="light"] #spookyStats .spooky-week-mini,
html[data-theme="light"] #spookyStats .spooky-hourly-summary-card,
html[data-theme="light"] #spookyStats .spooky-period{
  background:#f7f9fc!important;
  border-color:#e1e8ef!important;
}
html[data-theme="light"] #spookyMini .spooky-mini-title,
html[data-theme="light"] #spookyMini .spooky-mini-value,
html[data-theme="light"] #spookyStats .spooky-stat-value,
html[data-theme="light"] #spookyStats .spooky-insight-value,
html[data-theme="light"] #spookyStats .spooky-rhythm-value,
html[data-theme="light"] #spookyStats .spooky-record-value,
html[data-theme="light"] #spookyStats .spooky-week-summary-title,
html[data-theme="light"] #spookyStats .spooky-week-summary-text,
html[data-theme="light"] #spookyStats .spooky-week-mini b,
html[data-theme="light"] #spookyStats .spooky-hourly-title,
html[data-theme="light"] #spookyStats .spooky-hourly-summary-card b{
  color:#172333!important;
}
html[data-theme="light"] #view-spooky .spooky-page-hero{
  background:linear-gradient(145deg,#edf5fb,#ffffff)!important;
  border-color:#dbe4ed!important;
  box-shadow:var(--shadow);
}
html[data-theme="light"] #view-spooky .spooky-page-kicker{color:#60758a!important}
html[data-theme="light"] #spookyStats .spooky-period button[aria-pressed="true"]{
  background:#dcebf8!important;
  color:#153f63!important;
}
html[data-theme="light"] #spookyStats .spooky-hourly-cell{
  color:#294761!important;
  border-color:#dce5ed!important;
}
html[data-theme="light"] #spookyStats .spooky-hourly-cell.eating{color:#246341!important}
</style>
`;

fs.readFileSync = function spookyThemeAlignReadFileSync(file, options) {
  const data = previousReadFileSync(file, options);
  const normalized = String(file).replaceAll('\\', '/');
  if (!normalized.endsWith('/public/security.html')) return data;

  const encoding = typeof options === 'string' ? options : options?.encoding;
  const returnBuffer = !encoding && Buffer.isBuffer(data);
  let text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);

  if (!text.includes('id="spooky-theme-align-style"')) {
    text = text.replace('</body>', injection + '\n</body>');
  }

  return returnBuffer ? Buffer.from(text, 'utf8') : text;
};
