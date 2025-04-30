/// @ts-check

import puppeteer from "puppeteer";
import lighthouse from "lighthouse";
import { AxePuppeteer } from "@axe-core/puppeteer";
import { createHtmlReport } from "axe-html-reporter";
import fs from "node:fs/promises";
import path from "node:path";

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
  if (typeof accessibilityScore === 'number') lhScores.push(accessibilityScore);

  console.log(`[${url}] Executando Axe...`);

  const axeResult = await new AxePuppeteer(page).analyze();
  axeSummary.total += axeResult.violations.length;
  axeResult.violations.forEach(violation => {
    if (violation.impact && axeSummary.hasOwnProperty(violation.impact)) axeSummary[violation.impact]++;
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
  await fs.writeFile(path.join(basePath, `${normalizedTitle}-lighthouse.html`), lhHtml, "utf-8");
  await fs.writeFile(path.join(basePath, `${normalizedTitle}-axe.html`), axeHtml, "utf-8");

  ulHtml.push(`
    <li>
      <strong><a href="${url}" target="_blank">${title}</a></strong>
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

const averageLighthouseScore = lhScores.length > 0
  ? (lhScores.reduce((a, b) => a + b, 0) / lhScores.length * 100).toFixed(0) + '%'
  : '-';

const summaryHtml = `
  <tr>
    <td rowspan="5">Axe</td>
    <td>Total de violações</td>
    <td>${axeSummary.total}</td>
  </tr>
  <tr>
    <td>Críticas</td>
    <td>${axeSummary.critical}</td>
  </tr>
  <tr>
    <td>Sérias</td>
    <td>${axeSummary.serious}</td>
  </tr>
  <tr>
    <td>Moderadas</td>
    <td>${axeSummary.moderate}</td>
  </tr>
  <tr>
    <td>Menores</td>
    <td>${axeSummary.minor}</td>
  </tr>
  <tr>
    <td>Lighthouse</td>
    <td>Pontuação média de acessibilidade</td>
    <td>${averageLighthouseScore}</td>
  </tr>
`;

let content = await fs.readFile("index.html", "utf-8");
content = content.replace(/{SUMMARY}/g, summaryHtml);
content = content.replace(/{CONTENT}/g, ulHtml.join(""));
content = content.replace(/{CREATED}/g, new Date().toLocaleString("pt-br", { timeZone: "America/Sao_Paulo" }));
await fs.writeFile(path.join(basePath, "index.html"), content, { encoding: "utf-8" });

await browser.close();
