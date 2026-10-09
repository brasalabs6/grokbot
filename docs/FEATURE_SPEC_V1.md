# GrokBot — Feature Specification V1 (MVP interno)

> **Status:** SPEC PROPOSTA — documento normativo de produto e engenharia, anterior à implementação.  
> **Versão:** 1.0.0 (especificação)  
> **Data:** 2026-10-09  
> **Repositório:** https://github.com/brasalabs6/grokbot  
> **Destino:** branch main, docs/FEATURE_SPEC_V1.md  
> **Escopo:** V1 do MVP interno; não significa que os recursos aqui descritos já estejam implementados.  
> **Prioridade:** P0 = obrigatório para aceitar a V1; P1 = melhoria desejável e não bloqueadora; FUTURE = fora da V1.  
> **Idioma principal:** português. Identificadores técnicos, payloads e nomes de estados são definidos em inglês.

---

## 0. Objetivo e natureza deste documento

Esta Feature Spec é a fonte de verdade proposta para transformar o chatbot atual do GrokBot em **uma plataforma web de execução e gerenciamento de coding agents Grok Build dentro de sandboxes Linux do Cloudflare**, com inferência primária via Cloudflare Workers AI, protocolo ACP, chat em tempo real e terminal interativo.

Ela especifica comportamento observável, limites, arquitetura, contratos, persistência, segurança, interfaces, estados, dependências, casos de erro e testes de aceitação. Nenhum requisito deve ser considerado concluído por estar descrito aqui. A execução será incremental e aferida por evidência.

### 0.1 Princípio fundamental

**Sessão de chat, execução do agente, sandbox e conexão do navegador são coisas diferentes.**

Uma aba fechada não encerra um trabalho. Uma requisição HTTP encerrada não cancela um turno. Um container desligado não apaga o registro da sessão. Um snapshot de arquivos não é uma cópia de processos vivos. Um frontend conectado não é a autoridade sobre o progresso do agente.

### 0.2 Definição de pronto da V1

A V1 só estará concluída quando for possível, com infraestrutura real do Cloudflare e uma conta interna autorizada:

1. Criar uma sessão persistente pela interface.
2. Provisionar uma sandbox Linux isolada.
3. Instalar/usar a imagem versionada contendo Grok Build e ferramentas.
4. Iniciar um processo Grok Build ACP e negociar suas capacidades.
5. Enviar um prompt e receber resposta real de um modelo Workers AI.
6. Acompanhar texto, planos, ferramentas, estados e aprovações durante a execução.
7. Abrir um terminal PTY interativo na mesma sandbox e editar/inspecionar arquivos.
8. Fechar/recarregar a página sem perder mensagens já confirmadas nem interromper indevidamente a execução.
9. Cancelar efetivamente um turno no agente, e não apenas esconder sua UI.
10. Suspender/encerrar a sandbox de forma deliberada e restaurar arquivos e contexto de maneira verificável.
11. Recuperar a plataforma de falhas simuladas de processo, rede e reinício de container.
12. Impedir que outro usuário acesse sessões, terminais, credenciais ou workspaces alheios.
13. Mostrar falhas e operações incertas explicitamente, sem inventar sucesso.
14. Executar a suíte de testes de aceitação P0 em ambiente integrado.

Um chat que só faz geração de texto, um terminal que só mostra logs ou uma simulação de sandbox **não** satisfazem a V1.

---

## 1. Contexto e diagnóstico do bootstrap

### 1.1 O que o repositório já oferece

O bootstrap atual deriva do Vercel AI Chatbot Template e contém Next.js 16, React 19, AI SDK 7, UI de chat, Auth.js, PostgreSQL/Drizzle, histórico de mensagens, seleção de modelos, componentes para artefatos, upload básico e testes Playwright.

Pontos de entrada identificados na revisão inicial:

| Área | Arquivo ou diretório existente | Observação |
|---|---|---|
| Chat HTTP | app/(chat)/api/chat/route.ts | Geração atual é fluxo direto AI SDK/LLM, sem ACP |
| Payload de chat | app/(chat)/api/chat/schema.ts | Validar evolução para vínculo com sessões/runs |
| Chat state | hooks/use-active-chat.tsx | Adaptar transporte, reconexão e semântica de stop |
| Layout | components/chat/shell.tsx | Aproveitar e reorganizar a interface |
| Console | components/chat/console.tsx | Console de outputs, não PTY interativo |
| Modelos | lib/ai/models.ts e providers.ts | Rotas atuais usam Vercel AI Gateway |
| Persistência | lib/db/schema.ts e lib/db/queries.ts | Não há entidades de sandbox, ACP ou run |
| Auth | app/(auth)/auth.ts | Há autenticação regular e guest |
| Retomar stream | app/(chat)/api/chat/[id]/stream/route.ts | Resposta 204; não há replay real dessa rota |
| Testes | tests/e2e/ | Expandir com infraestrutura e testes de falha |

### 1.2 Estratégia de migração

- **MUST:** aproveitar autenticação, UI, convenções Next.js, componentes e infraestrutura de persistência que forem compatíveis.
- **MUST:** preservar funcionamento do chat legado durante a migração por feature flag ou modo explicitamente separado, até o novo modo passar nos gates.
- **MUST:** não confundir conversa LLM direta com sessão de agente. Os transports e estados devem ser tipados separadamente.
- **MUST:** preservar dados existentes mediante migrations incrementais, com plano de rollback.
- **MUST:** não expor a chave Cloudflare nem segredos do Grok ao navegador ou ao filesystem do workspace.
- **MUST:** remover dependências e demonstrações não necessárias ao produto somente depois de verificar impacto e testes.
- **MUST:** não executar migrations automaticamente como efeito colateral surpreendente de um build de produção; separar migração controlada do empacotamento da aplicação.
- **SHOULD:** manter o frontend hospedado no Vercel e usar Cloudflare para runtime; outra decisão de hospedagem só por ADR.

### 1.3 O que ainda precisa ser provado

Ainda **não** está provada por esta spec a compatibilidade ponta a ponta do Grok Build com um modelo Workers AI concreto, nem a precisão de retomar seu estado após reinício total do processo/container. Essas questões são gates obrigatórios e não pressupostos.

---

## 2. Problema, público e metas

### 2.1 Problema

Coding agents executados por sessões improvisadas perdem continuidade, ficam difíceis de observar, exigem acesso manual ao servidor, podem misturar workspaces e são frágeis a desconexões. A interface atual do GrokBot não gerencia o processo Grok nem o ciclo de vida da máquina em que ele atua.

### 2.2 Público-alvo

Usuário interno autenticado que cria, administra e acompanha sessões de engenharia assistida por agentes. V1 não é um SaaS público multi-tenant. O desenho deve, porém, impedir vazamentos entre usuários internos e evitar decisões que tornem o isolamento inviável no futuro.

### 2.3 Objetivos mensuráveis

- O usuário deve iniciar uma sessão sem usar SSH, CLI Cloudflare ou console manual.
- Cada sessão deve ter identidade durável e área de trabalho isolada.
- Um prompt deve produzir um único run lógico identificável e rastreável.
- O chat deve renderizar atualizações estruturadas sem bloquear o frontend.
- O usuário deve operar shell real pela web e confirmar comandos no workspace correto.
- Operações de iniciar, cancelar, suspender, retomar e excluir devem ser auditáveis e reconciliáveis.
- Falhas devem resultar em estado explícito e opção operacional, nunca em silêncio ou falso sucesso.
- A V1 deve ser útil com poucas sessões concorrentes, priorizando confiabilidade e legibilidade sobre escala massiva.

### 2.4 Não objetivos V1

Não inclui orquestração multiagente hierárquica, faturamento por cliente, marketplace, execução em Kubernetes, hospedagem arbitrária fora do Cloudflare, colaboração simultânea em tempo real entre vários editores, IDE completa, GitHub PR automation irrestrita, integração com modelos de dezenas de provedores, nem agentes autônomos com acesso não supervisionado à infraestrutura de produção.

Não inclui garantia de restauração de RAM, processos ou sockets. Não promete exatamente uma execução física em cenários de timeout ambíguo; promete **idempotência lógica, detecção de ambiguidade e proibição de duplicação automática perigosa**.

---

## 3. Decisões técnicas da V1

| ID | Decisão | Justificativa |
|---|---|---|
| ADR-001 | Next.js + React existentes como Web App | Reaproveitar bootstrap e chat |
| ADR-002 | Cloudflare Container com Durable Object scheduling | Full Linux, controle por sessão e APIs recentes |
| ADR-003 | Sandbox SDK 1.0 / Durable Object Container API | Não introduzir integração 0.x obsoleta |
| ADR-004 | Uma sandbox isolada por sessão V1 | Segurança, rastreabilidade e simplicidade |
| ADR-005 | Grok Build como agent harness | Coding agent pedido, com ferramentas e ACP |
| ADR-006 | ACP JSON-RPC sobre WebSocket como transporte primário | Processo de agente de longa duração e reconexão |
| ADR-007 | ACP stdio como fallback de desenvolvimento/gate | Diagnóstico e compatibilidade, não solução de reconexão definitiva |
| ADR-008 | Workers AI como provedor de inferência da sessão | Modelo hospedado no Cloudflare |
| ADR-009 | PostgreSQL como registro de produto/eventos confirmados | Continuidade, transações, histórico |
| ADR-010 | DO storage como coordenação e buffer limitado de reentrega | Resiliência quando o banco/control plane estiver indisponível |
| ADR-011 | R2 para backup durável de workspace | Snapshots beta não são política única de durabilidade |
| ADR-012 | xterm.js + PTY + tmux | Shell verdadeiro recuperável após desconexão |
| ADR-013 | Segredos mantidos no Control Plane / Worker | Reduzir exposição a código não confiável |
| ADR-014 | Modelo e configuração imutáveis por run | Reprodutibilidade e trilha de auditoria |
| ADR-015 | Operações com IDs e idempotency key | Evitar corrida e efeitos duplicados |
| ADR-016 | Feature flags para runtime/transport legado | Migração sem quebrar chats existentes |

