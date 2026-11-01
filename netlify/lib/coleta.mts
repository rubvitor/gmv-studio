// Busca automática a partir do link da TikTok Shop: fotos, informações e vídeos de criadores que já vendem o produto.
// Sem a API oficial de afiliado, a página do produto é lida por um ator da Apify (mercado "br").
// Variáveis: APIFY_TOKEN (obrigatória para a busca) e APIFY_ATOR (opcional, troca o ator).

import { arquivos, type Arquivo, type Produto } from "./store.mts"
import { enviarAsset } from "./comfy.mts"
import { env } from "./http.mts"
import { dimensoesImagem, ehMp4, tipoImagem } from "./util.mts"

export const ATOR_PADRAO = "jungle_synthesizer~tiktok-shop-product-detail-scraper"
const NAVEGADOR =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
const MAX_FOTO = 15e6
const MAX_VIDEO = 60e6

export const coletaConfigurada = () => !!env("APIFY_TOKEN")

export type DadosLoja = {
  nome: string
  descricao: string
  fatos: string[]
  imagens: string[]
  videos: { url: string; views: number; duracao?: number }[]
}

/** Id numérico do produto num link da TikTok Shop (página do produto, não de vídeo). */
export function extrairIdProduto(url: string): string | undefined {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return undefined
  }
  for (const k of ["product_id", "productId", "pid"]) {
    const v = u.searchParams.get(k)
    if (v && /^\d{15,21}$/.test(v)) return v
  }
  if (!/product|pdp|shop/i.test(u.hostname + u.pathname)) return undefined
  const m = u.pathname.match(/(\d{15,21})(?!.*\d{15,21})/)
  return m?.[1]
}

