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

Além dos campos acima, cada arquivo traz `ia` (adoção, ganho de produtividade,
confiança na qualidade do código, receio de substituição e ranking de ferramentas)
e `saudeMental` (ansiedade, estresse, burnout, estafa mental, depressão), presentes
nas edições que investigaram esses temas.

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

O portal é uma aplicação Next.js e embute todos os resultados agregados em
`<script id="__NEXT_DATA__">`, sob `props.pageProps.survey`. O coletor lê esse JSON
com Cheerio e trabalha sobre **contagens absolutas**, e não por expressões regulares
sobre o texto renderizado.

Isso importa: a primeira versão deste coletor usava regex sobre o texto e produzia
erros silenciosos — distribuições somando 106% ou 114%, rótulos capturados da seção
errada, campos vazios. Lendo as contagens, os percentuais fecham 100% por construção
e cada rótulo vem com o nome exato que a pesquisa usa.

As médias salariais são a exceção: o site não as publica no JSON, calcula-as no
navegador a partir da distribuição por faixa. `mediasPorColuna()` reproduz a mesma
fórmula — ponto médio da faixa, faixa inferior valendo 500 e faixa aberta do topo
conforme `TOPO_FAIXA_ABERTA`. O resultado confere ao centavo com o publicado de 2022
a 2026. Nas edições até 2023, em que a média aparece no HTML servido, o valor
publicado tem precedência sobre o cálculo.

Os percentuais das ferramentas de IA seguem o denominador da própria pesquisa: a soma
das dez mais citadas na edição, não o total de respondentes.

A cada edição, `conferir()` avisa quando alguma distribuição deixa de somar 100%, e
`extrairSurvey()` interrompe a coleta se a página mudar de forma — melhor falhar alto
do que gravar um JSON plausível e errado.

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
