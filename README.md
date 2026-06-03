# OrganizaAPS

Sistema web para monitoramento compartilhado de gestantes e puérperas na APS, com login, base central, histórico de atendimentos e importação deduplicada de planilhas/arquivos do PEC.

## O que esta pronto

- configuracao inicial do primeiro administrador
- login por sessao com cookie `HttpOnly`
- perfis de acesso: administrador, enfermagem, ACS e somente leitura
- gestao de equipe dentro do sistema
- base compartilhada em Postgres via Supabase ou SQLite local
- cadastro manual e atualizacao de atendimentos
- transicao automatica para puerpera quando o parto e registrado
- importacao de `.xlsx`, `.xlsm`, `.csv`, `.tsv` e `.txt`
- reconhecimento do que ja entrou por chave de origem + hash da linha
- historico de importacoes com quantas linhas entraram, atualizaram ou foram ignoradas

## Como executar localmente

```bash
'/Users/felipeoliveira/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3' app.py --host 0.0.0.0 --port 8765
```

Depois acesse:

```text
http://127.0.0.1:8765
```

Na primeira abertura, crie a conta administradora da UBS.

## Como usar

1. Entre com o login da equipe.
2. Cadastre manualmente ou importe a planilha/arquivo do PEC.
3. Registre cada novo atendimento pelo painel da paciente.
4. Ao marcar parto ou informar data de parto, a usuaria passa para o fluxo de puérpera.
5. Use a area `Equipe` para criar novos acessos e ajustar perfis.
6. Em novas importacoes, o sistema atualiza o que mudou e evita duplicar o que ja foi reconhecido.

## Importacao inteligente

Hoje o sistema reconhece dois formatos principais:

- planilha simplificada no estilo `Registro pac.`
- planilha rica no estilo aba `Dados` do arquivo da UBS/PEC

A deduplicacao prioriza:

- `CPF`
- `CNS`
- codigo externo/prontuario
- composicao `nome + data de nascimento + nome da mae`

Tambem existe deduplicacao de eventos importados por chave de origem e data.

## Estrutura

- `app.py`: servidor HTTP e API autenticada
- `ubs_monitor/auth.py`: senha, sessao e autenticacao
- `ubs_monitor/db.py`: schema e compatibilidade SQLite/Postgres
- `ubs_monitor/importer.py`: parser e reconciliacao dos arquivos de origem
- `ubs_monitor/indicators.py`: regras dos indicadores e prioridades
- `static/`: interface web autenticada
- `api/index.py`: entrada da API Python para a Vercel
- `tests/`: testes do motor clinico, autenticacao e importacao

## Publicacao gratis

Arquitetura recomendada para piloto:

- frontend e APIs na Vercel
- banco compartilhado Postgres no Supabase Free
- URL publica em `organizaaps.vercel.app` ou subdominio equivalente

### Variavel obrigatoria na Vercel

- `DATABASE_URL`: string de conexao Postgres do Supabase

Tambem e aceito `SUPABASE_DB_URL`, mas o padrao recomendado para deploy e `DATABASE_URL`.

### Fluxo de deploy

1. Criar o projeto no Supabase.
2. Copiar a connection string Postgres.
3. Importar este repositorio na Vercel.
4. Adicionar `DATABASE_URL` nas Environment Variables.
5. Fazer o primeiro deploy.
6. Abrir a URL publica e criar o primeiro administrador.

### Desenvolvimento local com banco local

Sem `DATABASE_URL`, o sistema usa SQLite local em `data/monitor.db`.

### Observacao importante

Para piloto e homologacao, `Vercel + Supabase Free` funciona bem. Para uso institucional com dados sensiveis identificados, o ideal e validar LGPD, backup, rotinas de acesso e contrato institucional antes de escalar a ferramenta.