As APIs concretas devem ser confirmadas no pacote efetivamente pinado durante implementação. Exemplos abaixo são **contratos GrokBot propostos**, não alegações de endpoints existentes do Cloudflare.

---

## 4. Modelo conceitual e fronteiras

### 4.1 Identidades obrigatórias

- **User:** conta autenticada e permissões.
- **AgentSession (sessionId):** entidade lógica duradoura apresentada na lista de sessões; controla vínculo entre conversa, runtime, configurações e workspace.
- **Chat/Conversation:** mensagens visíveis, histórico, metadados e possíveis ramificações. Na V1, uma conversa principal por sessão.
- **Sandbox (sandboxId):** recurso lógico da execução Cloudflare que pode passar por múltiplas gerações.
- **SandboxGeneration (generation):** incremento monotônico em cada criação/recriação do container.
- **ACPConnection:** conexão de transporte com o processo Grok.
- **ACPSession (acpSessionId):** identidade devolvida pelo agent após session/new ou session/load; pode mudar no recovery.
- **Run (runId):** um turno solicitado, aceito, executado e encerrado com resultado.
- **Operation (operationId):** comando de lifecycle assíncrono (start, suspend, resume etc.).
- **TerminalSession (terminalId):** shell lógico tmux/PTy associado à sandbox e generation.
- **WorkspaceRevision/Backup:** versão durável de arquivos recuperáveis.
- **Event (eventId, seq):** fato persistido e ordenável da execução ou lifecycle.

Nunca usar o chatId como substituto implícito de sandboxId ou acpSessionId. IDs devem ser gerados no servidor ou validados quanto a autorização e unicidade.

### 4.2 Topologia

~~~text
Browser (Next.js UI + AI SDK UI + xterm.js)
  | HTTPS API + SSE events + authenticated WebSocket
  v
Next.js Control Plane (Auth.js, CRUD, policy, PostgreSQL, API)
  | authenticated service calls / operations / event ingestion
  v
Cloudflare Worker ingress
  | Durable Object named by opaque sandbox identity
  v
SessionController Durable Object
  | container.start / exec / signals / PTY / snapshot / egress
  v
Cloudflare Container (versioned image)
  |-- Grok Build ACP server (private listener)
  |-- tmux, bash, Git, Node, language toolchains
  |-- /workspace (dedicated session files)
  |-- optional application preview process
  +-- outbound inference via authenticated Worker proxy
          |
          v
     Cloudflare Workers AI
~~~

### 4.3 Plano de dados e plano de controle

- **Control Plane:** persistência de intenção, autenticação, autorização, políticas, observabilidade de alto nível, consultas de sessões, event log.
- **Execution Plane:** DO, container, Grok, shell, filesystem, processos de projeto.
- **Event Plane:** tradução ACP, ordenação, ingestão transacional, replay, fan-out.
- **Inference Plane:** roteamento autenticado do Grok até Workers AI, com log de consumo e política de egress.

Uma pane do navegador não deve derrubar o execution plane. Um deploy do frontend não pode substituir automaticamente a generation de containers ativos.

---

## 5. Experiência de uso e funcionalidades de produto

### F-001 — Login e autorização (P0)

**Descrição:** apenas usuários regulares autorizados podem criar, iniciar, visualizar e operar sandboxes. A modalidade guest herdada do template não pode provisionar containers, conectar terminais, acessar APIs de execução nem listar sessões de terceiros.

**Regras:**
- No MVP, dois papéis: ADMIN e MEMBER; ambos podem criar suas sessões, ADMIN pode recuperar/encerrar sessões de outros membros com log de auditoria.
- Autorização em cada endpoint HTTP, upgrade WebSocket, operação DO e download de artefato.
- OwnerId imutável depois da criação, exceto operação administrativa explicitamente auditada.
- CSRF/origin check nos métodos com cookie de sessão; rate limit por userId e IP como defesa complementar.
- Cookies seguros em produção; remover exposição desnecessária das funções de guest.
- Sessões compartilhadas/publicadas do chatbot legado **não** herdam automaticamente permissão para operações de sandbox.

**Aceite:** usuário A recebe 403/404 consistente ao tentar acessar chat, terminal, arquivo, evento ou ação da sandbox de B; guest não cria sandbox.

### F-002 — Dashboard de sessões (P0)

Lista com título, status da sessão, status do container, modelo, última atividade, execução atual, origem do workspace, data da criação e ações contextuais. Suporta ordenação por atividade, pesquisa por título e filtro de estados.

Estados exibidos devem vir do backend com indicação de atualização e não de suposições do frontend. Uma sessão com estado inconsistente mostra "Reconciliação em andamento".

Ações: nova sessão, abrir, renomear, iniciar/retomar, suspender, parar, excluir (com confirmação), abrir detalhes/erros, filtrar. Ações inválidas ficam indisponíveis com explicação.

### F-003 — Wizard de criação de sessão (P0)

Campos:
- título opcional (padrão gerado de forma determinística até existir título derivado do primeiro prompt);
- modelo Workers AI dentre opções habilitadas e testadas;
- origem: workspace vazio (P0) ou clonar URL pública HTTPS Git (P0 condicionado a egress). Repositório privado é P1, exigindo autenticação segura fora do container;
- branch/ref opcional se houver Git;
- política de permissões: "ask" como padrão; perfil auto opcional apenas para usuário autorizado e com alerta;
- perfil de recursos: um tamanho validado no MVP (P0), configurações avançadas de tamanho em P1;
- diretório fixo de trabalho /workspace;
- timeout de inatividade via configuração central.

Criar sessão não equivale a executar prompt. A operação de provisioning terá progresso e poderá falhar sem gerar sessão "pronta" falsa.

### F-004 — Página principal da sessão (P0)

Layout desktop:
1. Sidebar com sessões e ações.
2. Centro com conversa do agente, timeline de tool calls e composer.
3. Painel contextual redimensionável com abas Terminal, Files, Git, Runs e Logs.
4. Header com título, modelo, status de sessão/container, indicador de conexão, botões de lifecycle e custo aproximado quando disponível.

Em telas menores: abas Chat / Terminal / Files / Activity, evitando dividir o terminal em largura insuficiente. Suporte a teclado, foco, contraste, scroll independente, screen readers e textos de erro legíveis.

A UI não deve desligar uma sessão ao trocar de rota. Mostrar diferença entre "agente pensando", "executando ferramenta", "aguardando aprovação", "sem conexão" e "container parado".

### F-005 — Chat funcional por ACP (P0)

- Prompt com texto multiline, Enter para enviar e Shift+Enter para quebra (com alternativa acessível).
- Preservar rascunho por sessão durante navegação.
- Mostrar mensagem otimista como "sending" até backend confirmar run.
- Persistir mensagem de usuário com operation/run id antes de acionar Grok.
- Exibir resposta incremental, tool calls, planos, tool results e eventos de status em tempo real.
- Exibir papel e status da mensagem; mensagens pendentes, interrompidas, falhas e completas.
- Histórico completo após refresh, sem depender dos estados de hooks React.
- Suporte a Markdown, blocos de código, tabelas e links com sanitização.
- Mostrar anexos aceitos/rejeitados antes do envio.
- Exibir histórico de turns, timestamps, duração e mensagem final.
- Enviar novo turno após término anterior. Na V1, **um run ativo por sessão**; prompts concorrentes podem ser rejeitados com 409, sem fila implícita.
- Stop cancela run backend/ACP e espera confirmação, com indicação de timeout caso o cancelamento seja incerto.
- Retry só após validação do estado do run original; "reenviar" cria run novo sob decisão do usuário quando efeitos anteriores forem ambíguos.
- Regenerate tem semântica de novo run associado ao prompt anterior, sem sobrescrever trilha de execução original.
- Editar mensagem anterior: na V1 cria nova branch lógica de conversa/replay controlado quando permitido; não mutar silenciosamente um contexto ACP já executado.
- O botão enviar fica bloqueado quando sandbox não está pronta, exceto fluxo explícito que pede iniciar e depois enviar.
- A UI pode aproveitar AI SDK UI messages, **mas não** converter seus efeitos locais em estado autoritativo do Grok.

### F-006 — Streaming e replay de eventos (P0)

- Cada evento carrega sessionId, generation, runId opcional, eventId, seq monotônico, type, timestamp e payload versionado.
- O servidor persiste os eventos que fundamentam estados e mensagens **antes** de confirmar sua entrega como duráveis ao cliente.
- Desconexão/refresh: cliente solicita eventos após lastSeenSeq, deduplica eventId e aplica redução idempotente.
- Quando houver gap, cliente solicita replay; se cursor estiver fora da retenção, recebe snapshot de estado e histórico, mais novo cursor.
- Eventos podem chegar duplicados ou fora de ordem pela rede; a redução preserva ordem por seq.
- Heartbeat e detection timeout para diferenciar backend sem conexão de agente ocioso.
- Backpressure: eventos de texto podem ser coalescidos para renderização, **não** pode perder status de tool call, aprovação, término ou erro.
- O Control Plane grava event log PostgreSQL; DO retém buffer limitado/reentregável quando serviço de ingestão estiver temporariamente indisponível.
- Ao esgotar buffer sem persistência, bloquear novos runs ou entrar em DEGRADED; não afirmar gravação durável.
- SSE recomendado para feed ordenado de eventos; WebSocket para interações bidirecionais necessárias. Não depender de conexão HTTP Next.js com duração equivalente à do turno.

**Aceite:** desconectar durante execução e retomar após 30s devolve o mesmo run e sequência, sem mensagens duplicadas ou perda de eventos confirmados.

### F-007 — Ferramentas do agente e timeline (P0)

ACP Adapter reconhece ao menos: initialize, session/new, session/load ou resume conforme capacidade, session/prompt, session/update, session/cancel, pedidos/respostas de permissão e atualização de opções suportadas.

Atualizações de sessão obrigatórias: agent_message_chunk, tool_call, tool_call_update e plan. Outras extensões são passadas pelo raw event store e mostradas genericamente, sem descartar o payload.

