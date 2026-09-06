const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

// ============================================================
//  Pesquisa Código Fonte TV - Web Scraper (2021 a 2026)
// ============================================================
//
//  O portal é uma aplicação Next.js e embute todos os resultados
//  agregados em <script id="__NEXT_DATA__">, sob props.pageProps.survey.
//  A extração é feita a partir desse JSON, e não por regex sobre o
//  texto renderizado: o JSON traz contagens absolutas, o que elimina
//  ambiguidade de rótulo e garante que os percentuais somem 100%.
//
//  Duas exceções, documentadas nas funções correspondentes: as médias
//  salariais publicadas são calculadas pelo próprio site a partir da
//  distribuição por faixa, e são reproduzidas aqui pela mesma fórmula.
// ============================================================

const URLS = [
  { ano: 2021, url: "https://pesquisa.codigofonte.com.br/2021" },
  { ano: 2022, url: "https://pesquisa.codigofonte.com.br/2022" },
  { ano: 2023, url: "https://pesquisa.codigofonte.com.br/2023" },
  { ano: 2024, url: "https://pesquisa.codigofonte.com.br/2024" },
  { ano: 2025, url: "https://pesquisa.codigofonte.com.br/2025" },
  { ano: 2026, url: "https://pesquisa.codigofonte.com.br/2026" },
];

// Delay entre requisições para ser gentil com o servidor
const DELAY_MS = 1500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================
//  Acesso ao blob de dados da página
// ============================================================

/**
 * Devolve props.pageProps.survey do __NEXT_DATA__ da página.
 * Lança se o bloco não existir: é melhor falhar alto do que gravar
 * um JSON silenciosamente vazio, como acontecia na versão por regex.
 */
function extrairSurvey($) {
  const raw = $("#__NEXT_DATA__").html();
  if (!raw) throw new Error("__NEXT_DATA__ não encontrado na página");
  const props = JSON.parse(raw).props?.pageProps;
  if (!props?.survey) throw new Error("props.pageProps.survey ausente");
  return props.survey;
}

// ============================================================
//  Helpers
// ============================================================

/**
 * Converte um objeto de contagens em percentuais sobre o total de
 * respostas à própria pergunta, com duas casas. Some sempre 100%.
 */
function percentuais(contagens) {
  if (!contagens) return {};
  const total = Object.values(contagens).reduce((a, b) => a + b, 0);
  if (!total) return {};
  const out = {};
  for (const [k, v] of Object.entries(contagens)) {
    out[k] = Math.round((v / total) * 10000) / 100;
  }
  return out;
}

/**
 * Ponto médio de uma faixa salarial, na convenção usada pelo site.
 *
 * "Entre 3.001 e 4.000" -> 3500,5 ; "Ate 1.000"/"Menos de 1.000" -> 500.
 * A faixa aberta do topo varia por edição: 2021 usa "Acima de 20.000"
 * e as demais "Acima de 50.000". Os valores abaixo foram obtidos por
 * ajuste às médias publicadas: reproduzem 2022--2026 ao centavo e 2021
 * com diferença máxima de R$ 1,73 (0,06%), resíduo da faixa aberta.
 */
const TOPO_FAIXA_ABERTA = { 20000: 25000, 50000: 60000 };

function pontoMedio(rotulo) {
  const faixa = rotulo.match(/Entre ([\d.]+) e ([\d.]+)/);
  if (faixa) {
    const lo = parseFloat(faixa[1].replace(/\./g, ""));
    const hi = parseFloat(faixa[2].replace(/\./g, ""));
    return (lo + hi) / 2;
  }
  if (/^(At[eé]|Menos de)/i.test(rotulo)) return 500;
  const acima = rotulo.match(/Acima de ([\d.]+)/i);
  if (acima) {
    const base = parseFloat(acima[1].replace(/\./g, ""));
    return TOPO_FAIXA_ABERTA[base] ?? base * 1.2;
  }
  return null;
}

/**
 * Média ponderada por coluna de uma matriz {columns, index, data},
 * em que index são faixas salariais e data[i][j] a contagem.
 */
function mediasPorColuna(matriz) {
  const out = {};
  if (!matriz?.columns || !matriz?.index || !matriz?.data) return out;
  matriz.columns.forEach((coluna, j) => {
    let soma = 0;
    let n = 0;
    matriz.index.forEach((rotulo, i) => {
      const c = matriz.data[i]?.[j] || 0;
      const mp = pontoMedio(rotulo);
      if (mp === null) return;
      soma += c * mp;
      n += c;
    });
    if (n) out[coluna] = Math.round((soma / n) * 100) / 100;
  });
  return out;
}

/**
 * Monta um ranking [{posicao, <campo>, mediaSalarial, participantes}]
 * ordenado por número de participantes.
 */
