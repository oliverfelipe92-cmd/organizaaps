# Auditoria do Modulo Gestantes e Puerperas

Data da auditoria: 2026-06-19

## Referencia normativa

- O financiamento atual da APS foi reorganizado pela Portaria GM/MS no 3.493, de 10 de abril de 2024.
- A portaria institui nova metodologia do Piso da APS e passa a considerar componente de vinculo/acompanhamento territorial e componente de qualidade.
- O componente de qualidade e recalculado por quadrimestre.
- Os indicadores, a metodologia de calculo e as metas dependem de ato do Ministerio da Saude e ficha de qualificacao especifica.
- Fonte oficial: https://www.in.gov.br/en/web/dou/-/portaria-gm/ms-n-3.493-de-10-de-abril-de-2024-553573811

## O que ja existia

- Autenticacao com perfis e sessoes.
- Cadastro manual basico de pacientes.
- Importacao inicial de planilhas PEC e arquivos delimitados.
- Deduplicacao por CPF/CNS/nome.
- Indicadores assistenciais basicos de pre-natal e puerperio.
- Pagina individual da paciente com historico e atualizacao rapida.
- Publicacao em Vercel com banco compartilhado.

## Lacunas identificadas

- Ficha da gestante simplificada demais frente a planilha real da UBS.
- Importacao do PEC vulneravel a cabecalhos com acentuacao.
- Dashboard com pouca visao territorial e poucas pendencias operacionais.
- Falta de campos clinicos e organizacionais centrais: risco detalhado, plano de cuidados, maternidade, puerpuerio, urgencias, internacoes.
- UX de autenticacao e ocultacao de telas quebrada no frontend publicado.

## Melhorias iniciadas nesta rodada

- Correcao do estado visual de autenticacao e ocultacao por `hidden`.
- Novo layout da tela de acesso e do dashboard.
- Expansao do modelo de dados para identificacao, gestacao, risco, organizacao do cuidado, maternidade, parto e puerperio.
- Ajuste do importador para normalizar cabecalhos acentuados da planilha real.
- Ampliacao da ficha individual e do cadastro manual com campos mais proximos da planilha da UBS.
- Inclusao de mais cards de pendencia e distribuicoes por territorio/profissional no dashboard.

## Proximos passos recomendados

1. Concluir a tela "Pendencias e Busca Ativa" com filtros operacionais.
2. Implementar pre-visualizacao de importacao com conflitos antes de salvar.
3. Criar exportacoes PDF/CSV/XLSX orientadas a reuniao de equipe.
4. Refinar os graficos por risco, trimestre, microarea e cobertura.
5. Incorporar as metas oficiais assim que o ato especifico/ficha de qualificacao vigente estiver consolidado para o componente de qualidade.