Cartões de ferramentas apresentam: ID estável, nome/título, status, horário, tempo de duração, resumo de input, resumo de output, erro, aprovação e possível arquivo afetado. Outputs extensos devem ser limitados na UI e disponibilizados por visualização segura.

Planos são renderizados como etapas quando houver plan do agente. Não fabricar um plano quando o Grok não fornecer.

### F-008 — Aprovações (P0)

O modo padrão é ASK. Quando o agente solicitar aprovação:
1. gravar approvalId, runId, toolCallId, resumo dos argumentos, risco e prazo;
2. mudar run para WAITING_APPROVAL;
3. oferecer Aprovar uma vez / Negar;
4. registrar usuário decisor e timestamp;
5. encaminhar a decisão apenas uma vez;
6. atualizar estado final ou timeout.

Auto-approve não é padrão. Se habilitado por ADMIN, o backend exige política explicitamente configurada e continua aplicando deny rules, egress, limites, autorização e logs. Aprovação no frontend não é autorização para transgredir políticas globais.

Após refresh, aprovação pendente deve reaparecer. Ao expirar, negar ou cancelar de forma segura. Duas abas respondendo à mesma approval geram somente uma decisão efetiva; a segunda recebe conflito informativo.

### F-009 — Modelo e configuração de inferência (P0)

O Grok deve operar com modelo Workers AI configurado por endpoint OpenAI-compatible autenticado, sem depender de token xAI para cada inferência quando o modelo for Cloudflare. O mecanismo de inicialização e eventual exigência de autenticação/telemetria do CLI Grok precisa ser testado; não afirmar ausência de exigências adicionais sem evidência.

Modelo inicial candidato: @cf/openai/gpt-oss-120b. Alternativas só entram no seletor após prova de função de ferramentas, streaming, contexto e estabilidade no harness.

Uma sessão registra modelId, provider, endpointMode, configuração de raciocínio suportada, versão da imagem e versão do Grok. Alteração de modelo só entre runs, com transição explícita e confirmação ACP. O run congela modelId/modelConfigVersion do início ao fim.

Tokens Cloudflare reais vivem em Worker secret / Secret Store e jamais são injetados como variáveis legíveis pelo shell genérico. Preferir proxy outbound por hostname com autenticação inserida pelo Worker. Falha de autenticação, quota ou modelo indisponível produz erro classificado.

### F-010 — Terminal real (P0)

- Componente @xterm/xterm, addon fit, WebSocket binário, PTY real e tmux persistente enquanto container existir.
- Terminal nasce dentro da sandbox correta, no diretório /workspace.
- Suporta input arbitrário de shell autorizado, Ctrl+C, Ctrl+D, resize, cores ANSI, paste e output incremental.
- Pelo menos um terminal por sessão; múltiplas abas de terminal são P0 se o runtime permitir isolamento correto de IDs; limite configurável.
- Recarregar browser reanexa ao mesmo tmux session sem reiniciar shell, desde que container permaneça vivo.
- Caso o container tenha sido reiniciado, terminal é explicitamente recriado. Não prometer continuação do processo do shell antigo.
- Indicadores claros CONNECTING, CONNECTED, DISCONNECTED, RECONNECTING e CLOSED.
- Output não pode ser executado como HTML na aplicação.
- Terminal usa ticket de conexão curto, de uso único e restrito a userId/sessionId/terminalId/generation; nunca URL pública de terminal sem autenticação.
- Frame de resize, interrupção, input e output tem tamanho máximo e validação.
- Terminal nunca injeta caracteres digitados no mesmo stdin do protocolo ACP.

**Aceite:** executar pwd, escrever arquivo, executar teste e verificar alteração via Files/Git; reload mantém shell e seu diretório enquanto container estiver ativo.

### F-011 — Arquivos e workspace (P0)

- Navegador de diretórios dentro de /workspace, com listagem, leitura de arquivos texto, download autorizado, criação básica e upload com limites.
- Path canonicalization e jail em /workspace; bloquear traversal, symlink escape e leitura arbitrária de diretórios sensíveis.
- Arquivos binários: download/preview apropriado, sem renderização perigosa.
- Edição de texto com revisão condicional (mtime/hash) para evitar overwrite cego de mudanças do agente.
- Eventos de modificação podem atualizar árvore/diff sem varredura agressiva; polling com debounce é fallback.
- Persistência durável de arquivos via snapshot + política de backup R2.
- Nunca armazenar tokens ou segredos em snapshots/artefatos acessíveis, nem clonar credenciais de produção no workspace.
- Limits por arquivo, upload total, extensão e tamanho global; valores configuráveis, testados e expostos antes do aceite.

### F-012 — Git e mudanças (P0 mínimo)

- Quando workspace contiver repositório Git, exibir branch atual, arquivos modificados/untracked, status e diff textual seguro.
- Operações de read/status/diff por frontend; comandos de escrita Git via terminal ou ferramenta do agente, com política correspondente.
- Clonar repositório público HTTPS é suportado na criação.
- Git pull/push, criação de PR e GitHub credentials automatizadas ficam P1; não inserir chave SSH pessoal no container.
- Encerrar/suspender não pode descartar silenciosamente mudanças sem checkpoint consistente.

### F-013 — Lifecycle pela interface (P0)

Ações explícitas: create, start, run, cancelRun, suspend, resume, stop, restart e delete. Mostrar operação pendente, progresso, erros, retry elegível e estado autoritativo atualizado.

Não permitir duplicar start enquanto STARTING. Parar uma sandbox com run ativo exige confirmação, preferindo cancelamento gracioso seguido de snapshot e stop. Delete exige confirmação forte e política de retenção clara. Não usar delete para remediar um recurso "desconhecido" sem reconciliá-lo.

### F-014 — Logs e observabilidade na UI (P0)

Timeline filtrável por eventos de sessão, run, sandbox, ACP, terminal, modelo e backup. IDs de correlação copiáveis. Os logs operacionais devem omitir segredos e mascarar dados sensíveis.

Mostrar explicitamente última sincronização, geração, versão do runtime, motivo do último erro e estado de backup. Diagnósticos devem distinguir: falha de backend, protocolo, processo Grok, infraestrutura Cloudflare, Workers AI, permissão, rede e filesystem.

### F-015 — Notificações e feedback (P0)

Toast/banner para estado persistente, não apenas sucesso otimista. A operação retorna ACCEPTED/PENDING quando ainda não terminou; SUCCESS somente após confirmação do backend. Ações perigosas exigem confirmação e fornecem operação rastreável.

### F-016 — Aplicações de preview (P1)

Encaminhar porta HTTP de servidor iniciado na sandbox, com URL autenticada e origem isolada, sem expor localhost ou porta arbitrária diretamente. Preview requer controle de URLs, expiração e bloqueio de SSRF. Não bloqueia a V1 se terminal e workspace funcionarem.

### F-017 — Telemetria de consumo (P1)

Mostrar contagem aproximada de chamadas/tokens e alertas de orçamento quando provider fornecer dados confiáveis. Nunca apresentar custo estimado como fatura real. Custos do container, Workers, DO, R2 e inferência são contabilizados separadamente quando disponíveis.

---

## 6. State machines detalhadas

### 6.1 SessionState

Estados:

- CREATED: registro existe; sandbox ainda não provisionada.
- PROVISIONING: runtime sendo solicitado/instalado.
- READY: runtime ACP saudável, aceita run novo.
- RUNNING: run ativo executando.
- WAITING_APPROVAL: agente espera autorização.
- IDLE: sem run ativo; runtime acessível.
- SUSPENDING: impedidos novos runs; checkpoint em progresso.
- SUSPENDED: container interrompido com recuperação registrada.
- RESUMING: recriando container/processo/contexto.
- STOPPING: fechamento em andamento.
- STOPPED: parada intencional sem contexto em memória.
- RECOVERING: estado inconsistente detectado, tentando reconciliar.
- DEGRADED: parcialmente operacional mas sem garantia de alguma capacidade essencial.
- FAILED: erro terminal da operação atual, recuperável ou não.
- DELETING: exclusão coordenada em andamento.
- DELETED: tombstone/recurso removido de acordo com retenção.

Transições válidas principais:

~~~text
CREATED -> PROVISIONING -> READY -> RUNNING -> IDLE
                                 RUNNING -> WAITING_APPROVAL -> RUNNING
                                 IDLE -> RUNNING
READY/IDLE -> SUSPENDING -> SUSPENDED -> RESUMING -> READY
READY/IDLE/SUSPENDED/FAILED -> STOPPING -> STOPPED
STOPPED -> RESUMING -> READY (se houver recovery válido)
qualquer estado operacional -> RECOVERING -> READY/IDLE/SUSPENDED/DEGRADED/FAILED
estado elegível -> DELETING -> DELETED
~~~

RUNNING para IDLE não implica desconectar terminal. WAITING_APPROVAL é status do run e projeção da sessão, não um estado independente do container. Backend define transições e emite version/updatedAt; cliente jamais muda autoritativamente estados locais.

### 6.2 SandboxState

ABSENT, STARTING, RUNNING, STOPPING, STOPPED, ERROR, UNKNOWN. Generation começa em 1 e incrementa a cada novo container. Toda operação em recurso físico deve trazer generation precondition para evitar efeitos de respostas atrasadas.

### 6.3 RunState

QUEUED_FOR_DISPATCH, DISPATCHING, RUNNING, WAITING_APPROVAL, CANCELLING, SUCCEEDED, FAILED, CANCELLED, TIMED_OUT, OUTCOME_UNKNOWN.

Um prompt pode estar aceito no banco e ainda não entregue ao Grok. DISPATCHING não equivale a RUNNING. OUTCOME_UNKNOWN impede retry automático com possíveis side effects. Status terminal SUCCEEDED/FAILED/CANCELLED/TIMED_OUT não é alterado retroativamente por um cliente.

### 6.4 OperationState

