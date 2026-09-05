# Pesquisa Salarial de Programadores Brasileiros — coletor e dados (2021–2026)

Coletor automatizado e conjunto de dados estruturados das **seis edições** da
[Pesquisa Salarial de Programadores Brasileiros](https://pesquisa.codigofonte.com.br),
publicada anualmente pelo canal [Código Fonte TV](https://www.youtube.com/@codigofontetv).

Este repositório existe para permitir a **reprodução integral** do procedimento de
coleta descrito na seção de metodologia do artigo *Análise longitudinal da
remuneração de programadores brasileiros (2021–2026)*, apresentado como Trabalho de
Conclusão de Curso no IFCE — campus Tauá.

## Fonte dos dados

Os dados já se encontravam agregados e publicados em acesso público no portal da
pesquisa. Nenhum dado individual de respondente é coletado, armazenado ou
redistribuído aqui — apenas os agregados que o próprio portal divulga.

O crédito pela pesquisa, pela coleta primária e pela tabulação é do Código Fonte TV.

## Uso

```bash
npm install
npm start        # ou: node scraper.js
```

O coletor percorre as seis URLs anuais (2021–2026), aplicando **1500 ms de intervalo
entre requisições** para não sobrecarregar o servidor, e grava os resultados em `dados/`.

## Estrutura dos dados

| Arquivo | Conteúdo |
|---|---|
| `dados/pesquisa_AAAA.json` | Uma edição da pesquisa (2021 a 2026) |
| `dados/pesquisa_todos_anos.json` | Consolidado das seis edições |
| `dados/dados_verificados_web.json` | Conferência manual dos valores contra as páginas originais (jun/2026) |

Cada arquivo anual tem o formato:

```jsonc
{
  "ano": 2021,
  "url": "https://pesquisa.codigofonte.com.br/2021",
  "coletadoEm": "2026-02-08T21:50:29.237Z",
  "participantes": { "total": 11441 },
  "mediaSalarialPorNivel": { "Júnior": 2955.93, "Pleno": 5594.11, ... },
  "programadoresPorNivel":  { ... },
  "modeloTrabalho": { ... },
  "contratacao": { ... },
  "genero": { ... },
  "idadeProgramadores": { ... },
  "salarioPorIdade": { ... },
  "transicaoCarreira": { ... },
  "satisfacao": { ... },
  "formacaoEducacional": { ... },
  "linguagens":     [ { "posicao": 1, "nome": "...",   "mediaSalarial": 0.0, "participantes": 0 } ],
  "frameworks":     [ { "posicao": 1, "nome": "...",   "mediaSalarial": 0.0, "participantes": 0 } ],
  "estados":        [ { "posicao": 1, "estado": "...", "mediaSalarial": 0.0, "participantes": 0 } ],
  "paisesExterior": [ { "posicao": 1, "pais": "...",   "mediaSalarial": 0.0, "participantes": 0 } ]
}
```

Convenções: valores monetários são números em reais sem formatação (`5594.11`);
percentuais são números na escala de 0 a 100 (`43.8`, não `0.438`).

## Como funciona

O portal renderiza os resultados como texto corrido, sem estrutura HTML semântica
que permita seletores estáveis. Por isso o parsing é feito por expressões regulares
sobre o texto extraído da página (`$('body').text()` via Cheerio), e não por
seletores CSS/DOM. As funções de ranking segmentam o texto pelo cabeçalho da seção
antes de aplicar as regex, para evitar contaminação entre seções.

Consequência prática: **mudanças na redação do portal quebram a extração**. Os
arquivos em `dados/` refletem as páginas tal como estavam em fevereiro e junho de
2026, e servem como registro estável mesmo que o site mude.

## Dependências

[Node.js](https://nodejs.org/) 18+, [Axios](https://axios-http.com/) e
[Cheerio](https://cheerio.js.org/). O `package-lock.json` está versionado para
travar as versões exatas usadas na coleta original.

## Licença

Código sob [MIT](LICENSE). Arquivos de dados sob
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.pt-br), com atribuição
ao Código Fonte TV como autor da pesquisa original. Ver [LICENSE](LICENSE).

## Como citar

> GOMES, Italo Oliveira. **Coletor e dados da Pesquisa Salarial de Programadores
> Brasileiros (2021–2026)**. Tauá: IFCE, 2026. Disponível em:
> https://github.com/italoog/pesquisa-salarial-programadores-br.
