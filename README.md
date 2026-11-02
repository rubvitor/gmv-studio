# GMV Studio

App web (funciona como aplicativo no celular) que produz anúncios de TikTok Shop com o rosto e a voz do Rubens:
escolhe os produtos do dia, escreve o roteiro, gera o vídeo no ComfyUI da nuvem, confere e publica pelo Metricool.

## Como funciona

1. **Produtos**: no app, cole o link da TikTok Shop e anexe de 2 a 4 prints da página do produto. O TikTok só mostra
   produtos do Brasil para quem está logado, então leitores anônimos (Apify) voltam vazios; o app ainda tenta um, barato,
   e depois o Claude lê os prints (nome, preço, especificações). Os vídeos de referência (2 por padrão) são automáticos:
   os links passados no cadastro ou, se não houver, os vídeos públicos mais vistos desse tipo de produto no TikTok
   (resultados do Brasil). O download segue a ordem: o download do próprio TikTok quando o criador permite, depois o
   endereço do player na página pública do vídeo (o mesmo método dos sites de download), e por último a Apify.
   Esses vídeos servem só de referência de ritmo e demonstração e nunca são publicados. Nenhuma conta do TikTok é usada
   e o app não tenta contornar a verificação do TikTok. O que cada etapa respondeu fica em "Detalhes da busca".
2. **Radar diário** (06:00 de São Paulo): pega os produtos de maior prioridade da fila até completar a meta do dia.
   Na fase 2, com a API de afiliado da TikTok Shop, ele também encontra produtos sozinho.
3. **Pipeline de cada anúncio** (avança a cada 3 minutos):
   - análise das fotos e vídeos pelos nós do Rubens (`TikTokLerFotos`, `TikTokLerVideos`);
   - Claude escreve roteiro (sem acentos, por causa da fonte da legenda), cenas, recortes limpos do produto e a descrição;
   - prévia das 3 cenas (barata) → conferência visual pelo Claude → nova tentativa se algo estiver sem nexo;
   - vídeo completo (9 fotos de rosto, voz clonada, retoque de cabelo castanho bem escuro, até 1:30);
   - quadros do vídeo final → conferência (legenda, produto, coerência);
   - publicação: sem a API do Metricool, o vídeo vai para **Prontos para postar** com o melhor horário, o botão de salvar o
     vídeo e o de copiar a descrição; você posta pelo app do TikTok (único jeito de anexar o produto) e toca em "Já postei".
     Com a API do Metricool (plano Advanced), agenda sozinho no próximo horário livre, mas sem o produto anexado.
4. **Orçamento**: nenhum job é enviado se passar do orçamento diário de GPU definido nos ajustes.

## Configuração (uma vez)

No Netlify: *Project configuration → Environment variables* (escopo **Functions**), depois publique de novo.

| Variável | O que é |
|---|---|
| `APP_TOKEN` | Senha do app (invente uma longa). Também protege as funções internas. |
| `COMFY_API_KEY` | Chave da API da Comfy (platform.comfy.org). |
| `COMFY_DEPLOYMENT_URL` | `https://dep-03eb3a34-6196-462e-a243-539fd258148f.run.comfy.app` |
| `ANTHROPIC_API_KEY` | Chave da API da Anthropic (console.anthropic.com). |
| `METRICOOL_TOKEN` | Opcional. Token da API do Metricool (só nos planos Advanced e Custom). |
| `METRICOOL_USER_ID` | Opcional. ID de usuário do Metricool (o número depois de `userId=` no endereço). |
| `APIFY_TOKEN` | Opcional, mas é o que permite colar só o link. Token pessoal da Apify (console.apify.com → Settings → API & Integrations). |
| `TIKTOK_SHOP_APP_KEY`, `TIKTOK_SHOP_APP_SECRET`, `TIKTOK_SHOP_ACCESS_TOKEN`, `TIKTOK_SHOP_ENDPOINTS` | Fase 2, depois da aprovação no Partner Center. |

## API

Todas as rotas pedem `Authorization: Bearer <APP_TOKEN>`.

| Método e rota | Uso |
|---|---|
| `GET /api/status` | Variáveis configuradas, ajustes, gasto de hoje, contagens |
| `GET/PUT /api/config` | Ler e salvar ajustes |
| `GET/POST /api/produtos` | Listar e criar produtos (`{link, observacoes, prioridade, gerarAoTerminar}`) |
| `GET/PATCH/DELETE /api/produtos/:id` | Ver, editar, apagar |
| `POST /api/produtos/:id/fila` | Monta o pacote com o que foi enviado e coloca na fila |
| `POST /api/produtos/:id/coletar` | Busca fotos, informações e vídeos na TikTok Shop, monta o pacote e coloca na fila |
| `POST /api/uploads` → `PUT /api/uploads/:id/:parte` → `POST /api/uploads/:id/concluir` | Envio de arquivos em partes de 3,5 MB |
| `GET/POST /api/anuncios` | Listar e criar anúncio para um produto (`{produtoId}`) |
| `GET/DELETE /api/anuncios/:id` | Detalhe e apagar |
| `POST /api/anuncios/:id/aprovar` | Agendar no Metricool (modo aprovação, exige a API) |
| `POST /api/anuncios/:id/postado` | Marcar como postado pelo app do TikTok |
| `POST /api/anuncios/:id/refazer` | Recomeçar com nova semente |
| `GET /api/anuncios/:id/midia/:assetId?t=<APP_TOKEN>` | Redireciona para a imagem ou vídeo |
| `GET /api/custos` | Gasto de GPU por dia |
| `POST /api/radar/agora` | Criar os anúncios do dia agora |

## Testes

```
mkdir -p node_modules/@netlify && cp -r tests/stubs/@netlify/blobs node_modules/@netlify/   # só para testar sem npm
npm test   # node >= 22
```