PENDING, EXECUTING, SUCCEEDED, FAILED, TIMED_OUT, OUTCOME_UNKNOWN, SUPERSEDED. Operações de lifecycle devem ser serializadas por sandbox e marcadas com expectedSessionVersion e generation.

### 6.5 TerminalState

CREATING, CONNECTED, DETACHED, RECONNECTING, EXITED, INVALIDATED. DETACHED mantém tmux apenas se container ainda existir. INVALIDATED sinaliza geração substituída.

### 6.6 Política de transições e concorrência

- Um run ativo por sessão.
- Um mutator de lifecycle por sessão/sandbox.
- Comando rejeitado com 409 se expectedVersion for diferente; resposta retorna estado atual.
- Se start já estiver em andamento, mesmo idempotency key retorna a mesma operation.
- Se o container cair durante tool call, não supor se o comando alterou filesystem; reconciliar Git/workspace e marcar estado incerto.
- Timeout de API não implica que operação não ocorreu.
- SessionState visível é projeção obtida de run/sandbox/operation states, persistida com version monotônico.
- Todos os estados terminais têm timestamp e reasonCode.

---

## 7. Fluxos end-to-end (comportamento normativo)

### FLOW-01 — Criar sessão vazia

1. Usuário autenticado abre Nova sessão.
2. Frontend envia modelo, origem de workspace e opções.
3. Backend autoriza, valida quota, cria sessionId e operationId transacionais.
4. Control Plane solicita provisionamento ao Worker com idempotency key.
5. DO cria/associa geração e inicia container da imagem pinada.
6. Inicializa /workspace e estado de saúde.
7. Inicia processo Grok ACP em listener privado; armazena secret de conexão fora do shell público.
8. ACP Adapter negocia initialize e session/new com cwd /workspace.
9. Persiste acpSessionId/capabilities/model, publica READY.
10. UI exibe sessão pronta e chat habilitado.

Falhas em qualquer etapa: publicar reasonCode, operation failed/degraded, compensar recursos criados se seguro. Não deixar sessão READY sem ACP funcional.

### FLOW-02 — Criar a partir de repositório

Após provisionamento, clonar URL HTTPS pública validada, resolver branch/ref, verificar checkout e conteúdo do /workspace, depois abrir ACP no diretório do repositório. Clonagem com origem/redirect restritos e política anti-SSRF. Falha de clone preserva diagnóstico e oferece repetir em workspace limpo.

### FLOW-03 — Enviar prompt

1. Cliente cria clientMessageId e Idempotency-Key.
2. Backend valida estado READY/IDLE, conteúdo, dono, quotas e concorrência.
3. Transação salva mensagem, Run QUEUED_FOR_DISPATCH e evento run.accepted.
4. Resposta HTTP 202 fornece runId.
5. Controller valida generation e despacha session/prompt uma vez.
6. Eventos ACP entram no log e aparecem no feed de UI.
7. Pedidos de aprovação param na política apropriada.
8. Resultado terminal ACP encerra o run; os dados são persistidos.
9. Backend envia confirmação de término e disponibiliza nova execução.

Cliente pode repetir HTTP após timeout com a MESMA Idempotency-Key sem criar novo run.

### FLOW-04 — Fechar aba durante execução

Processo ACP continua no container. Backend continua registrando eventos. Ao reabrir, UI lê snapshot/histórico e conecta feed a partir do cursor armazenado; renderiza eventos faltantes em ordem. Falha de rede não executa prompt novamente.

### FLOW-05 — Cancelar turno

Usuário pressiona Stop -> run passa a CANCELLING -> ACP recebe session/cancel se suportado -> aguarda ACK/status terminal. Se Grok continuar executando, aplicar timeout e escalonamento explícito (por exemplo, terminar processo/suspender sandbox quando autorizado), registrando side effects potencialmente incompletos. Cancelar somente o fetch do browser é insuficiente.

### FLOW-06 — Aprovar ferramenta

Agent pede permissão -> backend persiste approval pendente -> UI mostra comando e contexto -> usuário responde -> backend CAS de pending para decisão -> ACP recebe resposta -> run retoma ou falha. Timeout não pode resultar em aprovação automática.

### FLOW-07 — Terminal e alterações

Usuário escolhe Terminal -> solicita ticket -> Worker valida/consome ticket -> DO associa PTY/tmux na generation atual -> WebSocket recebe input e envia output. Mudanças em /workspace ficam visíveis em Files/Git; ao desconectar o navegador, shell não reinicia se tmux/container permanecerem ativos.

### FLOW-08 — Suspender

Bloquear novos runs -> verificar se run/approval está ativo -> exigir cancelamento/término ou confirmação de interrupção explícita -> flush event store -> checkpoint do workspace consistente -> salvar snapshot Cloudflare se disponível -> produzir backup R2 conforme política -> registrar ponteiros e checksums -> finalizar Grok/container -> marcar SUSPENDED somente quando o recovery path estiver definido e validado.

Se backup falhar, mostrar DEGRADED ou negar suspensão segura, conforme política. Nunca marcar SUSPENDED se a única cópia necessária foi descartada.

### FLOW-09 — Retomar após container desligado

Ler último checkpoint válido -> iniciar nova generation, restaurar snapshot quando válido ou reconstruir /workspace via R2 -> validar hash/estrutura -> reiniciar Grok -> negociar ACP -> tentar session/load/resume suportado pelo Grok. Se contexto ACP não for restaurável fielmente, oferecer replay/reidratação explícita e marcar CONTEXT_RECONSTRUCTED/DEGRADED; preservar histórico anterior e informar limitação. Restaurar arquivos NÃO significa restaurar processos, terminal anterior ou sockets.

### FLOW-10 — Recover de crash

Monitor detecta mismatch (por exemplo, sessão RUNNING, container parado) -> transition RECOVERING -> consulta fatos no DO, Cloudflare, Postgres e checkpoints -> determina última geração válida, último run e estado de side effects -> reconstitui runtime quando seguro -> run interrompido vira FAILED/OUTCOME_UNKNOWN com diagnóstico, nunca SUCCEEDED sem evidência.

### FLOW-11 — Stop/restart/delete

Stop: encerra corretamente processos, conexões e container, preservando backup requerido. Restart: encerra generation anterior, incrementa generation, restaura workspace e inicia novo Grok. Delete: bloqueia novas operações, confirma dono/admin, para runtime, revoga tickets, limpa recursos, aplica retenção e grava tombstone mínimo de auditoria; exclusão parcial permanece DELETING/FAILED e é reconciliável.

---

## 8. ACP Adapter e protocolo

### 8.1 Papel do adaptador

ACP Adapter é uma camada exclusiva do servidor/DO entre protocolo Grok e domínio GrokBot. Não é um chat bot genérico que decide ferramentas localmente; o **Grok Build é quem orquestra as ferramentas do coding agent**. O adaptador preserva envelope JSON-RPC, correlaciona request IDs, session IDs, permission requests e run IDs, gerencia reconexão do transporte e traduz eventos de exibição.

### 8.2 Requisitos P0

- Handshake initialize com capabilities reais, sem presumir extensão de uma versão futura.
- session/new no workspace correto; session/load/resume só quando suportado.
- session/prompt contendo blocos estruturados aceitos pelo agente.
- session/update incremental com conservação dos tipos de evento.
- session/cancel aplicado a run correto.
- Pedidos de permissão e respostas com correlation ID.
- Timeout e retry de conexão com backoff exponencial e jitter.
- Observabilidade da disponibilidade do Grok separada da disponibilidade do container.
- Raw event archival com versão de parser para reprocessamento.
- Normalização de erros de protocolo versus de modelo.
- Lista de capabilities devolvida pelo initialize salva por acpSession e exibida em diagnósticos.
- Extensões x.ai/ são opcionais e protegidas por feature detection.
- Mensagens JSON-RPC jamais passam diretamente do browser para listener Grok sem autorização de método/escopo.
- Não expor a porta ACP em IP público. Preferir listener loopback ou acesso privado mediado pelo Worker, com secret autenticado.

### 8.3 Adaptador mínimo de eventos

| ACP | Domain event | UI |
|---|---|---|
| session/update: agent_message_chunk | assistant.text.delta | Bolha de texto |
| session/update: tool_call | tool.started | Card de ferramenta |
| session/update: tool_call_update | tool.updated | Progresso/resultado |
| session/update: plan | agent.plan.updated | Plano/tarefas |
| permission request | approval.requested | Ação Aprovar/Negar |
| resposta de prompt | run.completed | Estado final |
| transport closed | agent.transport.disconnected | Reconexão/diagnóstico |
| process exited | agent.process.exited | Recover/run incerto |
| extensão desconhecida | agent.raw_event | Timeline genérica |

Thought/reasoning streams devem ser tratados conforme capacidades do protocolo, política e privacidade; a UI **não** deve inventar ou reconstruir raciocínio oculto. Não exigir exposição de informação de raciocínio não fornecida pelo agente/provedor.

### 8.4 Modos de execução

Primário: grok agent serve em porta privada WebSocket com secret. Diagnóstico: grok agent stdio com stdin/stdout dedicados e framing JSON-RPC. Não misturar mensagens de stdout do protocolo com logs de shell. Instalar versão estável pinada do CLI na imagem; validar comando com grok version e handshake smoke test. Mudanças de sintaxe entre versões exigem atualização da documentação e testes.

### 8.5 Configuração de modelo

Configurar custom model no arquivo de config do Grok da imagem/usuário de serviço, com endpoint OpenAI-compatible/proxy. Não copiar exemplo com conta/token real para git. Workers AI e API compatibility são condição necessária, mas GATE de tool calling e streaming é condição suficiente para liberar modelo na V1.

---

## 9. Cloudflare Sandbox Runtime

### 9.1 Componentes

- Worker de ingress para operações API e upgrades WebSocket.
- Durable Object Controller, instanciado por identidade opaca de sandbox.
- Container Linux a partir de imagem pinada e reproduzível.
- SDK 1.0 e APIs atuais de ctx.container (start, exec, signals, processo/PTY, snapshots conforme disponibilidade).
- Helpers Files quando necessários, sem depender de abstrações 0.x.
- R2 para backups duráveis de /workspace.
- Workers AI e credenciais no plano confiável.

