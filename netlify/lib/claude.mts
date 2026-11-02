// Chamadas à API da Anthropic (roteiro, cenas, descrição e conferência visual).

import { REGRAS_RUBENS, type Configuracoes } from "./config.mts"
import { extrairJSON } from "./util.mts"

type Bloco =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }

function chave(): string {
  const v = (globalThis as any).Netlify?.env?.get("ANTHROPIC_API_KEY") ?? process.env.ANTHROPIC_API_KEY
  if (!v) throw new Error("variável ANTHROPIC_API_KEY não configurada no Netlify")
  return v
}

export function imagem(bytes: Uint8Array, media_type: string): Bloco {
  return { type: "image", source: { type: "base64", media_type, data: Buffer.from(bytes).toString("base64") } }
}

export async function perguntar(modelo: string, sistema: string, conteudo: Bloco[], maxTokens = 4000): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": chave(),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: modelo,
      max_tokens: maxTokens,
      system: sistema,
      messages: [{ role: "user", content: conteudo }],
    }),
  })
  if (!r.ok) throw new Error(`Claude: HTTP ${r.status} ${(await r.text()).slice(0, 400)}`)
  const j = (await r.json()) as { content: { type: string; text?: string }[] }
  return j.content.filter((c) => c.type === "text").map((c) => c.text).join("\n")
}

export type Plano = {
  nome_produto: string
  fatos: string[]
  roteiro: string
  produto_en: string
  cenario_en: string
  acao_A: string
  acao_B: string
  acao_C: string
  recortes: { foto: number; caixa: [number, number, number, number] }[]
  descricao_pt: string
  descricao_en: string
  hashtags: string[]
  titulo_tiktok: string
}

export async function planejarAnuncio(o: {
  cfg: Configuracoes
  link: string
  observacoes: string
  infoLoja?: string
  ficha: string
  estrutura: string
  fotos: { bytes: Uint8Array; tipo: string }[]
  correcoes?: string
}): Promise<Plano> {
  const sistema = `Você é diretor de anúncios de TikTok Shop no Brasil e trabalha para o Rubens (@rubensviitor), que aparece como apresentador com o próprio rosto e a própria voz clonada.
Regras obrigatórias:
${REGRAS_RUBENS}
${o.cfg.regrasExtras ? "Regras extras do Rubens:\n" + o.cfg.regrasExtras : ""}
Responda SOMENTE com um objeto JSON válido, sem texto antes ou depois.`

  const pedido = `Produto: ${o.link}
Observações do Rubens: ${o.observacoes || "(nenhuma)"}

Dados da página do produto na TikTok Shop (fonte confiável de fatos; não cite preço no roteiro, ele muda):
${o.infoLoja || "(não buscados)"}

Ficha lida das fotos pelo ComfyUI:
${o.ficha || "(vazia)"}

Estrutura dos vídeos de referência (ritmo e sequência de demonstração, não copie frases):
${o.estrutura || "(sem vídeos de referência)"}

As imagens anexadas são as fotos do produto, numeradas a partir de 0 na ordem em que aparecem.
${o.correcoes ? "\nCORREÇÕES PEDIDAS NA CONFERÊNCIA ANTERIOR (aplique todas):\n" + o.correcoes + "\n" : ""}
Monte o anúncio e responda com este JSON:
{
  "nome_produto": "nome curto do produto",
  "fatos": ["só fatos que aparecem nas fotos ou na listagem"],
  "roteiro": "linhas 'A | fala', 'B | fala', 'C | fala' separadas por \\n. A = gancho nos 3 primeiros segundos e apresentação, produto ainda sem uso (no máximo 38 palavras somando as linhas A). B = demonstração em ordem lógica (no máximo 38 palavras). C = benefícios finais e chamada (no máximo 25 palavras), terminando com: ${o.cfg.chamadaFinal.normalize("NFD").replace(/[̀-ͯ]/g, "")} . Tudo por extenso, SEM acentos, sem emojis.",
  "produto_en": "ONE English phrase, max 40 words, starting with 'the exact', describing only how the product looks (shape, colors from the photos, brand lettering, visible parts); end with 'completely wireless, no cables' if wireless",
  "cenario_en": "ONE English phrase, max 15 words, starting with 'a' or 'an': natural place to present it, with lighting",
  "acao_A": "English phrase completing 'He ...' for a waist-up selfie frame: presents the product BEFORE using it, held naturally in one hand, physically coherent",
  "acao_B": "English phrase completing 'He ...': first natural usage step, logical order, like the reference videos, physically coherent",
  "acao_C": "English phrase completing 'He ...': product already in use, smiling warmly at the camera, inviting the viewer",
  "recortes": [{"foto": 0, "caixa": [x0, y0, x1, y1]}],
  "descricao_pt": "descrição do post em português do Brasil que alavanque vendas, só fatos, com a chamada '${o.cfg.chamadaFinal}' (acentos permitidos aqui)",
  "descricao_en": "the same description in English",
  "hashtags": ["${o.cfg.qtdHashtags} hashtags em português, as melhores para vender este produto, cada uma começando com #"],
  "titulo_tiktok": "título curto do post (até 60 caracteres)"
}
Sobre "recortes": escolha de 1 a 3 fotos que mostrem o produto inteiro com mais clareza e dê, para cada uma, a caixa do produto SEM nenhum texto da arte, em frações da largura e altura (0 a 1). Prefira fotos com fundo limpo e cores consistentes entre si.`

  const conteudo: Bloco[] = [...o.fotos.slice(0, 10).map((f) => imagem(f.bytes, f.tipo)), { type: "text", text: pedido }]
  const resp = await perguntar(o.cfg.modeloRoteiro, sistema, conteudo, 4000)
  const plano = extrairJSON<Plano>(resp)
  plano.hashtags = (plano.hashtags || []).map((h) => (h.startsWith("#") ? h : "#" + h)).slice(0, o.cfg.qtdHashtags)
  return plano
}

