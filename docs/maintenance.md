# Manutencao do DiefTrade

## Limites da limpeza

`dist/`, `node_modules/` e caches sao resultados locais, nao codigo-fonte.
Mantenha os pacotes atuais ate sua validacao ou publicacao. Remova apenas
artefatos antigos identificados, sem varrer Downloads, AppData ou dados pessoais.
O historico Git e as evidencias em `docs/history/` nao devem ser apagados.

## Identidade visual

`src/ui/brand.png` e o recurso web; `assets/brand/dieftrade.ico` e o icone Windows.
Ambos estao em uso. O conversor opcional `scripts/branding/convert-brand.py`
requer Python com Pillow e recebe o caminho de uma imagem aprovada. Nao faz
parte da inicializacao ou do build e nao chama servicos externos.

## Publicacao

Execute os testes e gere o portatil antes de usar `scripts/publish-release.ps1`.
O script publica `dist/DiefTrade.exe` e metadados com tamanho e SHA-256.
Use o argumento `-Notes` para fornecer as notas reais da release; sem ele, o
script aponta para o changelog sem repetir listas antigas de mudancas ou testes.
A versao vem de `package.json`; nao altere o identificador de dados do app.
Gerar pacotes nao publica releases e nao troca o download no Painel Dief.
O instalador opcional e gerado separadamente por `pnpm run build:installer`.

## Diagnosticos

`pnpm run test:ai:live` usa credenciais fornecidas por variaveis de ambiente,
sem ler automaticamente as chaves pessoais salvas no aplicativo. Pode consumir
quota e deve ser acionado conscientemente. Os testes normais usam fixtures.
O smoke do executavel usa um perfil temporario separado, sem modificar o real.

## Validacao local 0.9.5

- 132 testes Node aprovados e verificacao estatica de 59 arquivos.
- Playwright: cinco temas, quatro tamanhos de tela, seis abas, canvas preenchido,
  foco e acessibilidade; dados de mercado simulados nesse teste visual.
- Smoke dos pacotes unpacked e portatil aprovado com mercado real, book e quote
  recentes e ordem exclusivamente simulada em perfil temporario.
- Abertura unpacked observada: 29.851 ms desde o launcher ate a janela,
  dos quais 3.956 ms no processo principal. Portatil: 43.594 ms no total,
  dos quais 564 ms no processo principal. Sao observacoes, nao benchmark
  estatistico: cache, Windows, extracao e condicoes da maquina variam.
- O instalador foi gerado; o fluxo de instalacao/desinstalacao nao foi executado
  para nao alterar a instalacao real do usuario. A aplicacao empacotada foi testada.
- Nenhuma release remota nem download do Painel Dief foi alterado nesta rodada.