### 9.2 Contrato de runtime interno

Métodos internos tipados (nomes da nossa aplicação, não nomes de SDK Cloudflare):
- provision(sessionId, imageDigest, policy, expectedVersion)
- start(sandboxId, expectedGeneration, operationId)
- ensureAgentReady(sandboxId, generation)
- dispatchRun(sandboxId, runId, prompt, acpSessionId)
- cancelRun(sandboxId, runId)
- attachTerminal(sandboxId, terminalId, ticket)
- inspectWorkspace(sandboxId, safePath)
- snapshotWorkspace(sandboxId, checkpointId)
- restoreWorkspace(sandboxId, backupId)
- stop(sandboxId, reason, policy)
- reconcile(sandboxId)

Todas as chamadas devem validar assinatura de serviço, ownership associado e limites, com resposta tipada e correlation IDs.

### 9.3 Imagem

Linux Debian/Node suportado; inclui Grok Build pinado, tmux, git, shell, CA certificates, runtime de projeto inicial e usuário não privilegiado quando viável. Evitar docker.sock e privilégios desnecessários. A imagem publica build tag e digest; o digest usado por cada generation fica no banco. Healthcheck verifica toolchain e processo ACP.

### 9.4 Lifecycle da instância

- Política de inatividade configurável; sessões RUNNING não devem expirar apenas porque navegador fechou.
- Quando inativo sem run, política pode checkpointar e suspender.
- O controller precisa tolerar recomeço do Durable Object e recuperar seus alarmes/estado.
- Snapshots são beta e expirados eventualmente; R2 é componente independente de retenção.
- Recriação após stop significa novo processo e nova generation.
- Controle de concorrência e quotas no backend antes de provisionamento e confirmado no runtime.
- Nunca liberar sandbox como RUNNING antes de healthcheck e initialize ACP.

### 9.5 Rede e secrets

Por padrão, deny-by-default para destinos desnecessários. Permitir provedores de pacote/Git necessários conforme política explícita; registrar bloqueios. Workers AI acessado por proxy controlado, sem chaves no shell. Restringir metadata/endpoints internos e impedir SSRF, inclusive via URL de clone e redirecionamentos.

Se o SDK limitar interceptação/egress em um cenário concreto, esse fato vira bloqueio arquitetural, não bypass silencioso. Comandos executados pelo usuário têm natureza perigosa mesmo em ambiente isolado: recursos internos e rede precisam de segmentação real.

---

## 10. Persistência, esquema proposto e integridade

Manter tabelas existentes User, Chat, Message_v2, Stream e documentos quando possível, adicionando entidades relacionadas de forma incremental.

### 10.1 Tabelas

| Tabela | Colunas essenciais (conceituais) | Índices/regras |
|---|---|---|
| agent_sessions | id, owner_id, title, state, state_version, current_generation, current_run_id, model_id, permission_policy, created_at, updated_at, deleted_at | PK id; owner+updatedAt; state |
| sandboxes | id, session_id, provider, do_name, image_digest, generation, state, region_optional, started_at, stopped_at, last_heartbeat, last_error | unique session; unique (id,generation) |
| acp_sessions | id, session_id, generation, protocol_session_id, protocol_version, capabilities_json, state, created_at | session+generation |
| agent_runs | id, session_id, acp_session_id, idempotency_key, request_hash, model_id, state, last_event_seq, started_at, ended_at, finish_reason, error_code | unique session+idempotency_key |
| session_events | id, session_id, seq, generation, run_id, type, payload_version, payload_json, created_at | unique (session_id,seq); unique id |
| tool_approvals | id, session_id, run_id, tool_call_id, prompt_json, state, decision, decided_by, expires_at | unique agent request ID |
| terminal_sessions | id, session_id, generation, tmux_name, state, owner_id, created_at, updated_at | unique session+generation+tmux_name |
| workspace_backups | id, session_id, generation, source_revision, kind, cloudflare_snapshot_id, r2_key, checksum, status, created_at, verified_at | session+createdAt |
| session_operations | id, session_id, idempotency_key, kind, expected_version, generation, state, error_code, created_at, finished_at | unique session+kind+idempotency_key |
| audit_events | id, actor_id, session_id, action, target, result, metadata_sanitized, created_at | actor+date; session+date |
| session_access_tokens | jti_hash, session_id, terminal_id, generation, expires_at, used_at, revoked_at | unique jti_hash; TTL cleanup |

Tipos concretos PostgreSQL/Drizzle e migrations ficam a cargo da implementação, preservando constraints de FK, cascade seguro e tombstones necessários. Secrets não entram em payload_json.

### 10.2 Event sequencing e durabilidade

A fonte canônica de eventos confirmados será PostgreSQL. Um único writer lógico por sessão (controller) ordena os eventos; a ingestão transacional faz dedupe e aloca/valida seq monotônico. O DO não publica event como "persisted" antes do ACK transacional. Se a ingestão estiver offline, guardar WAL/buffer durável e limitado no DO, reentregando pelo eventId. O replay do browser usa somente eventos confirmados na fonte canônica.

**Duas garantias diferentes:**
- Entrega de eventos: at-least-once, com deduplicação por eventId.
- Execução de comandos com side effects: no máximo uma tentativa de dispatch não ambígua por run; em timeout de ACK, reconciliar antes de decidir novo dispatch.

Não prometer exactly-once físico de execução de shell/network operations.

### 10.3 Política de retenção V1 (defaults propostos)

- Histórico de chat e registros de sessão: até exclusão explícita pelo dono/admin, sujeitos a política interna.
- Eventos detalhados: retenção configurável; default inicial 30 dias após último evento, desde que chat reconstruível mantenha seus dados essenciais.
- Backups R2: reter pelo menos último backup completo validado e checkpoints recentes conforme espaço disponível; valor final por política central.
- Terminal scrollback: limitado, separado de histórico de chat, sem garantia de persistência integral após stop.
- Tokens: TTL curto e exclusão/expiração automática.
- Delete: apagar workspace/backups conforme contrato, respeitando limitações de remoção física de snapshots beta; registrar limpeza pendente e não afirmar erase completo se fornecedor não confirmar.

Valores acima são políticas de produto propostas; expor configuráveis e validar custo/quota antes do deploy.

### 10.4 Backup e recovery

Checkpoint consistente precisa incluir: workspace, referência ao run/seq final, geração, imagem/modelo, commit/branch Git e identificadores ACP recuperáveis. Snapshot Cloudflare acelera restore enquanto válido. Exportação de diretório via R2 fornece durabilidade independente. Checksum/manifest garante integridade. Verificação pós-restore lê arquivos críticos e confirma equivalência com manifest.

Se não houver backup utilizável e o container estiver perdido, marcar RESTORE_UNAVAILABLE e explicar o limite; jamais inventar arquivos ou sucesso.

---

## 11. API pública proposta da aplicação

Prefixo: /api/sessions. Todas as rotas são autenticadas e validadas com Zod/contratos compartilhados. Exemplos representam o contrato pretendido e serão versionados.

| Método | Path | Objetivo | Resposta esperada |
|---|---|---|---|
| POST | /api/sessions | Criar | 201 session + operation |
| GET | /api/sessions | Listar do usuário | 200 cursor paginado |
| GET | /api/sessions/:id | Detalhes | 200 snapshot |
| PATCH | /api/sessions/:id | Renomear/opções permitidas | 200 version |
| POST | /api/sessions/:id/start | Provisionar/iniciar | 202 operation |
| POST | /api/sessions/:id/suspend | Checkpoint/suspender | 202 operation |
| POST | /api/sessions/:id/resume | Retomar | 202 operation |
| POST | /api/sessions/:id/stop | Parar | 202 operation |
| POST | /api/sessions/:id/restart | Reiniciar | 202 operation |
| DELETE | /api/sessions/:id | Excluir | 202 operation |
| POST | /api/sessions/:id/messages | Criar run/prompt | 202 run |
| GET | /api/sessions/:id/messages | Histórico | 200 paginado |
| GET | /api/sessions/:id/runs | Runs | 200 paginado |
| GET | /api/sessions/:id/runs/:runId | Estado do run | 200 |
| POST | /api/sessions/:id/runs/:runId/cancel | Cancelar ACP | 202 operation |
| POST | /api/sessions/:id/approvals/:approvalId | Decisão aprovação | 200/409 |
| GET | /api/sessions/:id/events?after=... | Replay/SSE | 200 |
| GET | /api/sessions/:id/operations/:operationId | Progresso | 200 |
| POST | /api/sessions/:id/terminals | Criar terminal | 201 terminal |
| POST | /api/sessions/:id/terminals/:terminalId/ticket | Ticket WS | 200 ticket curto |
| GET | /api/sessions/:id/files?path=... | Listar/ler autorizado | 200 |
| PUT | /api/sessions/:id/files?path=... | Atualizar com revisão | 200/409 |
| GET | /api/sessions/:id/git/status | Git status | 200 |
| GET | /api/sessions/:id/git/diff | Diff | 200 |
| GET | /api/sessions/:id/backups | Backups | 200 |

### 11.1 Exemplo create session

~~~json
{
  "title": "Refatorar API",
  "modelId": "@cf/openai/gpt-oss-120b",
  "workspace": { "kind": "empty" },
  "permissionMode": "ask",
  "runtimeProfile": "default"
}
~~~

Resposta:

~~~json
{
  "sessionId": "uuid",
  "state": "CREATED",
  "stateVersion": 1,
  "operation": {
    "id": "uuid",
    "kind": "START",
    "state": "PENDING"
  }
}
~~~

### 11.2 Exemplo enviar mensagem

~~~json
{
  "clientMessageId": "uuid",
  "parts": [{ "type": "text", "text": "Analise este repositório e rode os testes." }],
  "expectedSessionVersion": 7
}
~~~

