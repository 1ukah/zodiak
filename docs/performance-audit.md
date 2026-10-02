# Auditoria de performance do Zodiak

Auditoria de 2 de outubro de 2026, motivada pelo travamento do mouse desde a abertura do app. Foram revisados inicialização, Electron e Chromium, build do Vite, interface, captura, áudio nativo, voz, chat, requests e mídia do LiveKit. Este checkout usa TypeScript e DOM direto; não há React nas dependências.

Foram encontrados e corrigidos desperdícios reais. A causa específica do travamento global do mouse ainda não foi reproduzida na medição isolada. A abertura sem sala não ativa captura de tela, encoder de vídeo ou o helper de áudio. Esses componentes podem agravar sessões, mas não explicam sozinhos o sintoma inicial.

## Evidências medidas

Ambiente observado: Windows 11 10.0.26200, Ryzen 7 5700X3D com 16 processadores lógicos, aproximadamente 32 GiB de RAM, RTX 4060, driver 32.0.16.1088 e Electron 44.4.5. A consulta completa de GPU confirmou ANGLE com Direct3D 11 na NVIDIA, sem fallback gráfico para o Microsoft Basic Render Driver naquele teste.

O harness executa o main de produção, preload e renderer reais com perfil temporário, sem credenciais do usuário. Cada cenário amostra os processos por oito segundos. O cenário de rede usa um servidor HTTP local que simula apenas ListRooms; não representa o servidor LiveKit real.

| Evidência | Antes | Depois | Interpretação |
| --- | --- | --- | --- |
| JavaScript inicial do renderer | 1.276.256 bytes | Aproximadamente 63.130 bytes | Cerca de 95% menos JavaScript inicial; WebRTC carrega ao entrar numa sala |
| JavaScript total de produção | 1,28 MB | Aproximadamente 650 KB | A minificação reduz o total; o módulo da sessão permanece necessário durante chamadas |
| CSS de produção | 57.777 bytes | Aproximadamente 45.110 bytes | Redução por minificação |
| Working set somado no lobby sem servidor | 707 MiB | 671 MiB numa execução posterior | Amostra curta, cerca de 5% de redução; páginas compartilhadas podem ser contadas mais de uma vez |
| Mutações de DOM em oito segundos no lobby sem servidor | 103 registros | 0 registros | Eliminado trabalho periódico ao repetir o mesmo estado de erro |
| Tarefas de JavaScript acima de 50 ms no lobby observado | 0 | 0 | A medição não reproduziu bloqueio prolongado da interface |
| Requests durante oito segundos minimizado, com servidor simulado | 2 numa execução intermediária | 0 após sinal nativo de visibilidade | Pausa verificada mesmo quando document.visibilityState permaneceu visible |
| Consulta periódica de participantes | A cada 2 s | A cada 15 s | 30 para 4 consultas por minuto por cliente, além de consulta inicial e reconexão |
| Abertura até mostrar a janela principal, perfil offline | 3,8–4,3 s em execuções com o PNG original | 0,8–0,9 s em duas execuções com ICO | Comparação local; ambos executam o main de produção, sem conexão ao LiveKit |
| Maior intervalo entre amostras de 100 ms no main durante startup | 1,8–2,1 s | 111–129 ms | Bloqueio síncrono de inicialização eliminado nessas execuções; intervalo inclui os 100 ms esperados |

A soma da CPU dos processos ficou abaixo de 0,11% da capacidade total da máquina nas amostras de lobby. Isso é CPU dos processos, não utilização da GPU, consumo do driver ou latência do cursor. Essas amostras começavam depois da abertura e não capturavam seus picos. Não foi demonstrada uma redução significativa de CPU ociosa entre versões.

A medição posterior de startup encontrou um problema adicional: cada BrowserWindow recebia o PNG de 6.032 × 6.032 pixels como ícone. Um bitmap RGBA desse tamanho ocupa aproximadamente 139 MiB antes de outras cópias. O SVG tentado antes retornava vazio. Apenas reduzir a imagem passada às janelas para 64 × 64 no harness baixou a abertura de 3,8 s para 1,1 s e o maior intervalo entre amostras de 1,8 s para 351 ms. A correção de produção usa diretamente o ICO de 256 × 256 já existente, incluído nos recursos do pacote, e deixou de decodificar o PNG nas aberturas Windows. Duas execuções posteriores mediram 807 e 878 ms até mostrar a janela e intervalos máximos de 129 e 111 ms. O pico percentual de CPU de curta duração não necessariamente cai: o trabalho ficou concentrado em uma abertura muito mais curta. Esses valores não são benchmarks estatísticos nem comprovam a resolução do cursor global.