function ranking(matrizSalario, contagens, campo) {
  const medias = mediasPorColuna(matrizSalario);
  const nomes = contagens ? Object.keys(contagens) : Object.keys(medias);
  return nomes
    .map((nome) => ({
      nome,
      mediaSalarial: medias[nome] ?? null,
      participantes: contagens?.[nome] ?? null,
    }))
    .filter((r) => r.participantes !== null || r.mediaSalarial !== null)
    .sort((a, b) => (b.participantes || 0) - (a.participantes || 0))
    .map((r, i) => ({
      posicao: i + 1,
      [campo]: r.nome,
      mediaSalarial: r.mediaSalarial,
      participantes: r.participantes,
    }));
}

/**
 * Percentuais das N categorias mais citadas, normalizados entre elas.
 * É a convenção do próprio site no gráfico de ferramentas de IA: o
 * denominador é a soma do top N, não o total de respondentes.
 */
function percentuaisTopN(contagens, n) {
  if (!contagens) return null;
  const top = Object.entries(contagens)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
  const total = top.reduce((a, [, v]) => a + v, 0);
  if (!total) return null;
  const out = {};
  top.forEach(([k, v], i) => {
    out[k] = { posicao: i + 1, percentual: Math.round((v / total) * 10000) / 100, respostas: v };
  });
  return out;
}

/** Soma as chaves de `contagens` cujo rótulo casa com `re`. */
function somaOnde(contagens, re) {
  if (!contagens) return null;
  let soma = 0;
  let total = 0;
  for (const [k, v] of Object.entries(contagens)) {
    total += v;
    if (re.test(k)) soma += v;
  }
  return total ? Math.round((soma / total) * 10000) / 100 : null;
}

/**
 * Médias publicadas que aparecem no texto renderizado.
 *
 * As edições até 2023 imprimem as médias no HTML servido; de 2024 em
 * diante o site as calcula no navegador. Onde o valor publicado existe
 * no texto ele tem precedência sobre o cálculo, para que o JSON reproduza
 * exatamente o número divulgado pela pesquisa. Onde não existe, o cálculo
 * de mediasPorColuna reproduz o publicado ao centavo (verificado para
 * 2022--2026).
 */
function mediasDoTexto(texto, regex) {
  const out = {};
  let m;
  while ((m = regex.exec(texto)) !== null) {
    const chave = m[1];
    if (out[chave] !== undefined) continue; // primeira ocorrência vence
    const v = parseFloat(m[2].replace(/\./g, "").replace(",", "."));
    if (!isNaN(v)) out[chave] = v;
  }
  return out;
}

/** Combina publicado (precedência) com calculado (cobertura). */
function preferirPublicado(publicado, calculado) {
  return { ...calculado, ...publicado };
}

// ============================================================
//  Extração por seção
// ============================================================

function extrairParticipantes(sv) {
  const t = sv.total_responses?.total;
  return { total: t ? Object.values(t)[0] : null };
}

function extrairMediaSalarialPorNivel(sv, texto) {
  return preferirPublicado(
    mediasDoTexto(
      texto,
      // "Outro" fica de fora de proposito: o mesmo rotulo aparece na secao
      // CLT vs PJ e contaminaria o nivel. Para ele vale o valor calculado.
      /(Estágio|Júnior|Pleno|Sênior)\s*R\$\s*([\d.]+,\d{2})/g,
    ),
    mediasPorColuna(sv.salary_by_level),
  );
}

function extrairProgramadoresPorNivel(sv) {
  return percentuais(sv.total_by_level);
}

function extrairModeloTrabalho(sv) {
  // A edição de 2021 não publicou essa variável.
  return percentuais(sv.total_work_model_location);
}

function extrairCLTvsPJ(sv, texto) {
  const publicado = preferirPublicado(
    mediasDoTexto(texto, /Média Salarial (CLT|PJ)\s*:?\s*R\$\s*([\d.]+,\d{2})/g),
    mediasDoTexto(texto, /(CLT|PJ)\s+R\$\s*([\d.]+,\d{2})/g),
  );
  return preferirPublicado(publicado, mediasPorColuna(sv.salary_by_work_model));
}

function extrairGenero(sv) {
  return percentuais(sv.total_by_gender);
}

function extrairIdadeProgramadores(sv) {
  return percentuais(sv.total_by_age);
}

function extrairSalarioPorIdade(sv, texto) {
  return preferirPublicado(
    mediasDoTexto(
      texto,
      /(de \d+ a \d+ anos|a partir de \d+ anos)\s*R\$\s*([\d.]+,\d{2})/g,
    ),
    mediasPorColuna(sv.salary_by_age),
  );
}

function extrairTransicaoCarreira(sv) {
  return percentuais(sv.total_career_transition);
}