Header: Idempotency-Key com UUID gerado no cliente. Resposta:

~~~json
{
  "runId": "uuid",
  "sessionId": "uuid",
  "state": "QUEUED_FOR_DISPATCH",
  "acceptedAt": "2026-10-09T00:00:00Z"
}
~~~

### 11.3 Envelope de evento

~~~json
{
  "v": 1,
  "eventId": "uuid",
  "sessionId": "uuid",
  "seq": 143,
  "generation": 2,
  "runId": "uuid",
  "type": "tool.updated",
  "occurredAt": "2026-10-09T00:00:03Z",
  "payload": {
    "toolCallId": "tool-4",
    "status": "completed",
    "title": "Run tests"
  }
}
~~~

### 11.4 Modelo de erro

~~~json
{
  "error": {
    "code": "SESSION_NOT_READY",
    "message": "A sandbox ainda não está pronta para executar este prompt.",
    "retryable": true,
    "details": { "state": "PROVISIONING" },
    "correlationId": "uuid"
  }
}
~~~

Códigos mínimos: UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, VALIDATION_ERROR, RATE_LIMITED, SESSION_NOT_READY, RUN_ALREADY_ACTIVE, VERSION_CONFLICT, APPROVAL_EXPIRED, SANDBOX_UNAVAILABLE, AGENT_NOT_READY, ACP_PROTOCOL_ERROR, MODEL_UNAVAILABLE, INFERENCE_QUOTA, WORKSPACE_BACKUP_FAILED, RESTORE_UNAVAILABLE, OPERATION_OUTCOME_UNKNOWN, INTERNAL_ERROR.

HTTP status deve refletir o tipo (400, 401, 403, 404, 409, 422, 429, 502, 503, 504). 202 significa aceito, não concluído. Nunca devolver stack trace ou credenciais ao usuário.

### 11.5 WebSockets

WebSocket de terminal termina no ingress Cloudflare autorizado. Ticket efêmero obtido pela API, escopo restrito, consumo único, TTL sugerido de 60 segundos, vínculo generation e revogação quando stop/delete. Transportar ticket sem expô-lo a logs de URL quando possível; validar Origin e protocolo/subprotocolo. Evitar token persistente em query string.

A conexão ACP interna é distinta da conexão de terminal, e nenhuma deve ser encaminhada diretamente como raw proxy irrestrito ao navegador.

---

## 12. UI / UX: estados de tela e affordances

### 12.1 Sidebar
- Nova sessão (CTA principal).
- Busca, filtros de status, lista recente.
- Status pill por sessão e indicador de atividade.
- Menu: renomear, retomar, suspender, parar, excluir.

### 12.2 Workspace principal
- Chat com mensagens estáveis e ferramentas expandíveis.
- Composer com anexo, envio, cancelar e indicação de modelo.
- Se offline: banner reconectando; composer bloqueado se não houver garantia de aceite.
- Se parada: CTA "Retomar sessão" e histórico em read-only.
- Se solicitação de permissão: card persistente destacado, sem interromper leitura.
- Timeline de runs com duração e motivo de conclusão.

### 12.3 Painel lateral/inferior
- Terminal / Files / Git / Activity / Backups, responsivo e redimensionável.
- Ocultar painel não encerra PTY.
- Contexto de painel pertence à sessão selecionada; não exibir terminal da sessão anterior durante troca.
- Troca de generation invalida tickets e indica novo terminal.

### 12.4 Estados especiais
- Empty: sessão não criada / nenhum run.
- Provisioning: etapas reais sem progress bar percentual fictício.
- RUNNING: indicador de heartbeat e ação Stop.
- Waiting Approval: detalhamento de impacto e ações.
- DEGRADED: erro parcial com capacidades restantes.
- Recovery: última etapa confirmada e operaçãoId.
- FAILED: diagnóstico, opção de retry seguro e link para logs.
- DELETED: navegação volta ao dashboard sem recursos acessíveis.

### 12.5 Acessibilidade e dispositivos
- Breakpoints responsivos para desktop/tablet/mobile.
- Terminais pequenos preservam usabilidade por aba fullscreen.
- Botões têm aria-label e foco visível.
- Feedback de streaming via aria-live de frequência limitada para não sobrecarregar leitor de tela.
- Atalhos não bloqueiam funcionalidades básicas do terminal.
- Suspensão/restart/delete exigem controles acessíveis e confirmação.

---

## 13. Política de falhas e contingências

| Falha | Detecção | Comportamento obrigatório | Recuperação |
|---|---|---|---|
| Navegador desconectou | WebSocket/SSE fechado | Run continua; UI offline | Replay por seq |
| Aba fechou | Nenhum heartbeat de cliente | Run não é cancelado | Reabrir sessão |
| Next.js reiniciou | Erros temporários API | DO e Grok continuam se runtime saudável | Reconnect/reconcile |
| Worker indisponível | Timeout/S2S | Operação fica pendente/incerta | Retry de leitura; sem duplicar execução |
| DO reiniciou | Novo init/rehydration | Recarrega estado e container generation | Reconcile runtime |
| Grok morreu | Exit/healthcheck | Run FAILED/UNKNOWN; não SUCCESS | Reiniciar agente, reidratar contexto |
| Container morreu | Estado real/healthcheck | Session RECOVERING | Restaurar backup + nova generation |
| ACP disconnect | Heartbeat/protocol close | Não inventar fim de turno | Reconnect e consultar sessão |
| Workers AI falhou | Erro de endpoint | Run falha com causa clara | Retry só conforme semântica segura |
| Tool call timeout | Falta ACK/terminal state | OUTCOME_UNKNOWN se side effect incerto | Inspecionar arquivos/Git, confirmação usuário |
| Approval duplicada | CAS falha | Segunda decisão recebe 409 | Ler decisão atual |
| Backend DB offline | Falha ingestão | DO buffer limitado, estado DEGRADED | Flush e dedupe após retorno |
| Backup Cloudflare expirado | Restore falha | Testar alternativa R2 | R2 restore ou RESTORE_UNAVAILABLE |
| R2 indisponível | Falha de backup | Não descartar única cópia | Manter runtime ou falha segura |
| Terminal disconnect | WS closed | tmux persiste se runtime vivo | Ticket novo/reattach |
| Terminal da geração antiga | generation mismatch | 409/410; não conectar em runtime errado | Criar terminal na nova generation |
| Quota excedida | Check antes de start | 429/limit error sem provisionar | Limpar/encerrar sessões ociosas |
| Duas abas iniciam run | Conflito de run ativo | Uma recebe 202, outra 409 | UI sincroniza estado |
| Stop durante snapshot | Operações serializadas | Não iniciar stop conflitante | Aguardar/abortar explicitamente |
| Delete parcial | Operação em falha | Tombstone + cleanup pendente | Reconciler tenta remover recursos |

Reconciler deve ser acionado na leitura de estado incoerente, restart de worker/DO, watchdog periódico e execução de operações pendentes. Não depender unicamente de cron que pode ser atrasado.

### 13.1 Invariantes de segurança e consistência

- Nunca dois owners para uma sandbox.
- Nunca dois runs RUNNING da mesma sessão.
- Nunca reutilizar terminal ticket entre sessions/generations.
- Nunca marcar SUCCEEDED com ausência de confirmação ACP.
- Nunca marcar BACKUP_VERIFIED sem checksum e inspeção básica.
- Nunca excluir última cópia durável sem confirmação/retention policy.
- Nunca executar o mesmo request ambíguo apenas porque cliente fez retry.
- Nunca entregar evento de geração antiga como sendo da geração atual.
- Nunca expor credenciais de infraestrutura em logs ou filesystem do agente.

---

## 14. Segurança e threat model

### 14.1 Atores e superfícies

Atores: usuário autorizado, usuário não autorizado, código gerado pelo agente, ferramenta externa, dependência comprometida, evento falsificado, atacante de rede, operador administrativo. Superfícies: login, rotas Next, ingress Worker, DO, container, shell, ACP, proxy de inferência, Git clone, upload, preview e R2.

### 14.2 Controles P0

1. Isolamento por container/session, identidade opaca e autorização no servidor.
2. Separação entre segredos administrativos e filesystem/shell não confiável.
3. CSP, sanitização de Markdown e outputs do terminal.
4. Validação rigorosa de paths, URLs de clone e redirects; proteção SSRF.
5. Limites de tempo, memória, disco, tokens e número de processos/sessões.
6. Proteção de WebSocket upgrade com ticket one-time e Origin check.
7. Policy-based command approval e modo ASK default.
8. Logs auditáveis de ações sensíveis, sem armazenar tokens completos.
9. Egress mínimo necessário e proibição de acesso a redes/metadados internos.
10. Dependências e CLI pinados, scanner da imagem/lockfiles.
11. Upload validation, limites e tratamento de binários suspeitos.
12. CSRF e verificação de ownership em todas as rotas que mutam estado.
13. Hardening de headers e nenhum segredo em NEXT_PUBLIC.
14. Endpoints internos S2S com credencial rotacionável, audiência/escopo e replay protection.
15. Revogação de tickets, links e acesso ao excluir/parar/suspender.
16. Administração e remoção com confirmação e event trail.

### 14.3 Restrições explícitas

- Não conceder ao agent acesso ao token pessoal de GitHub, token global Cloudflare ou credenciais de banco.
- Não habilitar modo yolo/always-approve como default.
- Não montar Docker socket/hardware ou diretórios internos da infraestrutura por conveniência.
- Não confiar em prompts como boundary de autorização.
- Não supor que sandbox isenta riscos de exfiltração via internet.
- Não habilitar recurso guest do template para execução.
- Não permitir que browser escolha sandboxId arbitrário e conecte sem checagem de ownership.

### 14.4 Segurança de modelos

Respostas do Workers AI são conteúdo não confiável, e tool calls podem causar modificações. Policies de ferramentas prevalecem sobre sugestão do modelo. O agente não controla auth, quotas, fechamento de registros nem governança do runtime.

---

## 15. Requisitos não funcionais e metas iniciais

