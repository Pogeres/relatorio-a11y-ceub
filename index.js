/// @ts-check

import { AxePuppeteer } from "@axe-core/puppeteer";
import { createHtmlReport } from "axe-html-reporter";
import lighthouse from "lighthouse";
import fs from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";

if (!process.env.LOGIN) throw new Error("Env 'LOGIN' não informado");
if (!process.env.PASSWORD) throw new Error("Env 'PASSWORD' não informado");

const browser = await puppeteer.launch({
  headless: true,
  browser: "chrome",
  defaultViewport: {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    isMobile: false,
    isLandscape: true,
  },
  args: ["--no-sandbox"],
});
const page = await browser.newPage();

const basePath = "results";
try {
  await fs.rm(basePath, { recursive: true });
  await fs.mkdir(basePath, { recursive: true });
  await fs.access(basePath, fs.constants.R_OK | fs.constants.W_OK);
} catch {
  await fs.mkdir(basePath, { recursive: true });
}

// Criar arquivo CSS
const cssContent = `
:root {
  --primary-color: #0056b3;
  --secondary-color: #6c757d;
  --success-color: #28a745;
  --danger-color: #dc3545;
  --warning-color: #ffc107;
  --info-color: #17a2b8;
  --light-color: #f8f9fa;
  --dark-color: #343a40;
  --white: #ffffff;
}

body {
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  line-height: 1.6;
  color: #333;
  background-color: #f5f7f9;
  margin: 0;
  padding: 20px;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  background-color: var(--white);
  padding: 25px;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

h1, h2, h3 {
  color: var(--primary-color);
}

h1 {
  text-align: center;
  margin-bottom: 30px;
  padding-bottom: 15px;
  border-bottom: 2px solid var(--primary-color);
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 30px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

table, th, td {
  border: 1px solid #ddd;
}

th, td {
  padding: 12px 15px;
  text-align: left;
}

th {
  background-color: var(--primary-color);
  color: var(--white);
  font-weight: 600;
}

tr:nth-child(even) {
  background-color: #f2f2f2;
}

ul {
  padding-left: 20px;
}

li {
  margin-bottom: 10px;
}

a {
  color: var(--primary-color);
  text-decoration: none;
  transition: color 0.2s ease;
}

a:hover {
  color: #003d7a;
  text-decoration: underline;
}

.summary-section {
  background-color: #e9f0f8;
  padding: 20px;
  border-radius: 6px;
  margin-bottom: 30px;
}

.page-list {
  list-style-type: none;
  padding: 0;
}

.page-item {
  background-color: var(--white);
  border: 1px solid #e3e3e3;
  margin-bottom: 15px;
  padding: 15px;
  border-radius: 5px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.analysis {
  margin: 10px 0;
  padding: 10px;
  background-color: #f8f8f8;
  border-left: 4px solid var(--primary-color);
}

.created-date {
  text-align: center;
  color: var(--secondary-color);
  font-style: italic;
  margin-top: 40px;
}

.score-high {
  color: var(--success-color);
  font-weight: bold;
}

.score-medium {
  color: var(--warning-color);
  font-weight: bold;
}

.score-low {
  color: var(--danger-color);
  font-weight: bold;
}

.violation-count {
  font-weight: bold;
}

.critical { color: #d9534f; }
.serious { color: #f0ad4e; }
.moderate { color: #5bc0de; }
.minor { color: #5cb85c; }
`;

await fs.writeFile(path.join(basePath, "styles.css"), cssContent, "utf-8");

/**
 * @type {string[]}
 */
const ulHtml = [];
const axeSummary = { total: 0, critical: 0, serious: 0, moderate: 0, minor: 0 };
/**
 * @type {number[]}
 */
const lhScores = [];

/**
 * @param {string} url
 */
async function report(url) {
  console.log(`[${url}] Carregando...`);

  await page.goto(url);

  console.log(`[${url}] Executando Lighthouse...`);

  const lhResult = await lighthouse(
    url,
    {
      disableStorageReset: true,
      onlyCategories: ["accessibility"],
      formFactor: "desktop",
      screenEmulation: {
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1,
        mobile: false,
      },
      output: "html",
    },
    undefined,
    page
  );
  const lhHtml = lhResult?.report;
  const accessibilityScore = lhResult?.lhr?.categories?.accessibility?.score;
  if (typeof accessibilityScore === "number") lhScores.push(accessibilityScore);

  console.log(`[${url}] Executando Axe...`);

  const axeResult = await new AxePuppeteer(page).analyze();
  axeSummary.total += axeResult.violations.length;
  axeResult.violations.forEach((violation) => {
    if (violation.impact && axeSummary.hasOwnProperty(violation.impact))
      axeSummary[violation.impact]++;
  });
  const axeHtml = createHtmlReport({
    results: axeResult,
    options: {
      doNotCreateReportFile: true,
    },
  });

  console.log(`[${url}] Salvando relatórios...`);

  const title = await page.title();
  const normalizedTitle = title.replace(/[\s+\W]/g, "_");

  /// @ts-ignore
  await fs.writeFile(
    path.join(basePath, `${normalizedTitle}-lighthouse.html`),
    // @ts-ignore
    lhHtml,
    "utf-8"
  );
  await fs.writeFile(
    path.join(basePath, `${normalizedTitle}-axe.html`),
    axeHtml,
    "utf-8"
  );

  // --- Adição do resumo individual com classes CSS ---
  const scoreValue =
    typeof accessibilityScore === "number" ? accessibilityScore * 100 : 0;
  const scoreClass =
    scoreValue >= 90
      ? "score-high"
      : scoreValue >= 70
      ? "score-medium"
      : "score-low";

  const pageLighthouseScore =
    typeof accessibilityScore === "number"
      ? `<span class="${scoreClass}">${(accessibilityScore * 100).toFixed(
          0
        )}%</span>`
      : "-";

  const axeCounts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  axeResult.violations.forEach((v) => {
    if (v.impact && axeCounts.hasOwnProperty(v.impact)) axeCounts[v.impact]++;
  });

  const analysisHtml = `
    <div class="analysis">
      <strong>Análise:</strong>
      <ul>
        <li>Pontuação Lighthouse: ${pageLighthouseScore}</li>
        <li>Violações Axe: <span class="violation-count">${axeResult.violations.length}</span>
          <ul>
            <li>Críticas: <span class="critical">${axeCounts.critical}</span></li>
            <li>Sérias: <span class="serious">${axeCounts.serious}</span></li>
            <li>Moderadas: <span class="moderate">${axeCounts.moderate}</span></li>
            <li>Menores: <span class="minor">${axeCounts.minor}</span></li>
          </ul>
        </li>
      </ul>
    </div>
  `;

  ulHtml.push(`
    <li class="page-item">
      <strong><a href="${url}" target="_blank">${title}</a></strong>
      ${analysisHtml}
      <ul>
        <li><a href="${normalizedTitle}-lighthouse.html" target="_blank">Relatório do Lighthouse</a></li>
        <li><a href="${normalizedTitle}-axe.html" target="_blank">Relatório do Axe</a></li>
      </ul>
    </li>
  `);
}