O bloqueio anterior também aparecia com aceleração gráfica desativada (abertura de 4,0 s e intervalo de 1,94 s), portanto não dependia exclusivamente da GPU. Depois do ICO, esse modo abriu em 465 ms com intervalo máximo de 113 ms numa execução. A aceleração permanece habilitada em produção; desativá-la globalmente não foi adotado como solução.

Na comparação de enumeração com 14 fontes, gerar thumbnails levou aproximadamente 600 a 670 ms; listar sem thumbnails levou aproximadamente 370 a 400 ms. São timings de enumeração completa em execuções específicas, não uma medição da latência total de iniciar uma transmissão.

## Otimizações implementadas

1. **Inicialização sob demanda.** `session-loader.ts` mantém as preferências anteriores à conexão e importa LiveKit/WebRTC ao entrar na primeira sala. O main também carrega módulos de salas, tokens e updater sob demanda. A primeira conexão assume o custo de carregar o motor de mídia.
2. **Build minificado.** O renderer passa a usar minificação explícita. O módulo de mídia tem aproximadamente 587 KB e permanece separado do lobby. O aviso do Vite sobre esse chunk grande continua válido; aumentar o limite do aviso não seria uma otimização.
3. **Visibilidade e instância única.** A janela usa background throttling e envia eventos nativos de minimizar, restaurar, ocultar e mostrar. Requests periódicas e telemetria respeitam esse estado. O palco de vídeo fica oculto enquanto a janela está minimizada, permitindo que o adaptive stream observe vídeos fora da interface. A publicação e o áudio não são explicitamente interrompidos. Uma segunda abertura do mesmo perfil traz a primeira janela para frente.
4. **Requests e erros.** Sem configuração não há polling de rede. Falhas usam intervalo de recuperação de 30 s e não refazem a mesma interface repetidamente. A reconciliação de participantes usa 15 s e deixa de ser disparada por todo evento de mídia. Eventos do SDK continuam atualizando a interface imediatamente. O timeout HTTP do SDK foi definido em 7 s, antes do deadline externo de 8 s, para abortar a tentativa HTTP.
5. **Captura sem thumbnails redundantes.** A resolução da fonte escolhida lista somente telas ou somente janelas, sem capturar previews. O seletor continua gerando thumbnails quando o usuário realmente precisa vê-los. A documentação do Electron confirma que dimensão zero evita esse processamento. [desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer)
6. **Áudio com fila limitada.** O worklet anterior criava uma nova view com subarray para quase cada frame estéreo: perto de 48 mil views por segundo em fluxo contínuo. Sua fila não tinha limite. O novo ring buffer usa memória fixa para até 200 ms, não aloca views no callback de renderização e aceita chunks cortados em qualquer byte. Overflow descarta os frames completos mais antigos; underrun gera silêncio.
7. **Menos trabalho na interface.** SVGs de ícones são armazenados em cache, botões de voz preservam o SVG enquanto o ícone não muda, os vídeos da grade são reaproveitados em mudanças de participantes/controles e tracks que mantêm o mesmo elemento não são reanexadas. A telemetria própria roda somente com estatísticas habilitadas; cards ocultos não são reconstruídos.
8. **Estatísticas corretas de mídia.** O app lê relatórios completos de RTCRtpSender e RTCRtpReceiver. Os wrappers do SDK instalado descartavam tempos de encode/decode e jitter buffer. O painel agora pode mostrar implementação do encoder, indicação de eficiência e tempo médio de encode, quando o navegador fornece os campos. Uma assinatura ainda sem track não lança erro. GPU permitida pelo Chromium e encoder realmente usado são informações diferentes.
9. **Ícone nativo pequeno na abertura.** Windows carrega diretamente `app-icon.ico`; as duas janelas deixam de processar o PNG original de 6.032 pixels. Em outras plataformas, a imagem é reduzida a 256 pixels e reutilizada. A escolha segue os formatos nativos documentados pelo Electron. [nativeImage](https://www.electronjs.org/docs/latest/api/native-image)

Background throttling e visibilidade afetam timers e renderização; testes com voz e transmissão prolongadas minimizadas ainda são necessários. [BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)

## Requests e dados do LiveKit

| Fluxo | Dados enviados e frequência | Avaliação |
| --- | --- | --- |
| ListRooms | POST `/twirp/livekit.RoomService/ListRooms`, corpo `{}` no stub; a cada 5 s em estado saudável e visível | Pequeno request, mas retorna a lista completa de salas. Resposta real depende do servidor |
| ListParticipants | Nome da sala, no início, na reconexão e como fallback a cada 15 s visível | A redução evita consultas redundantes; ausência de eventos pode atrasar reconciliação em até um intervalo |
| Criar ou apagar sala | Nome e opções, apenas por ação do usuário | Sem loop periódico de criação/remoção |
| Token de entrada | JWT assinado localmente e usado para conectar ao LiveKit | Gerar o token não faz request de criação de sala. API secret fica na configuração local e assina tokens; não é enviada como campo de chat/mídia |
| Sinalização | WebSocket do SDK, negociações, assinaturas, atributos de voz e reconexões | O SDK gerencia sua própria sinalização. Não foi capturado tráfego do servidor real nesta auditoria |
| Tela publicada | H.264, default 1080p a 60 fps, teto dinâmico de 12 Mb/s | Custo existe durante publicação. O teto não garante aceleração por hardware nem bitrate mínimo |
| Telas recebidas | Vídeo e áudio da tela apenas após escolher assistir; ocultar cancela assinatura | Bom comportamento já existente. Várias telas assistidas simultaneamente acumulam decode e tráfego |
| Voz | Microfones assinados quando voz está ativa e o usuário não está deafened | Mute individual silencia via ganho e mantém recepção/processamento; avaliar unsubscribe se esse comportamento puder mudar |
| Chat | Canal de dados confiável, topic `zodiak.chat.v1`, por mensagem; teto de 2.000 caracteres e 10.000 bytes | Sem envio contínuo de histórico. Mensagens privadas indicam destinatário. Deduplicação é limitada a 5.000 IDs |

O stub confirmou POSTs de ListRooms com corpo de 2 bytes e resposta de 12 bytes, sem outra request da aplicação no lobby observado. Esses números excluem headers, TLS, sinalização e respostas reais. Não devem ser usados como estimativa da banda em uma sala.

O PCM do helper atravessa pipe, IPC e port do worklet a 48 kHz, estéreo, 16 bits: **192 KB/s localmente**, antes da codificação de áudio WebRTC. Esse fluxo não é enviado ao LiveKit como PCM bruto.

Adaptive stream e dynacast já estavam habilitados, e a aplicação usa Track.attach. Entretanto, `simulcast: false` oferece apenas uma versão H.264 da tela. Miniaturas não podem selecionar uma camada de baixa resolução inexistente. Publicar uma camada menor pode reduzir trabalho nos receptores, mas adiciona encode no transmissor e precisa de benchmark. [Assinaturas e adaptive stream](https://docs.livekit.io/transport/media/subscribe/)

## Prioridades para a próxima investigação

| Prioridade | Ponto | Trabalho necessário |
| --- | --- | --- |
| P0 | Travamento global do cursor ainda sem causa confirmada | Comparar a versão reconstruída com a instalada, medir processos e GPU no instante do travamento e capturar uma trace do Windows com CPU, GPU e DPC/ISR. Identificar o processo ou driver antes de mudar backend gráfico ou versão do Electron |
| P1 | Mixer nativo com exclusão do Discord | `Mix` acorda a cada 5 ms, varre processos/sessões a cada segundo, usa List.RemoveRange no começo das filas e ativa capturas sincronicamente, com espera de até 8 s por ativação. Medir por número de fontes; mover descoberta/ativação para fora do pump de áudio, usar filas circulares e revisar fechamento de handles/objetos COM em falhas e remoções |
| P1 | Qualidade e múltiplas telas | Comparar 1080p30, 1080p60, 720p120 e 1440p60 em cenas estáticas e em movimento, com 1/2/4 receptores. Registrar encoder real, limitação por CPU, frames dropped e GPU Video Encode/Decode. Testar simulcast com camada pequena sem presumir ganho para o transmissor |
| P1 | Publicação e voz com janela minimizada | Rodar 30 minutos com compartilhamento e voz, minimizar/restaurar e verificar áudio, continuidade de envio e retomada do vídeo remoto. Os testes atuais verificam roteamento e visibilidade, mas não esse cenário prolongado contra servidor real |
| P2 | Crescimento de memória em sessões longas | Chat limita 500 mensagens por conversa, mas não tem teto global de salas/conversas guardadas em memória. Observar crescimento, definir política de retenção e fazer heap snapshots após várias entradas/saídas |
| P2 | Grafos de áudio por participante | Há elementos receptores silenciosos, Web Audio e destinations por participante para ganho e seleção de saída. Os testes confirmam amplitude, mute e limpeza. Avaliar simplificação do caminho comum mantendo boost a 200% e seleção de dispositivos |
| P2 | UI e rede com muitas salas/pessoas | Revisar custo de reconstruir listas, sorting e buscas repetidas, tamanho de ListRooms e requests simultâneas entre clientes. Medir com 10/50/100 participantes antes de introduzir virtualização ou novos caches |
| P2 | Efeitos gráficos | Diálogos usam backdrop blur de 7 px; comparar ligado/desligado enquanto vídeos são exibidos. Ele não está ativo no lobby sem diálogo e não explica sozinho o relato de lag desde a abertura |

O teste diagnóstico sem aceleração não reproduziu nem demonstrou melhora do travamento. Ele desabilita também encode/decode acelerados, portanto não foi aplicado como configuração permanente. O status de recursos gráficos depende do evento gpu-info-update, e a consulta completa é necessária para detalhes do backend e driver. [GPU no Electron](https://www.electronjs.org/docs/latest/api/app#getgpuinfoinfotype)

## Validação e uso

Passaram typecheck, build de produção, UI smoke, protocolo e UI de chat, sessão e UI de voz, reprodução real de áudio por WebRTC local, testes do PCM, teste de telemetria completa e startup com preload real. Os testes novos verificam preservação de vídeos, carregamento tardio do motor e sinal nativo de minimizar/restaurar. Não houve teste prolongado no LiveKit real nem confirmação visual de que o cursor deixou de travar.

Relatórios JSON locais ficam em `release/performance-audit`. Essa pasta é ignorada pelo Git. `before-default.json` e `before-software-gpu.json` preservam o baseline; `default.json`, `default-stub-server.json` e `gpu-complete.json` registram execuções posteriores. O contador de mutações conta registros do observer, não quantidade de elementos. Timer lag em janela oculta inclui throttling intencional e não deve ser interpretado como travamento.

`startup-default-before-icon.json` e `startup-software-gpu-before-icon.json` preservam a medição específica de abertura antes da correção do ícone; `startup-default.json` e `startup-software-gpu.json` contêm execuções posteriores. O harness registra CPU por processo desde app.whenReady e segue por quatro segundos após mostrar a janela. Não inclui todo o trabalho ocorrido antes de app.whenReady nem amostra drivers do Windows. Repetir com `npx electron tests/performance-audit.cjs --startup-only` depois do build; acrescentar `--software-gpu` somente para comparação diagnóstica.

```powershell
npm run audit:performance
npm run audit:performance -- --stub-server
npm run audit:performance -- --software-gpu
npm run audit:performance -- --gpu-only
npm run test:pcm
npm run test:telemetry
```

O pacote em `dist/win-unpacked`, de 30 de setembro, ainda tinha backgroundThrottling desativado e não tinha trava de instância única. Foi gerada uma versão reconstruída em `release/performance-build/win-unpacked/zodiak.exe`. É necessário manter toda a pasta ao executá-la. Ela usa seu próprio diretório de dados, exige configurar o servidor e não substitui a instalação existente. Para gerar o instalador do projeto com estas alterações, use `npm run pack`; para desenvolvimento use `npm run dev`. Nenhuma release foi publicada.
