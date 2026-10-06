// Sincroniza a daily: pra cada item com link de issue do GitHub, checa se ja fechou.
// Se fechou, tira da lista onde estava e bota em "feito", com a data de hoje.
// So mexe no que e 100% mecanico (estado aberto/fechado). Nao inventa prioridade nem organiza nada.

const fs = require("fs");

const TOKEN = process.env.GH_TOKEN;
const FILE = "index.html";

const CARD_KEYS = ["hojeManual", "hoje", "amanha", "proximos", "vencendo", "duranteFerias", "atrasados", "novidades"];

function extrairIssueInfo(url) {
  if (!url) return null;
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: m[3] };
}

async function issueFechada(url, cache) {
  const info = extrairIssueInfo(url);
  if (!info) return null;
  const key = `${info.owner}/${info.repo}#${info.number}`;
  if (cache.has(key)) return cache.get(key);
  const api = `https://api.github.com/repos/${info.owner}/${info.repo}/issues/${info.number}`;
  const resp = await fetch(api, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "daily-manu-theo-sync",
    },
  });
  if (!resp.ok) { cache.set(key, null); return null; }
  const data = await resp.json();
  const fechada = data.state === "closed";
  cache.set(key, fechada);
  return fechada;
}

function hojeFmt() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

function extrairDados(html) {
  const marker = "const DADOS = {";
  const start = html.indexOf(marker);
  if (start === -1) throw new Error("DADOS nao encontrado");
  let depth = 0;
  let i = start + "const DADOS = ".length;
  for (; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  const raw = html.slice(start + "const DADOS = ".length, i);
  return { data: JSON.parse(raw), start, end: i };
}

function reinserirDados(html, start, end, data) {
  const novoBloco = "const DADOS = " + JSON.stringify(data, null, 1) + ";";
  return html.slice(0, start) + novoBloco + html.slice(end);
}

async function main() {
  if (!TOKEN) { console.log("sem GH_TOKEN, abortando"); return; }
  const html = fs.readFileSync(FILE, "utf8");
  const { data, start, end } = extrairDados(html);

  const cache = new Map();
  let mudou = false;
  const feitoNovos = [];
  const feitoExistentesUrls = new Set((data.feito || []).map((f) => f.u));

  for (const key of CARD_KEYS) {
    const lista = data[key];
    if (!Array.isArray(lista) || !lista.length) continue;
    const mantidos = [];
    for (const item of lista) {
      const fechada = item.u ? await issueFechada(item.u, cache) : null;
      if (fechada && !feitoExistentesUrls.has(item.u)) {
        feitoNovos.push({ d: hojeFmt(), t: item.t, c: item.c || "", u: item.u || "" });
        feitoExistentesUrls.add(item.u);
        mudou = true;
      } else {
        mantidos.push(item);
      }
    }
    data[key] = mantidos;
  }

  // checks: blocos com itens, mesma logica
  if (Array.isArray(data.checks)) {
    for (const bloco of data.checks) {
      if (!Array.isArray(bloco.itens)) continue;
      const mantidos = [];
      for (const item of bloco.itens) {
        const fechada = item.u ? await issueFechada(item.u, cache) : null;
        if (fechada) { mudou = true; }
        else { mantidos.push(item); }
      }
      bloco.itens = mantidos;
    }
    data.checks = data.checks.filter((b) => b.itens.length > 0);
    data.resumo.checks = data.checks.reduce((acc, b) => acc + b.itens.length, 0);
  }

  if (!mudou) { console.log("nada fechou, sem mudancas"); return; }

  data.feito = [...feitoNovos, ...(data.feito || [])];

  const novoHtml = reinserirDados(html, start, end, data);
  fs.writeFileSync(FILE, novoHtml, "utf8");
  console.log(`sincronizado: ${feitoNovos.length} item(ns) movido(s) pra feito`);
}

main().catch((e) => { console.error(e); process.exit(1); });