Metas da V1 são critérios de medição a validar em ambiente real, não SLAs contratuais:

| NFR | Alvo proposto | Medição |
|---|---|---|
| NFR-01 | 0 perda de eventos já confirmados no cenário de refresh/reconnect | E2E com cursor e dedupe |
| NFR-02 | 0 run duplicado por retry com mesma idempotency key | Integração/concurrency |
| NFR-03 | 0 acesso cross-user em endpoints, eventos e terminais | Testes negativos |
| NFR-04 | Terminal utilizável com input e output em tempo real | E2E com PTY real |
| NFR-05 | Latência adicional do pipeline de eventos, sem inferência, p95 alvo <= 2s | Telemetria de evento até UI |
| NFR-06 | Conexão de terminal reconecta após falha transitória sem perder a sessão tmux | Chaos test |
| NFR-07 | Restauro de workspace produz checksum igual ao backup validado | E2E snapshot/R2 |
| NFR-08 | Todos os comandos de lifecycle produzem operação rastreável e final | Suite de transições |
| NFR-09 | UI funcional mobile e desktop, sem overflow horizontal acidental | Playwright viewport matrix |
| NFR-10 | Sem segredo no log, bundle web ou mensagem | Secret leak checks |
| NFR-11 | Testes unit, integrações, typecheck, lint, build, E2E passam | CI com relatório |
| NFR-12 | Projeto suporta inicialmente pelo menos 2 sessões ativas simultâneas em teste | Load smoke com recursos reais |

Definir budgets concretos de disponibilidade, tempo de provisionamento, RPO/RTO, quotas e custo após benchmark das capacidades/preços do plano Cloudflare e dimensões de imagem. Não inventar tempos/valores na spec.

---

## 16. Configuração e deployment

### 16.1 Ambientes

Local/dev: frontend Next.js e serviços de controle com simulação de provider para testes unitários; ambiente de integração separado com Cloudflare real. Staging: Worker, Durable Object, R2, banco e modelo configurados com segredos próprios. Production interno: instalações e credenciais distintas, observabilidade e limits.

Simulação nunca pode ser considerada prova de GATE Cloudflare/ACP. CI E2E integrado precisa validar provedores reais quando secrets estiverem disponíveis, e indicar SKIPPED quando não estiverem.

### 16.2 Variáveis e secrets (nomes sugeridos)

- DATABASE_URL / POSTGRES_URL — PostgreSQL do app;
- AUTH_SECRET — Auth.js;
- CLOUDFLARE_ACCOUNT_ID — identificação não secreta da conta;
- WORKER_RUNTIME_BASE_URL — endereço interno/autorizado do Worker;
- CONTROL_PLANE_SERVICE_SECRET — autenticação S2S;
- CLOUDFLARE_AI_TOKEN — **somente Worker secret**, nunca browser/shell;
- R2 bucket binding — backup de workspace;
- GROK_AGENT_SECRET — gerado e rotacionado por sandbox/generation, isolado do terminal genérico;
- ALLOWED_MODEL_IDS — allowlist de modelos com gates aprovados;
- MAX_ACTIVE_SANDBOXES, MAX_RUN_DURATION, INACTIVITY_TIMEOUT, MAX_EVENTS_BUFFERED, MAX_UPLOAD_BYTES — políticas;
- FEATURE_AGENT_RUNTIME, FEATURE_TERMINAL, FEATURE_SNAPSHOT — rollout.

As grafias exatas de env/bindings e onde vivem dependem do deployment; não duplicar secrets em lugares desnecessários. Documentar rotação e revogação.

### 16.3 Migrations e deploys

Migrations expansivas primeiro, rollout de código depois, limpeza de schema apenas depois de compatibilidade confirmada. Deploy do frontend não reinicia deliberadamente containers em execução. Upgrade de imagem afeta novas generations; sessões existentes registram digest antigo até restart controlado.

### 16.4 Rotinas operacionais

Runbooks obrigatórios:
- iniciar infraestrutura e executar smoke;
- interpretar erro de provisioning;
- revogar ticket ou credencial comprometida;
- recuperar sessão com container perdido;
- testar restauração R2;
- lidar com serviço de eventos indisponível;
- limpar recursos órfãos;
- parar todas as sandboxes por emergência;
- coletar logs sem revelar secrets;
- rollback de control plane e imagem.

---

## 17. Métricas, eventos de auditoria e suporte

Métricas mínimas: sessões por estado, containers ativos, tempo de start, runs ativos, duração de runs, taxa de erro ACP, quedas de WebSocket, lag de event ingestion, tamanho de backlog DO, retries e reconciliations, falha de snapshots/R2, erros modelo/quota, terminal sessions ativas e uso por usuário.

Trace/correlation: requestId, operationId, sessionId, sandboxId, generation, acpSessionId, runId, toolCallId, eventId. Logs sanitizados e rastreáveis de ponta a ponta entre Next, Worker/DO, Container e proxy AI.

Alertas internos: resources orphaned, events backlog acima do limite, backup recorrente falhando, número anormal de containers ativos, run sem progresso além do limite e falha de proxy AI.

---

## 18. Testes e matrizes de aceite

### 18.1 Pirâmide de testes

**Unit:** Zod schemas, reducers event log, state machine, idempotência, paths, quotas, ACP event mapper, errors.  
**Contract:** Next API, Worker, DO, WebSocket protocol, OpenAI-compatible proxy e versões do ACP.  
**Integration:** Postgres real, runtime Cloudflare real, Grok CLI real, modelo Workers AI testado, R2.  
**E2E:** Playwright usuário real autenticado, mobile e desktop, sessões simultâneas, falhas provocadas.  
**Chaos:** matar Grok, desconectar browser, reiniciar frontend, parar container, falhar event ingestion, expirar snapshot e duplicar requests.

### 18.2 Critérios em formato Given/When/Then

**AT-001 Criar:** Dado usuário autorizado, quando cria sessão, então há sessionId/operationId persistidos e somente READY após ACP handshake.

**AT-002 Chat real:** Dada sessão READY com modelo Workers AI válido, quando envia prompt, então Grok processa a solicitação, executa ferramenta permitida e retorna eventos até estado terminal verificável.

**AT-003 Não duplicar:** Dado envio aceito, quando cliente repete o mesmo request com mesma chave, então recebe o mesmo runId e nenhuma segunda execução lógica.

**AT-004 Replay:** Dado run ativo, quando página fecha e reabre, então recebe histórico e eventos faltantes, sem perda de eventos confirmados nem duplicação visual.

**AT-005 Cancelamento:** Dado run longo, quando Stop é solicitado, então backend tenta cancelar efetivamente no ACP, registra confirmação/timeout e não apenas interrompe streaming do browser.

**AT-006 Aprovação:** Dado pedido de ferramenta perigosa, quando usuário nega, então Grok recebe negativa e nenhuma ferramenta negada é executada por esse approval.

**AT-007 Concorrência:** Dadas duas abas enviando prompts simultâneos à mesma sessão, então só um run é admitido e a outra recebe 409 ou resultado idempotente compatível.

**AT-008 Terminal:** Dada sandbox RUNNING, quando usuário abre shell, cria arquivo e recarrega página, então o mesmo tmux permanece disponível e o arquivo aparece em Files.

**AT-009 Isolamento:** Dados usuários A e B, quando B usa IDs de A, então B não lê mensagens, arquivos, eventos, terminal, backups nem faz lifecycle em sessão de A.

**AT-010 Suspender/retomar:** Dada sessão IDLE com arquivos criados, quando suspende e retoma depois da parada real, então os arquivos preservados têm hash esperado, nova generation e ACP reaberto.

**AT-011 Crash agente:** Dado Grok morto no meio de run, então resultado não vira SUCCEEDED sem prova; UI recebe estado apropriado, diagnóstico e ação de recovery.

**AT-012 Crash container:** Dada instância perdida com backup disponível, quando recovery ocorre, então uma nova generation inicia sem aceitar evento antigo como atual.

**AT-013 Backup indisponível:** Dado snapshot expirado e R2 inválido/indisponível, quando restore é tentado, então UI mostra RESTORE_UNAVAILABLE; nenhuma indicação falsa de sucesso.

**AT-014 Stop/delete:** Quando encerrar ou excluir sessão, então processos/tickets/links são revogados, recursos reconciliados e o estado final é auditado.

**AT-015 Responsive:** Com viewport mobile, usuário alterna Chat/Terminal/Files, usa shell e aprova tools sem componentes inacessíveis.

**AT-016 Secrets:** Inspecionar logs, HTML, bundle e /workspace não revela CLOUDFLARE_AI_TOKEN, AUTH_SECRET nem service secret.

### 18.3 Gates bloqueantes de implementação

| Gate | Prova exigida | Critério |
|---|---|---|
| G01 | Grok Build custom model Workers AI | Prompt + tool call + resultado real funcionando |
| G02 | Protocolo ACP | Initialize/new/prompt/update/cancel/permission validados |
| G03 | Cloudflare Sandbox 1.0 | Container versionado criado e encerrado por DO |
| G04 | Terminal PTY | Input/output, resize, Ctrl+C e reconnect funcionando |
| G05 | Persistência | Replay após refresh e queda de frontend |
| G06 | Recuperação | Reinício real do container com workspace recuperado |
| G07 | Segurança | Cross-user, ticket, secret e path traversal bloqueados |
| G08 | Lifecycle | Create/start/suspend/resume/stop/restart/delete idempotentes |
| G09 | CI | Typecheck, lint, unit, integration e E2E relevantes aprovados |
| G10 | Produto | Fluxo completo demonstrado sem operador usar CLI manual |

Todo gate terá evidência de comandos/testes, versões pinadas, logs sanitizados, screenshot quando relevante, data, commit e environment. Um SKIPPED não equivale a PASS.

---

## 19. Roadmap de implementação sugerido

### M01 — Contracts e fundação
- Definir entidades, IDs, estados, Zod schemas, schemas de evento.
- Criar migrations, queries, auth/permission boundaries e feature flags.
- Criar session CRUD + dashboard básico e testes.
- DoD: persistência + state machine sem container real.

