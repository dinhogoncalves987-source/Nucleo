# O Nucleo

Plataforma multiempresa com interface administrativa, conversa James e controles para operacao comercial.

## Estado desta versao

Este codigo e um candidato para validacao controlada. Testes locais com identidades e provedores sinteticos nao comprovam autenticacao, isolamento no banco implantado, chamadas OpenAI, pareamento de WhatsApp ou entrega de mensagens reais.

A publicacao do frontend e das funcoes Vercel nao inicia o backend persistente, filas ou transporte de mensagens. Campanhas, verificacao real de numeros e envios nao devem ser habilitados como efeito colateral do deploy.

## Componentes

- `src/`: frontend React/Vite.
- `api/`: endpoints Vercel. Os seis caminhos `/api/james/generate/*` usam um dispatcher com allowlist; suas implementacoes ficam em `server-handlers/generate/`.
- `shared/`: contratos de conversa, memoria, orcamento e qualificacao.
- `backend/`: processo persistente separado. O entrypoint legado inicia workers e agendadores e nao deve ser usado para parear um chip isoladamente.
- `supabase/`: SQL versionado. Nao executar o conjunto de arquivos indiscriminadamente: conferir o estado e o ownership do projeto, dependencias, politicas RLS e caminho de provisionamento antes de aplicar uma migration.
- `tests/`: testes locais; evidencias, capturas e relatorios do ambiente ficam fora do Git.

## Configuracao

Use `.env.example` e `backend/.env.example` como referencia. Valores `VITE_*` sao publicos no navegador; nunca coloque chaves privadas nesses nomes. Credenciais privadas pertencem somente ao ambiente servidor autorizado.

O caminho de conversa exige configuracao de identidade, memoria persistente e limite de orcamento. Nenhum deploy deve ativar automaticamente chamadas pagas. As guardas de modo demonstracao e de quarentena do legado devem ser preservadas ate a validacao pertinente.

## Validacao local

Instale as dependencias pelo lockfile e execute:

```
npm ci
npm run build
npm run validate:local
npm run validate:commercial:offline
npm run validate:lead-import
npm run validate:lead-guards
npm run validate:public-search
```

O teste de roteamento Vercel usa o modulo VM do Node e nao acessa provedores:

```
node --experimental-vm-modules --test tests/vercel-generation-routing.test.mjs
```

Testes que exigem PostgreSQL tem fixture e runner proprios. Nao aponte testes sinteticos para dados de producao. Resultados de fixtures nao substituem verificacao real de Auth, RLS, persistencia, recibos ou recuperacao apos falha.

## Publicacao

O projeto usa Vite, `dist/` e funcoes Node Vercel. A contagem esperada apos a consolidacao e de 10 endpoints, com 12 arquivos TypeScript em `api/` incluindo utilitarios; a contagem efetiva deve ser confirmada no build Vercel.

Valide primeiro um preview. Promocao de producao exige conferir o commit, o ambiente e a compatibilidade do banco, alem de testar a jornada autorizada. O transporte de WhatsApp requer processo persistente separado, vinculo explicito entre empresa/canal/sessao, eventos autenticados e reconciliacao de envios incertos. Nao basta mudar uma flag ou escanear um QR.