const pages = [
  "https://salaonline.ceub.br/login/index.php",
  "https://salaonline.ceub.br/my/",
  "https://salaonline.ceub.br/user/profile.php",
  "https://salaonline.ceub.br/grade/report/overview/index.php",
  "https://salaonline.ceub.br/calendar/view.php?view=month",
  "https://salaonline.ceub.br/user/preferences.php",
  "https://salaonline.ceub.br/user/edit.php?id=3041&course=1",
  "https://salaonline.ceub.br/reportbuilder/index.php",
  "https://salaonline.ceub.br/user/files.php",
  "https://salaonline.ceub.br/course/view.php?id=2604",
  "https://salaonline.ceub.br/mod/forum/view.php?id=29262",
  "https://salaonline.ceub.br/mod/forum/discuss.php?d=1643",
  "https://salaonline.ceub.br/course/view.php?id=3380",
  "https://salaonline.ceub.br/course/view.php?id=2398",
  "https://salaonline.ceub.br/course/view.php?id=2769",
  "https://salaonline.ceub.br/course/view.php?id=1866",
];
const loginPage = pages[0];

await page.goto(loginPage);
await report(loginPage);

console.log(`[${loginPage}] Realizando login...`);
await page.locator("#username").fill(process.env.LOGIN);
await page.locator("#password").fill(process.env.PASSWORD);
await page.locator("#loginbtn").click();
await page.waitForNavigation();
const homePage = pages[1];
if (page.url() !== homePage) throw new Error("Erro no login");

for (const url of pages.slice(1)) {
  await report(url);
}

console.log("Gerando index.html...");

const scoreValue =
  lhScores.length > 0
    ? (lhScores.reduce((a, b) => a + b, 0) / lhScores.length) * 100
    : 0;
const scoreClass =
  scoreValue >= 90
    ? "score-high"
    : scoreValue >= 70
    ? "score-medium"
    : "score-low";

const averageLighthouseScore =
  lhScores.length > 0
    ? `<span class="${scoreClass}">${(
        (lhScores.reduce((a, b) => a + b, 0) / lhScores.length) *
        100
      ).toFixed(0)}%</span>`
    : "-";

const summaryHtml = `
  <tr>
    <td rowspan="5">Axe</td>
    <td>Total de violações</td>
    <td><span class="violation-count">${axeSummary.total}</span></td>
  </tr>
  <tr>
    <td>Críticas</td>
    <td><span class="critical">${axeSummary.critical}</span></td>
  </tr>
  <tr>
    <td>Sérias</td>
    <td><span class="serious">${axeSummary.serious}</span></td>
  </tr>
  <tr>
    <td>Moderadas</td>
    <td><span class="moderate">${axeSummary.moderate}</span></td>
  </tr>
  <tr>
    <td>Menores</td>
    <td><span class="minor">${axeSummary.minor}</span></td>
  </tr>
  <tr>
    <td>Lighthouse</td>
    <td>Pontuação média de acessibilidade</td>
    <td>${averageLighthouseScore}</td>
  </tr>
`;

let content = await fs.readFile("index.html", "utf-8");
// Adicionar a referência ao CSS
if (!content.includes('<link rel="stylesheet"')) {
  content = content.replace(
    "</head>",
    '<link rel="stylesheet" href="styles.css">\n</head>'
  );
}
content = content.replace(/{SUMMARY}/g, summaryHtml);
content = content.replace(/{CONTENT}/g, ulHtml.join(""));
content = content.replace(
  /{CREATED}/g,
  `<div class="created-date">${new Date().toLocaleString("pt-br", {
    timeZone: "America/Sao_Paulo",
  })}</div>`
);

// Adicionar classes CSS ao conteúdo principal se necessário
if (!content.includes('class="container"')) {
  content = content.replace("<body>", '<body>\n<div class="container">');
  content = content.replace("</body>", "</div>\n</body>");
}

if (!content.includes('class="page-list"')) {
  content = content.replace("<ul>", '<ul class="page-list">');
}

if (!content.includes('class="summary-section"')) {
  content = content.replace("<table", '<div class="summary-section"><table');
  content = content.replace("</table>", "</table></div>");
}

await fs.writeFile(path.join(basePath, "index.html"), content, {
  encoding: "utf-8",
});

await browser.close();