### M02 — Cloudflare Runtime
- Worker ingress, DO, Container image, secrets e deployment staging.
- Provisioning/start/stop/health, idempotency, quotas e logs.
- DoD: container real e shell command simples, lifecycle instrumentado.

### M03 — Grok ACP + Workers AI
- Instalar/pinar Grok, custom model proxy, negotiate ACP.
- Iniciar/retomar sessão ACP, prompt de teste e tool call.
- DoD: G01/G02 comprovados; incompatibilidade documentada como blocker.

### M04 — Chat definitivo
- API runs, ingestão/replay de eventos, UI adapter, histórico, stop, approvals.
- DoD: chat real com refresh, reconexão, cancelamento e approvals.

### M05 — Terminal e arquivos
- xterm.js, tmux, tickets WS, file browsing, upload, Git status/diff.
- DoD: comandos reais persistem após reload na sandbox ativa.

### M06 — Snapshots, R2 e recovery
- Checkpoint, backup, restore, geração, reconciler e runbooks.
- DoD: crash/restart/suspend/resume testados, sem promessa de processo vivo.

### M07 — Hardening e validação
- Auditoria, limites, observabilidade, segurança, mobile, testes de caos, CI.
- DoD: G01–G10 aprovados e demo de ponta a ponta.

Dependência crítica: M01 -> M02 -> M03 -> M04. M05 e M06 podem evoluir após contratos estáveis de M02, mas M07 depende de todas. Não avançar cosmeticamente para UX final enquanto G01 permanecer não comprovado.

### 19.1 Planos de contingência

- **Plano A:** Grok ACP WebSocket + Workers AI direto via proxy, Sandbox 1.0.
- **Plano B:** se WebSocket ACP do Grok falhar, usar stdio interno e adaptar multiplexação/reconexão do lado servidor, preservando mesmos contratos de UI; não regredir a chat só-texto.
- **Plano C:** se um modelo Workers AI for incompatível com tools, testar alternativa Workers AI oficialmente suportada e habilitar somente após G01; não trocar silenciosamente para serviço externo.
- **Plano D:** se snapshot beta não for confiável, usar backup/restauração R2 como mecanismo durável principal e checkpoint Cloudflare como otimização; documentar redução de performance/latência.
- **Plano E:** se interceptação de egress não satisfizer política, bloquear a implantação até desenvolver proxy autenticado que não exponha credenciais.

Contingência não concede autorização implícita para desativar segurança ou mudar o requisito "modelo Cloudflare".

---

## 20. Dependências e questões abertas antes de iniciar features específicas

### 20.1 Dependências técnicas

- Conta com Workers Paid e autorização para Containers/DO, R2 e Workers AI.
- Projeto/rotas Next.js e banco PostgreSQL configurados por ambiente.
- Imagem Grok Build distribuível e inicializável por CLI em container sem login interativo, ou solução suportada com token de autenticação não exposto.
- Versão Grok que aceite custom model e ACP transport.
- Modelo Workers AI capaz de chamadas de ferramentas exigidas pelo harness.
- Domínios/endpoints e certificados para WebSocket/SSE.
- Política de egress compatível com instalar dependências, Git público e inferência.
- Backup/R2 e retenção aprovados antes de habilitar suspensão automática.

### 20.2 Open questions (decisões antes do respectivo milestone)

- Q01 — Qual versão/digest específico do Grok Build será fixado? Validar changelog e licença.
- Q02 — Qual modelo Workers AI tem melhor compatibilidade real com ferramentas Grok? Fazer benchmark funcional G01, não somente inferência textual.
- Q03 — Qual formato de contexto/sessão do Grok permanece restaurável entre processos? Testar session/load/resume e localização de state files.
- Q04 — Qual configuração real de CPU/RAM/disco cabe no orçamento? Medir baseline.
- Q05 — Quais hosts outbound são indispensáveis para npm, git, modelo e updates?
- Q06 — Qual nível mínimo de backup completo pode ser garantido para arquivos temporários, lockfiles e diretórios ocultos?
- Q07 — Quais limites de tempo de run, disco, terminal e tamanho de upload atendem uso interno?
- Q08 — Auth.js atual terá papéis ADMIN/MEMBER em esquema próprio ou política de allowlist inicial?
- Q09 — Quais estados ACP, extensões e razões de término a versão pinada realmente emite?
- Q10 — Quem pode habilitar always-approve? Recomendação: ADMIN com regra explícita, P1.
- Q11 — Quais fluxos de Git privado serão necessários depois da V1?
- Q12 — Qual política de retenção elimina dados de forma adequada ao uso interno e custo?
- Q13 — Como os eventos serão enfileirados entre DO e Postgres com maior simplicidade operacional sem quebrar garantias de durabilidade? Escolher implementação no M01/M02 e testar outage.

Nenhuma dessas questões deve ser respondida por suposição. Registrar resolução em ADR com evidência, data e impacto sobre requisitos.

---

## 21. Matriz de riscos

| ID | Risco | Probabilidade/impacto | Mitigação |
|---|---|---|---|
| R01 | Modelo Workers AI não cumpre tool calling Grok | Alta / Bloqueante | Spike G01 antes do chat final |
| R02 | Sessão ACP não recuperável após morte do processo | Média / Alta | Persistir eventos, arquivos e fallback de reidratação explícita |
| R03 | API Sandbox 1.0 muda e exemplos antigos induzem erro | Média / Alta | Pinar versões e usar documentação 1.0 |
| R04 | Snapshot beta expira/falha | Média / Alta | Backup R2 verificado |
| R05 | Egress revela credenciais de inferência | Média / Crítica | Proxy Worker e secrets isolados |
| R06 | Retry duplica operação com side effect | Alta / Crítica | Idempotency, generation fencing, OUTCOME_UNKNOWN |
| R07 | Eventos fora de ordem ou perdidos | Média / Alta | Log canônico, seq e replay |
| R08 | Permissões ACP não traduzidas corretamente | Média / Crítica | Contract tests e ASK default |
| R09 | Processo longo é encerrado por lifecycle incorreto | Média / Alta | DO supervisiona, estados separados |
| R10 | Terminal acessa sandbox errada | Baixa / Crítica | Ticket escopado + ownership/generation check |
| R11 | Custo dispara por containers ociosos | Média / Alta | Quotas, inactivity, métricas, shutdown |
| R12 | UI esconde erro de runtime sob toast genérico | Alta / Média | Erros tipados e operações rastreáveis |

---

## 22. Checklist final da V1

- [ ] Todos os requisitos P0 F-001 a F-015 implementados e demonstrados.
- [ ] Gate real Workers AI + Grok ACP aprovado.
- [ ] Session CRUD, lifecycle e auth seguros.
- [ ] Chat com streaming, persistência, replay e cancelamento real.
- [ ] Approval handling e correlação de tool calls funcionais.
- [ ] Terminal PTY real, resize, teclado e reconnect.
- [ ] Files/Git com proteção de paths e histórico verificável.
- [ ] Snapshot/R2 e recovery após morte real de container.
- [ ] Sem chaves administrativas no terminal, payloads ou bundle.
- [ ] Gestão de generation, operações idempotentes e reconciliação.
- [ ] Testes de concorrência, duplicação, falha, restore e isolamento aprovados.
- [ ] Layout mobile e desktop utilizáveis.
- [ ] Runbooks e variáveis documentados.
- [ ] CI e gates G01 a G10 registrados com evidências.
- [ ] Sem dependência de operação manual Cloudflare/SSH no fluxo normal.
- [ ] README do projeto aponta para esta spec e indica claramente status/versão quando houver implementação.

---

## 23. Referências técnicas (verificadas em 2026-10-09)

1. Repositório base: https://github.com/brasalabs6/grokbot
2. Vercel AI SDK: https://ai-sdk.dev/docs/introduction
3. Vercel AI Chatbot: https://github.com/vercel/ai-chatbot
4. Cloudflare Sandboxes 1.0 overview: https://developers.cloudflare.com/sandbox/
5. Cloudflare Sandbox SDK 1.0 release: https://developers.cloudflare.com/changelog/post/2026-09-30-sandbox-sdk-1-0/
6. Cloudflare Durable Object Container API: https://developers.cloudflare.com/containers/api/durable-object-container/
7. Cloudflare terminal via xterm.js/tmux: https://developers.cloudflare.com/sandbox/commands/open-a-terminal-in-the-browser/
8. Cloudflare snapshot/restore: https://developers.cloudflare.com/sandbox/files/save-and-restore-a-workspace/
9. Cloudflare backup directory to R2: https://developers.cloudflare.com/sandbox/files/back-up-a-directory-to-r2/
10. Cloudflare sandbox lifecycle: https://developers.cloudflare.com/sandbox/concepts/lifetime/
11. Cloudflare Workers AI compatibilidade OpenAI: https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/
12. Workers AI GPT-OSS 120B: https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/
13. Grok Build overview: https://docs.x.ai/build/overview
14. Grok Build ACP guide: https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/15-agent-mode.md
15. Agent Client Protocol: https://agentclientprotocol.com/
16. xterm.js: https://xtermjs.org/

**Nota de versão:** as referências Cloudflare Sandbox SDK 0.x ainda existem na documentação, mas NÃO devem ser copiadas como arquitetura da V1. A versão 1.0 usa um Durable Object da aplicação e a API direta de container. Confirmar sintaxe exata nos pacotes instalados e referências oficiais antes de codificar.

---

## 24. Regra de governança da especificação

Qualquer alteração material à semântica de execução, isolamento, modelo Cloudflare, estratégia de backup, política de aprovações ou garantias de replay requer atualização desta spec ou ADR vinculada **antes ou junto** da implementação. Cada feature deve referenciar os F-IDs, gates e testes correspondentes no PR. Não converter P0 em P1 silenciosamente; registrar motivo, tradeoff, impacto e aceite explícito.

**A V1 está definida como produto funcional e verificável, não como demonstração visual.**