function extrairSatisfacao(sv) {
  // A edição de 2022 grava a chave com erro de digitação ("Muito safisfeito");
  // como o percentual vem da contagem, o rótulo é normalizado aqui.
  const bruto = sv.total_income_goals_satisfaction;
  if (!bruto) return {};
  const corrigido = {};
  for (const [k, v] of Object.entries(bruto)) {
    corrigido[k.replace(/safisfeito/i, "satisfeito")] = v;
  }
  return percentuais(corrigido);
}

function extrairFormacaoEducacional(sv) {
  return percentuais(sv.total_by_graduation);
}

function extrairLinguagens(sv) {
  return ranking(sv.salary_by_languages, sv.total_by_languages, "nome");
}

function extrairFrameworks(sv) {
  return ranking(sv.salary_by_frameworks, sv.total_by_frameworks, "nome");
}

function extrairEstadosBR(sv, texto) {
  const publicado = mediasDoTexto(
    texto,
    /([A-Za-zÀ-ú][A-Za-zÀ-ú\s'.-]{2,30}\([A-Z]{2}\))\s*R\$\s*([\d.]+,\d{2})/g,
  );
  const lista = ranking(sv.salary_by_brazil_uf, sv.total_by_brazil_uf, "estado");
  for (const item of lista) {
    const v = publicado[item.estado.trim()];
    if (v !== undefined) item.mediaSalarial = v;
  }
  return lista;
}

function extrairPaisesExterior(sv) {
  return ranking(sv.salary_by_foreign_countries, sv.total_by_foreign_countries, "pais");
}

/**
 * Seção de inteligência artificial, ausente até 2023.
 * Os quatro indicadores agregados usados no artigo mais o ranking de
 * ferramentas. Sem isso a Tabela de IA não era reproduzível a partir
 * deste coletor.
 */
/**
 * Sintomas de saúde mental autorrelatados. A pesquisa publica cada um
 * como uma pergunta Sim/Não independente, e não como uma distribuição.
 */
function extrairSaudeMental(sv) {
  const out = {};
  for (const chave of Object.keys(sv)) {
    const m = chave.match(/^total_by_disease_(.+)$/);
    if (!m) continue;
    const nome = m[1].replace(/_/g, " ");
    out[nome] = somaOnde(sv[chave], /^sim$/i);
  }
  return Object.keys(out).length ? out : null;
}

function extrairIA(sv) {
  const ia = {
    utiliza: somaOnde(sv.total_by_ia_user, /^sim/i),
    ganhoProdutividade: somaOnde(sv.total_by_ia_yield, /^sim/i),
    confiaQualidade: somaOnde(sv.total_by_ia_assurance, /^sim/i),
    acreditaSubstituicao: somaOnde(sv.total_by_ia_take_over, /^sim/i),
    ferramentas: percentuaisTopN(sv.total_by_ia_tool, 10),
  };
  return Object.values(ia).every((v) => v === null) ? null : ia;
}

// ============================================================
//  Coleta
// ============================================================

async function scrapePagina(url, ano) {
  console.log(`\n🔍 Buscando dados de ${ano}... (${url})`);

  const { data: html } = await axios.get(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "text/html",
    },
    timeout: 60000,
  });

  const $ = cheerio.load(html);
  const sv = extrairSurvey($);
  $("script").remove();
  const texto = $("body").text().replace(/\s+/g, " ");

  const dados = {
    ano,
    url,
    coletadoEm: new Date().toISOString(),
    participantes: extrairParticipantes(sv),
    mediaSalarialPorNivel: extrairMediaSalarialPorNivel(sv, texto),
    programadoresPorNivel: extrairProgramadoresPorNivel(sv),
    modeloTrabalho: extrairModeloTrabalho(sv),
    contratacao: extrairCLTvsPJ(sv, texto),
    genero: extrairGenero(sv),
    idadeProgramadores: extrairIdadeProgramadores(sv),
    salarioPorIdade: extrairSalarioPorIdade(sv, texto),
    transicaoCarreira: extrairTransicaoCarreira(sv),
    satisfacao: extrairSatisfacao(sv),
    formacaoEducacional: extrairFormacaoEducacional(sv),
    ia: extrairIA(sv),
    saudeMental: extrairSaudeMental(sv),
    linguagens: extrairLinguagens(sv),
    frameworks: extrairFrameworks(sv),
    estados: extrairEstadosBR(sv, texto),
    paisesExterior: extrairPaisesExterior(sv),
  };

  const preenchidas = Object.entries(dados).filter(
    ([, v]) =>
      v !== null &&
      v !== undefined &&
      (typeof v !== "object" ||
        (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0)),
  ).length;

  console.log(`  ✅ ${ano}: ${preenchidas} seções extraídas`);
  return dados;
}

/**
 * Verificações que falham alto se a página mudar de forma.
 * Sem isso, uma mudança de rótulo volta a produzir JSON plausível e errado.
 */