/** Id do produto escrito dentro do HTML da página (quando o endereço final não traz o id). */
export function idNoHtml(html: string): string | undefined {
  const m =
    html.match(/"product_?id"\s*:\s*"?(\d{15,21})/i) ||
    html.match(/\/(?:view\/)?product\/(\d{15,21})/) ||
    html.match(/\/pdp\/[^"'\s]*?(\d{15,21})/)
  return m?.[1]
}

const log = (...x: unknown[]) => console.log("[coleta]", ...x)

/** Segue os redirecionamentos do link curto (vt.tiktok.com) até achar o id do produto. */
export async function resolverLink(link: string): Promise<{ url: string; produtoId?: string }> {
  let url = link.trim()
  let ultima: Response | null = null
  for (let i = 0; i < 6; i++) {
    const idp = extrairIdProduto(url)
    if (idp) return { url, produtoId: idp }
    try {
      ultima = await fetch(url, { redirect: "manual", headers: { "user-agent": NAVEGADOR, "accept-language": "pt-BR,pt;q=0.9" } })
    } catch (e) {
      log("falha ao abrir", url, String(e))
      ultima = null
      break
    }
    const destino = ultima.headers.get("location")
    log("link", i, ultima.status, url, "→", destino || "-")
    if (ultima.status < 300 || ultima.status >= 400 || !destino) break
    url = new URL(destino, url).toString()
  }
  let produtoId = extrairIdProduto(url)
  if (!produtoId && ultima?.ok) {
    try {
      produtoId = idNoHtml(await ultima.text())
    } catch {}
  }
  log("resolvido", url, "id", produtoId || "-")
  return { url, produtoId }
}

async function chamarApify(item: string): Promise<any> {
  const ator = env("APIFY_ATOR") || ATOR_PADRAO
  const r = await fetch(`https://api.apify.com/v2/acts/${ator}/run-sync-get-dataset-items?timeout=280`, {
    method: "POST",
    headers: { authorization: `Bearer ${env("APIFY_TOKEN")}`, "content-type": "application/json" },
    body: JSON.stringify({ items: [item], country: "br", maxItems: 1, includeCreatorVideos: true }),
  })
  const txt = await r.text()
  log("apify", ator, "item", item, "status", r.status, "resposta", txt.slice(0, 600))
  if (!r.ok) throw new Error(`Apify respondeu ${r.status}: ${txt.slice(0, 300)}`)
  let itens: any
  try {
    itens = JSON.parse(txt)
  } catch {
    throw new Error("resposta inválida da Apify")
  }
  const lista = Array.isArray(itens) ? itens : [itens]
  const achado = lista.find((x) => x && (x.product_name || x.title || x.name))
  if (!achado) {
    const motivo = lista.map((x) => x?.error || x?.status || x?.message).filter(Boolean)[0]
    throw new Error(
      `a Apify não encontrou o produto ${item}${motivo ? ` (${String(motivo).slice(0, 160)})` : ""}. Confira se o link é de um produto da TikTok Shop Brasil.`,
    )
  }
  return achado
}

const urlDe = (v: any): string => (typeof v === "string" ? v : v?.url || v?.url_list?.[0] || v?.src || "")

export function normalizar(x: any): DadosLoja {
  const imagens = [...new Set<string>((x.images || x.image_urls || x.imageUrls || []).map(urlDe).filter(Boolean))]
  const brutos = [
    ...(x.creator_videos || []),
    ...((x.videos || []) as any[]).map((v) => (typeof v === "string" ? { content_url: v } : v)),
  ]
  const vistos = new Set<string>()
  const videos = brutos
    .map((v: any) => ({
      url: String(v?.content_url || v?.play_url || v?.download_url || v?.playAddr || ""),
      views: Number(v?.play_count ?? v?.views ?? 0) || 0,
      duracao: Number(v?.duration_secs ?? v?.duration ?? 0) || undefined,
    }))
    .filter((v) => v.url.startsWith("http") && !vistos.has(v.url) && vistos.add(v.url))
    .filter((v) => !v.duracao || (v.duracao >= 5 && v.duracao <= 120))
    .sort((a, b) => b.views - a.views)
  const moeda = x.currency ? ` ${x.currency}` : ""
  const loja = x.shop_name || x.shop?.name || x.seller?.name
  const variantes = (x.variants || x.skus || []).map((v: any) => v?.name || v?.title || v?.sku_name).filter(Boolean).slice(0, 8)
  const fatos = [
    x.price != null && `Preço na loja: ${x.price}${moeda}`,
    x.original_price != null && x.original_price !== x.price && `Preço original: ${x.original_price}${moeda}`,
    (x.sold_count ?? x.soldCount) != null && `Vendidos: ${x.sold_count ?? x.soldCount}`,
    x.rating != null && `Nota: ${x.rating}${x.review_count != null ? ` (${x.review_count} avaliações)` : ""}`,
    loja && `Loja: ${loja}`,
    variantes.length && `Variações: ${variantes.join(", ")}`,
  ].filter(Boolean) as string[]
  return {
    nome: String(x.product_name || x.title || x.name || "").trim(),
    descricao: String(x.description || x.desc || "").trim().slice(0, 4000),
    fatos,
    imagens,
    videos,
  }
}

async function baixar(url: string, max: number): Promise<Uint8Array | null> {
  try {
    const r = await fetch(url, { headers: { "user-agent": NAVEGADOR, referer: "https://www.tiktok.com/" } })
    if (!r.ok) return null
    if (Number(r.headers.get("content-length") || 0) > max) return null
    const dados = new Uint8Array(await r.arrayBuffer())
    return dados.length > 1000 && dados.length <= max ? dados : null
  } catch {
    return null
  }
}

async function anexar(p: Produto, dados: Uint8Array, nome: string, tipo: string, categoria: "foto" | "video") {
  await arquivos.guardar(p.id, nome, dados)
  const asset = await enviarAsset(dados, `gmv/${p.id}/${nome}`, tipo)
  const item: Arquivo = { asset, nome, tipo, tamanho: dados.length, ...(categoria === "foto" ? dimensoesImagem(dados) : {}) }
  ;(categoria === "video" ? p.videos : p.fotos).push(item)
}

/**
 * Lê a página do produto e anexa ao produto até `maxFotos` fotos e os `maxVideos` vídeos de criadores mais vistos.
 * Mantém o que você enviou à mão; refazer a busca troca só o que veio da loja.
 */
export async function coletar(p: Produto, o: { maxFotos?: number; maxVideos?: number } = {}) {
  const maxFotos = o.maxFotos ?? 8
  const maxVideos = o.maxVideos ?? 3
  const { url, produtoId } = await resolverLink(p.link)
  const d = normalizar(await chamarApify(produtoId || url))

  p.fotos = p.fotos.filter((f) => !f.nome.startsWith("loja_"))
  p.videos = p.videos.filter((f) => !f.nome.startsWith("loja_"))
  if (!p.nome && d.nome) p.nome = d.nome
  p.infoLoja = [d.nome && `Nome na loja: ${d.nome}`, ...d.fatos, d.descricao && `Descrição da loja:\n${d.descricao}`]
    .filter(Boolean)
    .join("\n")

  let nf = 0
  for (const u of d.imagens) {
    if (nf >= maxFotos) break
    const dados = await baixar(u, MAX_FOTO)
    const tipo = dados && tipoImagem(dados)
    if (!dados || !tipo) continue
    await anexar(p, dados, `loja_foto_${String(++nf).padStart(2, "0")}.${tipo === "image/jpeg" ? "jpg" : tipo.split("/")[1]}`, tipo, "foto")
  }
  let nv = 0
  for (const v of d.videos) {
    if (nv >= maxVideos) break
    const dados = await baixar(v.url, MAX_VIDEO)
    if (!dados || !ehMp4(dados)) continue
    await anexar(p, dados, `loja_video_${String(++nv).padStart(2, "0")}.mp4`, "video/mp4", "video")
  }
  log("baixados", { fotos: `${nf} de ${d.imagens.length}`, videos: `${nv} de ${d.videos.length}` })
  p.origem = { fotos: nf, videos: nv, videosEncontrados: d.videos.length, em: new Date().toISOString() }
  p.zip = undefined
  if (!p.fotos.length) throw new Error("não consegui baixar as fotos do produto na loja; anexe as fotos manualmente")
  return p.origem
}
