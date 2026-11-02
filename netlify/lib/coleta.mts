// Busca automática a partir do link da TikTok Shop: fotos, informações e vídeos de criadores que já vendem o produto.
// Sem a API oficial de afiliado, a página do produto é lida por atores da Apify (mercado Brasil), tentados em ordem.
// Vídeos que vêm só com o endereço da página são baixados por um ator de vídeos do TikTok.
// Variável: APIFY_TOKEN.

import { arquivos, lerConfig, type Arquivo, type Produto } from "./store.mts"
import { lerPrints } from "./claude.mts"
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
  videos: { url: string; pagina?: string; views: number; duracao?: number }[]
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

// Serviços tentados em ordem até um trazer os dados do produto. Cada um tem o seu formato de entrada.
type Alvo = { id?: string; url: string }
type Estrategia = { nome: string; ator: string; entrada: (a: Alvo) => Record<string, unknown> | null }
const PROXY_BR = { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"], apifyProxyCountry: "BR" }
export const ESTRATEGIAS: Estrategia[] = [
  {
    nome: "scrapesage",
    ator: "scrapesage~tiktok-shop-scraper",
    entrada: (a) => ({
      mode: "product", productUrls: [a.id ? `https://shop.tiktok.com/br/pdp/${a.id}` : a.url], region: "BR", maxItems: 1,
      includeAffiliateVideos: true, includeReviews: false,
    }),
  },
  {
    nome: "scrapesage (proxy no Brasil)",
    ator: "scrapesage~tiktok-shop-scraper",
    entrada: (a) => (a.id ? {
      mode: "product", productUrls: [a.id], region: "BR", maxItems: 1, includeAffiliateVideos: true, includeReviews: false,
      proxyConfiguration: PROXY_BR,
    } : null),
  },
  {
    nome: "jungle",
    ator: ATOR_PADRAO,
    entrada: (a) => ({ items: [a.id ? `https://www.tiktok.com/view/product/${a.id}?region=BR` : a.url], country: "br", maxItems: 1, includeCreatorVideos: true }),
  },
]
const ATOR_VIDEOS = "clockworks~tiktok-scraper"

export async function rodarAtor(ator: string, entrada: unknown, timeoutSeg = 240): Promise<{ status: number; itens: any[]; texto: string }> {
  const r = await fetch(`https://api.apify.com/v2/acts/${ator}/run-sync-get-dataset-items?timeout=${timeoutSeg}`, {
    method: "POST",
    headers: { authorization: `Bearer ${env("APIFY_TOKEN")}`, "content-type": "application/json" },
    body: JSON.stringify(entrada),
  })
  const texto = await r.text()
  log("apify", ator, "status", r.status, "resposta", texto.slice(0, 600))
  let itens: any[] = []
  try {
    const j = JSON.parse(texto)
    itens = Array.isArray(j) ? j : [j]
  } catch {}
  return { status: r.status, itens, texto }
}

// alguns atores devolvem o produto dentro de outro objeto
function desembrulhar(x: any): any {
  if (!x || typeof x !== "object") return x
  const dentro = x.product_info || x.productInfo || x.product_detail || x.productDetail || x.product || x.data
  return dentro && typeof dentro === "object" && !Array.isArray(dentro) ? { ...dentro, ...x } : x
}

const nomeDe = (x: any): string =>
  String(x?.product_name || x?.productName || x?.product_title || x?.productTitle || x?.title || x?.name || "").trim()

const temDados = (x: any) => !!x && typeof x === "object" && !x.error && (!!nomeDe(x) || coletarImagens(x).length > 0)

const ehUrl = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//.test(v)
const urlDe = (v: any): string => (ehUrl(v) ? v : v?.url || v?.url_list?.[0] || v?.urlList?.[0] || v?.src || v?.thumb_url || "")

/** Percorre o objeto e chama `f` em cada valor, com o caminho de chaves até ele. */
function percorrer(x: any, f: (v: any, caminho: string[]) => void, caminho: string[] = [], prof = 0) {
  if (prof > 7 || x == null) return
  f(x, caminho)
  if (Array.isArray(x)) x.forEach((v, i) => percorrer(v, f, [...caminho, String(i)], prof + 1))
  else if (typeof x === "object") for (const [k, v] of Object.entries(x)) percorrer(v, f, [...caminho, k], prof + 1)
}

/** Fotos do produto: listas com chave de imagem, fora de vídeos, avaliações, loja e avatares. */
function coletarImagens(x: any): string[] {
  const achadas: string[] = []
  for (const k of ["images", "image_urls", "imageUrls", "main_images", "mainImages", "product_images", "productImages", "gallery", "imgs"]) {
    for (const v of Array.isArray(x?.[k]) ? x[k] : []) {
      const u = urlDe(v)
      if (ehUrl(u)) achadas.push(u)
    }
  }
  if (!achadas.length) {
    percorrer(x, (v, caminho) => {
      const c = caminho.join(".").toLowerCase()
      if (!/image|img|gallery|photo/.test(c) || /video|review|avatar|shop|seller|logo|icon|cover|comment|author|creator/.test(c)) return
      const u = urlDe(v)
      if (ehUrl(u) && !/\.(mp4|m3u8)/i.test(u)) achadas.push(u)
    })
  }
  return [...new Set(achadas)]
}

type VideoAchado = { url?: string; pagina?: string; views: number; duracao?: number }

/** Vídeos de criadores que promovem o produto: link direto do arquivo quando houver, senão a página do vídeo. */
function coletarVideos(x: any): VideoAchado[] {
  const listas: any[] = []
  percorrer(x, (v, caminho) => {
    const ultima = (caminho.at(-1) || "").toLowerCase()
    if (Array.isArray(v) && /video/.test(ultima)) listas.push(...v)
  })
  const out: VideoAchado[] = []
  for (const el of listas) {
    if (ehUrl(el)) {
      out.push(/tiktok\.com\/@[^/]+\/video\//.test(el) ? { pagina: el, views: 0 } : { url: el, views: 0 })
      continue
    }
    if (!el || typeof el !== "object") continue
    const direto = [el.content_url, el.contentUrl, el.play_url, el.playUrl, el.download_url, el.downloadUrl, el.playAddr, el.downloadAddr,
      el.video?.playAddr, el.video?.downloadAddr, el.video?.play_addr?.url_list?.[0], el.mediaUrls?.[0]].find(ehUrl)
    let pagina = [el.video_url, el.videoUrl, el.webVideoUrl, el.share_url, el.shareUrl, el.url].find(
      (u) => ehUrl(u) && /tiktok\.com\/@[^/]+\/video\//.test(u),
    )
    const idv = String(el.video_id || el.videoId || el.aweme_id || el.id || "")
    const autor = el.author_name || el.authorName || el.author?.uniqueId || el.author_unique_id || el.creator_handle || el.handle
    if (!pagina && /^\d{15,21}$/.test(idv) && autor) pagina = `https://www.tiktok.com/@${String(autor).replace(/^@/, "")}/video/${idv}`
    const views = Number(el.play_count ?? el.playCount ?? el.plays ?? el.views ?? el.view_count ?? el.stats?.playCount ?? 0) || 0
    const duracao = Number(el.duration_secs ?? el.durationSecs ?? el.duration ?? el.video?.duration ?? el.videoMeta?.duration ?? 0) || undefined
    if (direto || pagina) out.push({ url: direto, pagina, views, duracao })
  }
  const vistos = new Set<string>()
  return out
    .filter((v) => {
      const chave = v.pagina || v.url!
      if (vistos.has(chave)) return false
      vistos.add(chave)
      return !v.duracao || (v.duracao >= 5 && v.duracao <= 120)
    })
    .sort((a, b) => b.views - a.views)
}

export function normalizar(bruto: any): DadosLoja {
  const x = desembrulhar(bruto)
  const moeda = x.currency || x.price?.currency ? ` ${x.currency || x.price?.currency}` : ""
  const preco = typeof x.price === "object" ? x.price?.sale_price ?? x.price?.value ?? x.price?.amount : x.price ?? x.sale_price ?? x.salePrice
  const original = typeof x.price === "object" ? x.price?.original_price : x.original_price ?? x.originalPrice
  const vendidos = x.sold_count ?? x.soldCount ?? x.units_sold ?? x.unitsSold ?? x.sold
  const avaliacoes = x.review_count ?? x.reviewCount ?? x.reviews_count
  const loja = x.shop_name || x.shopName || x.shop?.name || x.shop?.shop_name || x.seller?.name
  const variantes = (x.variants || x.skus || []).map((v: any) => v?.name || v?.title || v?.sku_name || v?.skuName).filter(Boolean).slice(0, 8)
  const fatos = [
    preco != null && `Preço na loja: ${preco}${moeda}`,
    original != null && original !== preco && `Preço original: ${original}${moeda}`,
    vendidos != null && `Vendidos: ${vendidos}`,
    x.rating != null && `Nota: ${x.rating}${avaliacoes != null ? ` (${avaliacoes} avaliações)` : ""}`,
    loja && `Loja: ${loja}`,
    variantes.length && `Variações: ${variantes.join(", ")}`,
  ].filter(Boolean) as string[]
  const descricao = x.description || x.desc || x.product_description || x.productDescription || x.details || ""
  return {
    nome: nomeDe(x),
    descricao: (typeof descricao === "string" ? descricao : JSON.stringify(descricao)).trim().slice(0, 4000),
    fatos,
    imagens: coletarImagens(x),
    videos: coletarVideos(x).map((v) => ({ url: v.url || "", pagina: v.pagina, views: v.views, duracao: v.duracao })),
  }
}

async function baixar(url: string, max: number): Promise<Uint8Array | null> {
  try {
    const apify = new URL(url).hostname === "api.apify.com"
    const headers: Record<string, string> = apify
      ? { authorization: `Bearer ${env("APIFY_TOKEN")}` }
      : { "user-agent": NAVEGADOR, referer: "https://www.tiktok.com/" }
    const r = await fetch(url, { headers })
    if (!r.ok) return null
    if (Number(r.headers.get("content-length") || 0) > max) return null
    const dados = new Uint8Array(await r.arrayBuffer())
    return dados.length > 1000 && dados.length <= max ? dados : null
  } catch {
    return null
  }
}

/** Baixa vídeos do TikTok pela página (quando o serviço da loja não dá o arquivo direto). */
async function baixarPelaPagina(paginas: string[], diag: string[]): Promise<Uint8Array[]> {
  if (!paginas.length) return []
  try {
    const r = await rodarAtor(ATOR_VIDEOS, {
      postURLs: paginas, proxyCountryCode: "BR", shouldDownloadVideos: true, shouldDownloadCovers: false,
      shouldDownloadSlideshowImages: false, shouldDownloadSubtitles: false, resultsPerPage: paginas.length,
    }, 280)
    const links: string[] = []
    for (const it of r.itens) {
      let achado = ""
      percorrer(it, (v) => {
        if (!achado && ehUrl(v) && /key-value-stores\/[^/]+\/records\//.test(v)) achado = v
      })
      const alt = it?.videoMeta?.downloadAddr
      if (achado || ehUrl(alt)) links.push(achado || alt)
    }
    const out: Uint8Array[] = []
    for (const u of links) {
      const dados = await baixar(u, MAX_VIDEO)
      if (dados && ehMp4(dados)) out.push(dados)
    }
    diag.push(`vídeos pela página: HTTP ${r.status}, ${r.itens.length} registro(s), ${out.length} baixado(s)`)
    return out
  } catch (e) {
    diag.push(`vídeos pela página: ${String((e as any)?.message || e).slice(0, 160)}`)
    return []
  }
}

/** Procura no TikTok (resultados do Brasil) vídeos de pessoas mostrando o produto; devolve as páginas dos mais vistos. */
async function buscarVideos(termo: string, quantos: number, diag: string[]): Promise<string[]> {
  try {
    const r = await rodarAtor(ATOR_VIDEOS, {
      searchQueries: [termo], searchSection: "/video", resultsPerPage: 15, proxyCountryCode: "BR",
      shouldDownloadVideos: false, shouldDownloadCovers: false, shouldDownloadSlideshowImages: false, shouldDownloadSubtitles: false,
    }, 200)
    const candidatos = r.itens
      .map((it: any) => ({
        pagina: [it?.webVideoUrl, it?.url].find((u) => ehUrl(u) && /tiktok\.com\/@[^/]+\/video\//.test(u)) as string | undefined,
        views: Number(it?.playCount ?? it?.stats?.playCount ?? 0) || 0,
        duracao: Number(it?.videoMeta?.duration ?? it?.duration ?? 0) || undefined,
      }))
      .filter((v) => v.pagina && (!v.duracao || (v.duracao >= 5 && v.duracao <= 90)))
      .sort((a, b) => b.views - a.views)
    diag.push(`busca no TikTok por "${termo}": HTTP ${r.status}, ${candidatos.length} vídeo(s) aproveitável(is)`)
    return [...new Set(candidatos.map((c) => c.pagina!))].slice(0, quantos)
  } catch (e) {
    diag.push(`busca no TikTok: ${String((e as any)?.message || e).slice(0, 160)}`)
    return []
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
 * Cada tentativa fica registrada em p.diagnostico (aparece no app).
 */
export async function coletar(p: Produto, o: { maxFotos?: number; maxVideos?: number } = {}) {
  const maxFotos = o.maxFotos ?? 8
  const maxVideos = o.maxVideos ?? 3
  const diag: string[] = []
  p.diagnostico = diag
  const { url, produtoId } = await resolverLink(p.link)
  diag.push(`link: ${produtoId ? `produto ${produtoId}` : `sem número de produto (${url.slice(0, 120)})`}`)
  let bruto: any = null
  for (const e of ESTRATEGIAS) {
    const entrada = e.entrada({ id: produtoId, url })
    if (!entrada) continue
    try {
      const r = await rodarAtor(e.ator, entrada)
      const lista = r.itens.map(desembrulhar)
      const achado = lista.find(temDados)
      const erroAtor = r.status >= 300 ? ` ${r.texto.slice(0, 160)}` : ""
      const amostra = !achado && lista.length ? ` sem dados: ${JSON.stringify(lista[0]).slice(0, 160)}` : ""
      diag.push(`${e.nome}: HTTP ${r.status}, ${lista.length} registro(s)${erroAtor}${amostra}`)
      if (achado) {
        bruto = achado
        break
      }
    } catch (err: any) {
      diag.push(`${e.nome}: ${String(err?.message || err).slice(0, 160)}`)
    }
  }
  p.fotos = p.fotos.filter((f) => !f.nome.startsWith("loja_"))
  p.videos = p.videos.filter((f) => !f.nome.startsWith("loja_"))

  let d: DadosLoja
  let busca = ""
  if (bruto) {
    d = normalizar(bruto)
    busca = d.nome.split(/\s+/).slice(0, 6).join(" ")
    diag.push(`dados: "${d.nome.slice(0, 60)}", ${d.imagens.length} foto(s), ${d.videos.length} vídeo(s) de criadores`)
    p.infoLoja = [d.nome && `Nome na loja: ${d.nome}`, ...d.fatos, d.descricao && `Descrição da loja:\n${d.descricao}`]
      .filter(Boolean)
      .join("\n")
  } else {
    // Plano C: nenhum serviço leu a loja; os seus prints da página viram a fonte de nome e fatos.
    const prints: { bytes: Uint8Array; tipo: string }[] = []
    for (const f of p.fotos.slice(0, 6)) {
      const bytes = await arquivos.ler(p.id, f.nome)
      const tipo = bytes && tipoImagem(bytes)
      if (bytes && tipo) prints.push({ bytes, tipo })
    }
    if (!prints.length) {
      throw new Error(
        `nenhum serviço conseguiu ler este produto da TikTok Shop Brasil${produtoId ? ` (${produtoId})` : ""}. Toque em "Anexar prints" e mande de 2 a 4 prints da página do produto.`,
      )
    }
    const l = await lerPrints({ cfg: await lerConfig(), fotos: prints })
    d = { nome: l.nome, descricao: "", fatos: l.fatos, imagens: [], videos: [] }
    busca = l.busca
    diag.push(`usando os seus prints: "${l.nome.slice(0, 60)}", busca de vídeos: "${busca}"`)
    p.infoLoja = [l.nome && `Nome (lido dos prints): ${l.nome}`, ...l.fatos].filter(Boolean).join("\n")
  }
  if (!p.nome && d.nome) p.nome = d.nome

  let nf = 0
  for (const u of d.imagens) {
    if (nf >= maxFotos) break
    const dados = await baixar(u, MAX_FOTO)
    const tipo = dados && tipoImagem(dados)
    if (!dados || !tipo) continue
    await anexar(p, dados, `loja_foto_${String(++nf).padStart(2, "0")}.${tipo === "image/jpeg" ? "jpg" : tipo.split("/")[1]}`, tipo, "foto")
  }

  let nv = 0
  const pendentes: string[] = []
  for (const v of d.videos) {
    if (nv >= maxVideos) break
    const dados = v.url ? await baixar(v.url, MAX_VIDEO) : null
    if (dados && ehMp4(dados)) {
      await anexar(p, dados, `loja_video_${String(++nv).padStart(2, "0")}.mp4`, "video/mp4", "video")
    } else if (v.pagina && pendentes.length < maxVideos) {
      pendentes.push(v.pagina)
    }
  }
  if (nv < maxVideos && pendentes.length) {
    for (const dados of await baixarPelaPagina(pendentes.slice(0, maxVideos - nv), diag)) {
      await anexar(p, dados, `loja_video_${String(++nv).padStart(2, "0")}.mp4`, "video/mp4", "video")
    }
  }
  if (nv < maxVideos && busca && !p.videos.length) {
    const paginas = await buscarVideos(busca, maxVideos - nv, diag)
    for (const dados of await baixarPelaPagina(paginas, diag)) {
      await anexar(p, dados, `loja_video_${String(++nv).padStart(2, "0")}.mp4`, "video/mp4", "video")
    }
  }
  diag.push(`baixados: ${nf} foto(s), ${nv} vídeo(s)`)
  log(diag.join(" | "))
  p.origem = { fotos: nf, videos: nv, videosEncontrados: d.videos.length, em: new Date().toISOString() }
  p.zip = undefined
  if (!p.fotos.length) throw new Error("não consegui baixar as fotos do produto na loja; anexe as fotos manualmente")
  return p.origem
}
