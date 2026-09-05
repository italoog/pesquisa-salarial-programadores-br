const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

// ============================================================
//  Pesquisa Código Fonte TV - Web Scraper (2021 a 2026)
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
//  Helpers de parsing
// ============================================================

/**
 * Extrai valor monetário "R$ 1.234,56" → 1234.56
 */
function parseMoneyBR(text) {
  if (!text) return null;
  const clean = text
    .replace(/R\$\s*/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim();
  const num = parseFloat(clean);
  return isNaN(num) ? null : num;
}

/**
 * Extrai percentual "43.8%" → 43.8
 */
function parsePercent(text) {
  if (!text) return null;
  const match = text.match(/([\d.,]+)\s*%/);
  if (!match) return null;
  return parseFloat(match[1].replace(",", "."));
}

/**
 * Extrai número inteiro de participantes "12510" ou "12.510"
 */
function parseParticipantes(text) {
  if (!text) return null;
  const match = text.match(
    /([\d.]+)\s*(?:profissionais|programadores|participantes)/i,
  );
  if (!match) return null;
  return parseInt(match[1].replace(/\./g, ""), 10);
}

// ============================================================
//  Extração de dados por seção
// ============================================================

function extrairParticipantes($) {
  const bodyText = $("body").text();
  const total = parseParticipantes(bodyText);
  return { total };
}

function extrairMediaSalarialPorNivel($) {
  const niveis = {};
  const bodyText = $("body").text();

  const patterns = [
    { nome: "Estágio", regex: /Estágio\s*R\$\s*([\d.,]+)/i },
    { nome: "Júnior", regex: /Júnior\s*R\$\s*([\d.,]+)/i },
    { nome: "Pleno", regex: /Pleno\s*R\$\s*([\d.,]+)/i },
    { nome: "Sênior", regex: /Sênior\s*R\$\s*([\d.,]+)/i },
    { nome: "Especialista", regex: /Especialista\s*(?:\/\s*Tech\s*Lead\s*\/\s*Principal\s*)?R\$\s*([\d.,]+)/i },
    { nome: "Outro", regex: /Outro\s*(?:\(.*?\))?\s*R\$\s*([\d.,]+)/i },
  ];

  for (const { nome, regex } of patterns) {
    const match = bodyText.match(regex);
    if (match) {
      niveis[nome] = parseMoneyBR(`R$ ${match[1]}`);
    }
  }

  return niveis;
}

function extrairProgramadoresPorNivel($) {
  const result = {};
  const bodyText = $("body").text();

  const patterns = [
    { nome: "Pleno", regex: /Pleno\s*\(([\d.,]+)%\)/i },
    { nome: "Júnior", regex: /Júnior\s*\(([\d.,]+)%\)/i },
    { nome: "Sênior", regex: /Sênior\s*\(([\d.,]+)%\)/i },
    { nome: "Estágio", regex: /Estágio\s*\(([\d.,]+)%\)/i },
    { nome: "Especialista", regex: /Especialista\s*(?:\/\s*Tech\s*Lead\s*\/\s*Principal\s*)?\s*\(([\d.,]+)%\)/i },
    { nome: "Outro", regex: /Outro\s*(?:\(.*?\))?\s*\(([\d.,]+)%\)/i },
  ];

  for (const { nome, regex } of patterns) {
    const match = bodyText.match(regex);
    if (match) {
      result[nome] = parseFloat(match[1].replace(",", "."));
    }
  }

  return result;
}

function extrairModeloTrabalho($) {
  const bodyText = $("body").text();
  const result = {};

  // Remoto / Híbrido / Presencial (modalidade atual)
  const remotoMatch = bodyText.match(/Remoto\s*\(([\d.,]+)%\)/i);
  const hibridoMatch = bodyText.match(/Híbrido\s*\(([\d.,]+)%\)/i);
  const presencialMatch = bodyText.match(/Presencial\s*\(([\d.,]+)%\)/i);

  if (remotoMatch) result.remoto = parseFloat(remotoMatch[1].replace(",", "."));
  if (hibridoMatch)
    result.hibrido = parseFloat(hibridoMatch[1].replace(",", "."));
  if (presencialMatch)
    result.presencial = parseFloat(presencialMatch[1].replace(",", "."));

  return result;
}

function extrairCLTvsPJ($) {
  const bodyText = $("body").text();
  const result = {};

  const cltMatch = bodyText.match(/CLT\s*R\$\s*([\d.,]+)/i);
  const pjMatch = bodyText.match(/PJ\s*R\$\s*([\d.,]+)/i);

  if (cltMatch) result.CLT = parseMoneyBR(`R$ ${cltMatch[1]}`);
  if (pjMatch) result.PJ = parseMoneyBR(`R$ ${pjMatch[1]}`);

  return result;
}

function extrairGenero($) {
  const bodyText = $("body").text();
  const result = {};

  const mascMatch = bodyText.match(/([\d.,]+)%\s*dos participantes/gi);
  // Pega os padrões de gênero - masculino é tipicamente ~90%+
  const allPercents = [];
  const regex = /([\d.,]+)%\s*dos participantes/gi;
  let m;
  while ((m = regex.exec(bodyText)) !== null) {
    allPercents.push(parseFloat(m[1].replace(",", ".")));
  }

  // Geralmente Masculino vem primeiro com valor alto, Feminino segundo com valor menor
  if (allPercents.length >= 2) {
    const sorted = [...allPercents].sort((a, b) => b - a);
    result.masculino = sorted.find((v) => v > 80) || sorted[0];
    result.feminino = sorted.find((v) => v > 3 && v < 20) || sorted[1];
  }

  return result;
}

function extrairIdadeProgramadores($) {
  const bodyText = $("body").text();
  const result = {};

  const faixas = [
    { nome: "13-17", regex: /de 13 a 17 anos\s*\(([\d.,]+)%\)/i },
    { nome: "18-24", regex: /de 18 a 24 anos\s*\(([\d.,]+)%\)/i },
    { nome: "25-34", regex: /de 25 a 34 anos\s*\(([\d.,]+)%\)/i },
    { nome: "35-44", regex: /de 35 a 44 anos\s*\(([\d.,]+)%\)/i },
    { nome: "45-54", regex: /de 45 a 54 anos\s*\(([\d.,]+)%\)/i },
    { nome: "55-64", regex: /de 55 a 64 anos\s*\(([\d.,]+)%\)/i },
    { nome: "65+", regex: /a partir de 65 anos\s*\(([\d.,]+)%\)/i },
  ];

  for (const { nome, regex } of faixas) {
    const match = bodyText.match(regex);
    if (match) {
      result[nome] = parseFloat(match[1].replace(",", "."));
    }
  }

  return result;
}

function extrairSalarioPorIdade($) {
  const bodyText = $("body").text();
  const result = {};

  const faixas = [
    { nome: "13-17", regex: /de 13 a 17 anos\s*R\$\s*([\d.,]+)/i },
    { nome: "18-24", regex: /de 18 a 24 anos\s*R\$\s*([\d.,]+)/i },
    { nome: "25-34", regex: /de 25 a 34 anos\s*R\$\s*([\d.,]+)/i },
    { nome: "35-44", regex: /de 35 a 44 anos\s*R\$\s*([\d.,]+)/i },
    { nome: "45-54", regex: /de 45 a 54 anos\s*R\$\s*([\d.,]+)/i },
    { nome: "55-64", regex: /de 55 a 64 anos\s*R\$\s*([\d.,]+)/i },
    { nome: "65+", regex: /a partir de 65 anos\s*R\$\s*([\d.,]+)/i },
  ];

  for (const { nome, regex } of faixas) {
    const match = bodyText.match(regex);
    if (match) {
      result[nome] = parseMoneyBR(`R$ ${match[1]}`);
    }
  }

  return result;
}

function extrairTransicaoCarreira($) {
  const bodyText = $("body").text();
  const match = bodyText.match(
    /Sim,?\s*fiz transição de carreira\s*\(([\d.,]+)%\)/i,
  );
  return match ? parseFloat(match[1].replace(",", ".")) : null;
}

function extrairSatisfacao($) {
  const bodyText = $("body").text();
  const result = {};

  const patterns = [
    { nome: "Satisfeito", regex: /Satisfeito\s*\(([\d.,]+)%\)/i },
    {
      nome: "Insatisfeito",
      regex: /(?<!Muito\s)Insatisfeito\s*\(([\d.,]+)%\)/i,
    },
    { nome: "Muito satisfeito", regex: /Muito satisfeito\s*\(([\d.,]+)%\)/i },
    {
      nome: "Muito insatisfeito",
      regex: /Muito insatisfeito\s*\(([\d.,]+)%\)/i,
    },
    { nome: "Indiferente", regex: /Indiferente\s*\(([\d.,]+)%\)/i },
  ];

  for (const { nome, regex } of patterns) {
    const match = bodyText.match(regex);
    if (match) {
      result[nome] = parseFloat(match[1].replace(",", "."));
    }
  }

  return result;
}

function extrairFormacaoEducacional($) {
  const bodyText = $("body").text();
  const result = {};

  const patterns = [
    { nome: "Superior completo", regex: /Superior completo\s*\(([\d.,]+)%\)/i },
    {
      nome: "Superior em andamento",
      regex: /Superior em andamento\s*\(([\d.,]+)%\)/i,
    },
    {
      nome: "Pós-graduação / MBA",
      regex: /Pós-graduação\s*\/?\s*MBA\s*\(([\d.,]+)%\)/i,
    },
    {
      nome: "Superior incompleto",
      regex: /Superior incompleto\s*\(([\d.,]+)%\)/i,
    },
    { nome: "Não fiz faculdade", regex: /Não fiz faculdade\s*\(([\d.,]+)%\)/i },
    {
      nome: "Mestrado / Doutorado",
      regex: /Mestrado\s*\/?\s*Doutorado\s*\(([\d.,]+)%\)/i,
    },
  ];

  for (const { nome, regex } of patterns) {
    const match = bodyText.match(regex);
    if (match) {
      result[nome] = parseFloat(match[1].replace(",", "."));
    }
  }

  return result;
}

function extrairLinguagens($) {
  const bodyText = $("body").text();
  const result = [];

  // Padrão: "01ºJavaScript🠕R$ 8.896,381628 participantes" ou "01ºJAVASCRIPTR$ 4.875,763408 participantes"
  const regex =
    /(\d{2})º([A-Za-zÀ-ÿ#.+\-\s()]+?)(?:🠕|🠗)?R\$\s*([\d.,]+?)([\d.,]+)\s*participantes/gi;
  let match;

  while ((match = regex.exec(bodyText)) !== null) {
    const posicao = parseInt(match[1], 10);
    const nome = match[2].trim();
    // Precisamos separar o valor do salário do número de participantes
    const salarioStr = match[3];
    const partStr = match[4];

    result.push({
      posicao,
      nome,
      mediaSalarial: parseMoneyBR(`R$ ${salarioStr}`),
      participantes: parseInt(partStr.replace(/\./g, ""), 10),
    });
  }

  return result;
}

function extrairLinguagensV2($) {
  const bodyText = $("body").text();
  const linguagens = [];

  // Vamos tentar extrair os rankings de linguagens
  // Padrão mais robusto
  const secaoLinguagens = bodyText.split(/Média salarial por Linguagens/i)[1];
  if (!secaoLinguagens) return linguagens;

  // Corta até a próxima seção
  const secao =
    secaoLinguagens.split(/Média salarial por Frameworks/i)[0] ||
    secaoLinguagens;

  // Tenta extrair padrões do tipo: "01ºJavaR$ 10.735,792091 participantes"
  const regex =
    /(\d{1,2})º\s*([A-Za-zÀ-ÿ#.+\-\s/()]+?)\s*(?:🠕|🠗)?\s*R\$\s*([\d.,]+?)\s*(\d+)\s*participantes/gi;
  let m;

  while ((m = regex.exec(secao)) !== null) {
    linguagens.push({
      posicao: parseInt(m[1], 10),
      nome: m[2].trim(),
      mediaSalarial: parseMoneyBR(`R$ ${m[3]}`),
      participantes: parseInt(m[4].replace(/\./g, ""), 10),
    });
  }

  return linguagens;
}

function extrairFrameworks($) {
  const bodyText = $("body").text();
  const frameworks = [];

  const secaoFw = bodyText.split(/Média salarial por Frameworks/i)[1];
  if (!secaoFw) return frameworks;

  const regex =
    /(\d{1,2})º\s*([A-Za-zÀ-ÿ#.+\-\s/()]+?)\s*(?:🠕|🠗)?\s*R\$\s*([\d.,]+?)\s*(\d+)\s*participantes/gi;
  let m;

  while ((m = regex.exec(secaoFw)) !== null) {
    frameworks.push({
      posicao: parseInt(m[1], 10),
      nome: m[2].trim(),
      mediaSalarial: parseMoneyBR(`R$ ${m[3]}`),
      participantes: parseInt(m[4].replace(/\./g, ""), 10),
    });
  }

  return frameworks;
}

function extrairEstadosBR($) {
  const bodyText = $("body").text();
  const estados = [];

  const secaoEstados = bodyText.split(/Média salarial por estado/i)[1];
  if (!secaoEstados) {
    // 2021 usa "por regiões"
    const secao2 = bodyText.split(/Média salarial por regiões/i)[1];
    if (!secao2) return estados;
    return extrairEstadosDeSecao(secao2);
  }

  return extrairEstadosDeSecao(secaoEstados);
}

function extrairEstadosDeSecao(secao) {
  const estados = [];
  const regex =
    /(\d{1,2})º\s*([A-Za-zÀ-ÿ\s()]+?)\s*(?:🠕|🠗)?\s*R\$\s*([\d.,]+?)\s*(\d+)\s*participantes/gi;
  let m;

  while ((m = regex.exec(secao)) !== null) {
    estados.push({
      posicao: parseInt(m[1], 10),
      estado: m[2].trim(),
      mediaSalarial: parseMoneyBR(`R$ ${m[3]}`),
      participantes: parseInt(m[4].replace(/\./g, ""), 10),
    });
  }

  return estados;
}

function extrairPaisesExterior($) {
  const bodyText = $("body").text();
  const paises = [];

  const secaoPaises = bodyText.split(/Média salarial por país/i)[1];
  if (!secaoPaises) return paises;

  const regex =
    /(\d{1,2})º\s*([A-ZÀ-ÿ\s]+?)\s*R\$\s*([\d.,]+?)\s*(\d+)\s*participantes/gi;
  let m;

  while ((m = regex.exec(secaoPaises)) !== null) {
    paises.push({
      posicao: parseInt(m[1], 10),
      pais: m[2].trim(),
      mediaSalarial: parseMoneyBR(`R$ ${m[3]}`),
      participantes: parseInt(m[4].replace(/\./g, ""), 10),
    });
  }

  return paises;
}

// ============================================================
//  Scraper principal
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

  const dados = {
    ano,
    url,
    coletadoEm: new Date().toISOString(),
    participantes: extrairParticipantes($),
    mediaSalarialPorNivel: extrairMediaSalarialPorNivel($),
    programadoresPorNivel: extrairProgramadoresPorNivel($),
    modeloTrabalho: extrairModeloTrabalho($),
    contratacao: extrairCLTvsPJ($),
    genero: extrairGenero($),
    idadeProgramadores: extrairIdadeProgramadores($),
    salarioPorIdade: extrairSalarioPorIdade($),
    transicaoCarreira: extrairTransicaoCarreira($),
    satisfacao: extrairSatisfacao($),
    formacaoEducacional: extrairFormacaoEducacional($),
    linguagens: extrairLinguagensV2($),
    frameworks: extrairFrameworks($),
    estados: extrairEstadosBR($),
    paisesExterior: extrairPaisesExterior($),
  };

  const qntExtracted = Object.entries(dados).filter(
    ([k, v]) =>
      v !== null &&
      v !== undefined &&
      (typeof v !== "object" ||
        Object.keys(v).length > 0 ||
        (Array.isArray(v) && v.length > 0)),
  ).length;

  console.log(`  ✅ ${ano}: ${qntExtracted} seções extraídas`);
  return dados;
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
      resultados.push(dados);
      await sleep(DELAY_MS);
    } catch (error) {
      console.error(`  ❌ Erro ao buscar ${ano}: ${error.message}`);
    }
  }

  // Salvar JSON completo
  const outputDir = path.join(__dirname, "dados");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Salvar cada ano separado
  for (const dados of resultados) {
    const filePath = path.join(outputDir, `pesquisa_${dados.ano}.json`);
    fs.writeFileSync(filePath, JSON.stringify(dados, null, 2), "utf-8");
    console.log(`\n📄 Salvo: ${filePath}`);
  }

  // Salvar tudo junto
  const allPath = path.join(outputDir, "pesquisa_todos_anos.json");
  fs.writeFileSync(allPath, JSON.stringify(resultados, null, 2), "utf-8");
  console.log(`📄 Salvo: ${allPath}`);

  // Gerar relatório de comparação no console
  gerarRelatorioConsole(resultados);

  return resultados;
}

// ============================================================
//  Relatório console
// ============================================================

function gerarRelatorioConsole(resultados) {
  console.log("\n\n═══════════════════════════════════════════════════════");
  console.log("  📊 RELATÓRIO COMPARATIVO (2021-2026)");
  console.log("═══════════════════════════════════════════════════════");

  // Participantes por ano
  console.log("\n📌 PARTICIPANTES POR ANO:");
  console.log("─".repeat(40));
  for (const r of resultados) {
    const total = r.participantes?.total || "N/A";
    console.log(
      `  ${r.ano}: ${typeof total === "number" ? total.toLocaleString("pt-BR") : total} participantes`,
    );
  }

  // Média salarial por nível ao longo dos anos
  console.log("\n💰 EVOLUÇÃO DA MÉDIA SALARIAL POR NÍVEL:");
  console.log("─".repeat(60));
  const niveis = ["Estágio", "Júnior", "Pleno", "Sênior"];
  for (const nivel of niveis) {
    console.log(`\n  ${nivel}:`);
    for (const r of resultados) {
      const valor = r.mediaSalarialPorNivel?.[nivel];
      if (valor) {
        console.log(
          `    ${r.ano}: R$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
        );
      }
    }
  }

  // CLT vs PJ
  console.log("\n\n📋 CLT vs PJ - EVOLUÇÃO:");
  console.log("─".repeat(60));
  for (const r of resultados) {
    const clt = r.contratacao?.CLT;
    const pj = r.contratacao?.PJ;
    if (clt && pj) {
      console.log(
        `  ${r.ano}: CLT R$ ${clt.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} | PJ R$ ${pj.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
      );
    }
  }

  // Trabalho remoto
  console.log("\n\n🏠 TRABALHO REMOTO - EVOLUÇÃO:");
  console.log("─".repeat(60));
  for (const r of resultados) {
    const remoto = r.modeloTrabalho?.remoto;
    const hibrido = r.modeloTrabalho?.hibrido;
    const presencial = r.modeloTrabalho?.presencial;
    if (remoto) {
      console.log(
        `  ${r.ano}: Remoto ${remoto}% | Híbrido ${hibrido || "N/A"}% | Presencial ${presencial || "N/A"}%`,
      );
    }
  }

  // Top 5 linguagens por ano
  console.log("\n\n💻 TOP 5 LINGUAGENS POR ANO:");
  console.log("─".repeat(60));
  for (const r of resultados) {
    if (r.linguagens && r.linguagens.length > 0) {
      console.log(`\n  ${r.ano}:`);
      r.linguagens.slice(0, 5).forEach((lang) => {
        console.log(
          `    ${lang.posicao}º ${lang.nome} - R$ ${lang.mediaSalarial?.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) || "N/A"} (${lang.participantes} devs)`,
        );
      });
    }
  }

  // Top 5 frameworks por ano
  console.log("\n\n🛠️  TOP 5 FRAMEWORKS POR ANO:");
  console.log("─".repeat(60));
  for (const r of resultados) {
    if (r.frameworks && r.frameworks.length > 0) {
      console.log(`\n  ${r.ano}:`);
      r.frameworks.slice(0, 5).forEach((fw) => {
        console.log(
          `    ${fw.posicao}º ${fw.nome} - R$ ${fw.mediaSalarial?.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) || "N/A"} (${fw.participantes} devs)`,
        );
      });
    }
  }

  // Top 5 estados por ano
  console.log("\n\n🗺️  TOP 5 ESTADOS POR ANO:");
  console.log("─".repeat(60));
  for (const r of resultados) {
    if (r.estados && r.estados.length > 0) {
      console.log(`\n  ${r.ano}:`);
      r.estados.slice(0, 5).forEach((est) => {
        console.log(
          `    ${est.posicao}º ${est.estado} - R$ ${est.mediaSalarial?.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) || "N/A"} (${est.participantes} devs)`,
        );
      });
    }
  }

  console.log("\n\n═══════════════════════════════════════════════════════");
  console.log("  ✅ Scraping concluído! Dados salvos em ./dados/");
  console.log("═══════════════════════════════════════════════════════\n");
}

// ============================================================
//  Executar
// ============================================================
main().catch(console.error);