function conferir(dados) {
  const avisos = [];
  const somaCem = (obj, nome) => {
    if (!obj || !Object.keys(obj).length) return;
    const s = Object.values(obj).reduce((a, b) => a + b, 0);
    if (Math.abs(s - 100) > 0.5) avisos.push(`${nome} soma ${s.toFixed(2)}%`);
  };
  somaCem(dados.programadoresPorNivel, "programadoresPorNivel");
  somaCem(dados.satisfacao, "satisfacao");
  somaCem(dados.genero, "genero");
  somaCem(dados.modeloTrabalho, "modeloTrabalho");
  somaCem(dados.formacaoEducacional, "formacaoEducacional");
  somaCem(dados.idadeProgramadores, "idadeProgramadores");
  if (!dados.participantes.total) avisos.push("participantes.total ausente");
  return avisos;
}

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  🚀 Pesquisa Código Fonte TV - Web Scraper");
  console.log("  📅 Edições: 2021 a 2026");
  console.log("═══════════════════════════════════════════════════════");

  const resultados = [];

  for (const { ano, url } of URLS) {
    try {
      const dados = await scrapePagina(url, ano);
      const avisos = conferir(dados);
      for (const a of avisos) console.warn(`  ⚠️  ${ano}: ${a}`);
      resultados.push(dados);
      await sleep(DELAY_MS);
    } catch (error) {
      console.error(`  ❌ Erro ao buscar ${ano}: ${error.message}`);
    }
  }

  const outputDir = path.join(__dirname, "dados");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  for (const dados of resultados) {
    const filePath = path.join(outputDir, `pesquisa_${dados.ano}.json`);
    fs.writeFileSync(filePath, JSON.stringify(dados, null, 2), "utf-8");
    console.log(`\n📄 Salvo: ${filePath}`);
  }

  const allPath = path.join(outputDir, "pesquisa_todos_anos.json");
  fs.writeFileSync(allPath, JSON.stringify(resultados, null, 2), "utf-8");
  console.log(`📄 Salvo: ${allPath}`);

  gerarRelatorioConsole(resultados);
  return resultados;
}

// ============================================================
//  Relatório console
// ============================================================

function brl(v) {
  return v == null
    ? "N/A"
    : `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

function gerarRelatorioConsole(resultados) {
  console.log("\n\n═══════════════════════════════════════════════════════");
  console.log("  📊 RELATÓRIO COMPARATIVO (2021-2026)");
  console.log("═══════════════════════════════════════════════════════");

  console.log("\n📌 PARTICIPANTES POR ANO:");
  console.log("─".repeat(40));
  for (const r of resultados) {
    const t = r.participantes?.total;
    console.log(`  ${r.ano}: ${t ? t.toLocaleString("pt-BR") : "N/A"}`);
  }

  console.log("\n💰 MÉDIA SALARIAL POR NÍVEL:");
  console.log("─".repeat(60));
  for (const nivel of ["Estágio", "Júnior", "Pleno", "Sênior"]) {
    console.log(`\n  ${nivel}:`);
    for (const r of resultados) {
      const v = r.mediaSalarialPorNivel?.[nivel];
      if (v) console.log(`    ${r.ano}: ${brl(v)}`);
    }
  }

  console.log("\n\n📋 CLT vs PJ:");
  console.log("─".repeat(60));
  for (const r of resultados) {
    const { CLT, PJ } = r.contratacao || {};
    if (CLT && PJ) {
      const premio = (((PJ - CLT) / CLT) * 100).toFixed(1);
      console.log(`  ${r.ano}: CLT ${brl(CLT)} | PJ ${brl(PJ)} | prêmio +${premio}%`);
    }
  }

  console.log("\n\n🏠 MODELO DE TRABALHO (%):");
  console.log("─".repeat(60));
  for (const r of resultados) {
    const m = r.modeloTrabalho || {};
    if (Object.keys(m).length) {
      console.log(
        `  ${r.ano}: Remoto ${m["Remoto"]} | Híbrido ${m["Híbrido"]} | Presencial ${m["Presencial"]}`,
      );
    }
  }

  console.log("\n\n🤖 INTELIGÊNCIA ARTIFICIAL (%):");
  console.log("─".repeat(60));
  for (const r of resultados) {
    if (!r.ia) continue;
    console.log(
      `  ${r.ano}: usa ${r.ia.utiliza} | produtividade ${r.ia.ganhoProdutividade} | confia ${r.ia.confiaQualidade} | substituição ${r.ia.acreditaSubstituicao}`,
    );
  }
  console.log();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = {
  extrairSurvey,
  percentuais,
  pontoMedio,
  mediasPorColuna,
  ranking,
  somaOnde,
  percentuaisTopN,
  mediasDoTexto,
  extrairIA,
  conferir,
  scrapePagina,
  main,
};