export type Veredito = { aprovado: boolean; problemas: string[]; correcoes: string }

export async function conferirImagens(o: {
  cfg: Configuracoes
  etapa: "previa" | "video"
  plano: Plano
  imagens: { bytes: Uint8Array; tipo: string }[]
  fotosProduto: { bytes: Uint8Array; tipo: string }[]
}): Promise<Veredito> {
  const sistema = `Você confere anúncios de TikTok Shop antes de gastar mais GPU ou publicar. Seja rigoroso, mas reprove só por problemas reais e visíveis.
Regras do Rubens:
${REGRAS_RUBENS}
Responda SOMENTE com JSON.`
  const oque =
    o.etapa === "previa"
      ? `As primeiras imagens são as 3 cenas iniciais (A, B, C) do anúncio. As últimas são fotos de referência do produto.
Cena A deve mostrar: ${o.plano.acao_A}
Cena B deve mostrar: ${o.plano.acao_B}
Cena C deve mostrar: ${o.plano.acao_C}`
      : `As primeiras imagens são quadros do vídeo final montado, em ordem de tempo. As últimas são fotos de referência do produto.
Roteiro falado (a legenda deve mostrar esse texto):
${o.plano.roteiro}`
  const checklist = `Confira:
1. O produto é o mesmo das fotos (forma, cor, sem cabo se for sem fio) e está coerente (na mão ou em uso, nada pendurado ou flutuando, nada sem nexo).
2. A sequência faz sentido (ex.: não está usando o produto antes de abrir a embalagem/estojo).
3. Cabelo e barba castanho bem escuro, sem fios grisalhos; rosto natural, sem deformações em mãos e rosto.
${o.etapa === "video" ? "4. Nenhuma foto do produto em tela cheia; legendas legíveis, sem quadradinhos no lugar de letras." : ""}
Responda: {"aprovado": true|false, "problemas": ["..."], "correcoes": "instruções curtas em português para corrigir as ações/cenas na próxima tentativa (vazio se aprovado)"}`
  const conteudo: Bloco[] = [
    ...o.imagens.map((f) => imagem(f.bytes, f.tipo)),
    ...o.fotosProduto.slice(0, 3).map((f) => imagem(f.bytes, f.tipo)),
    { type: "text", text: `${oque}\n\n${checklist}` },
  ]
  const resp = await perguntar(o.cfg.modeloConferencia, sistema, conteudo, 1500)
  const v = extrairJSON<Veredito>(resp)
  return { aprovado: !!v.aprovado, problemas: v.problemas || [], correcoes: v.correcoes || "" }
}

export type LeituraPrints = { nome: string; busca: string; fatos: string[] }

/** Lê prints da página do produto (quando nenhum serviço consegue ler a loja) e devolve nome, termo de busca e fatos. */
export async function lerPrints(o: { cfg: Configuracoes; fotos: { bytes: Uint8Array; tipo: string }[] }): Promise<LeituraPrints> {
  const sistema = "Você lê prints da página de um produto na TikTok Shop Brasil. Responda SOMENTE com um objeto JSON válido."
  const pedido = `Leia as imagens e responda com este JSON:
{
  "nome": "nome curto do produto em português, como aparece na página",
  "busca": "de 2 a 5 palavras em português para achar no TikTok vídeos de pessoas mostrando ESTE tipo de produto (tipo do produto + a característica mais marcante; inclua a marca só se for conhecida)",
  "fatos": ["só o que está escrito nas imagens: preço, especificações, benefícios, variações, avaliações"]
}`
  const conteudo: Bloco[] = [...o.fotos.slice(0, 6).map((f) => imagem(f.bytes, f.tipo)), { type: "text", text: pedido }]
  const j = extrairJSON<any>(await perguntar(o.cfg.modeloConferencia, sistema, conteudo, 1500))
  const nome = String(j?.nome || "").trim()
  return {
    nome,
    busca: String(j?.busca || nome).trim(),
    fatos: Array.isArray(j?.fatos) ? j.fatos.map((f: unknown) => String(f).trim()).filter(Boolean).slice(0, 15) : [],
  }
}
