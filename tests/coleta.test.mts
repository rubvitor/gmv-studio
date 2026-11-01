// Busca automática pelo link: id do produto, chamada à Apify, download das fotos e dos vídeos mais vistos, pacote e anúncio.
import { test } from "node:test"
import assert from "node:assert/strict"
import { dimensoesImagem, tipoImagem, ehMp4 } from "../netlify/lib/util.mts"

process.env.COMFY_API_KEY = "x"
process.env.COMFY_DEPLOYMENT_URL = "https://dep.run.comfy.app"
process.env.APIFY_TOKEN = "tok"

const preencher = (cab: number[], total = 2000) => {
  const b = new Uint8Array(total)
  b.set(cab)
  return b
}
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]
const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255]

const JPEG = preencher([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x20, 0x04, 0xb0, 0x03])
const WEBP = preencher([...ascii("RIFF"), ...le32(1990), ...ascii("WEBP"), ...ascii("VP8X"), ...le32(10), 0, 0, 0, 0, ...le24(1079), ...le24(1919)])
const PNG = preencher([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...ascii("IHDR"), 0, 0, 2, 0, 0, 0, 1, 0x80])
const MP4 = preencher([0, 0, 0, 0x18, ...ascii("ftypisom")], 5000)

test("tipo e dimensões das imagens", () => {
  assert.equal(tipoImagem(JPEG), "image/jpeg")
  assert.deepEqual(dimensoesImagem(JPEG), { largura: 1200, altura: 800 })
  assert.deepEqual(dimensoesImagem(WEBP), { largura: 1080, altura: 1920 })
  assert.deepEqual(dimensoesImagem(PNG), { largura: 512, altura: 384 })
  assert.equal(tipoImagem(new TextEncoder().encode("<html>nao e imagem</html>")), null)
  assert.ok(ehMp4(MP4))
})

test("id do produto em links da TikTok Shop", async () => {
  const { extrairIdProduto } = await import("../netlify/lib/coleta.mts")
  assert.equal(extrairIdProduto("https://www.tiktok.com/view/product/1729587769570005671?region=BR"), "1729587769570005671")
  assert.equal(extrairIdProduto("https://shop.tiktok.com/br/pdp/fone-bettdow-bluetooth/1729587769570005671"), "1729587769570005671")
  assert.equal(extrairIdProduto("https://m.tiktok.com/x?product_id=1729587769570005671"), "1729587769570005671")
  assert.equal(extrairIdProduto("https://www.tiktok.com/@alguem/video/7302812105782970420"), undefined)
  assert.equal(extrairIdProduto("https://vt.tiktok.com/ZS9yx2kS81xjD-muFd7/"), undefined)
})

test("link curto → fotos, vídeos mais vistos, pacote e anúncio", async () => {
  let apifyCorpo: any = null
  let apifyAuth = ""
  let nAsset = 0
  const baixados: string[] = []
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const u = String(url)
    if (u === "https://vt.tiktok.com/ZS9yx2kS81xjD-muFd7/") {
      assert.equal(init.redirect, "manual")
      return new Response(null, { status: 301, headers: { location: "https://www.tiktok.com/view/product/1729587769570005671?region=BR&u_code=x" } })
    }
    if (u.startsWith("https://api.apify.com/v2/acts/jungle_synthesizer~tiktok-shop-product-detail-scraper/run-sync-get-dataset-items")) {
      apifyCorpo = JSON.parse(init.body)
      apifyAuth = init.headers.authorization
      return Response.json([
        {
          product_name: "Fone Bettdow Bluetooth 5.3", description: "Fone sem fio com estojo de carga.", price: 59.9, currency: "BRL",
          sold_count: 1200, rating: 4.7, review_count: 310, shop_name: "Bettdow Store",
          images: ["https://img.example/1.jpeg", { url: "https://img.example/2.webp" }, "https://img.example/ruim.jpg", "https://img.example/3.png"],
          creator_videos: [
            { content_url: "https://v.example/a.mp4", play_count: 100, duration_secs: 30 },
            { content_url: "https://v.example/b.mp4", play_count: 5000, duration_secs: 20 },
            { content_url: "https://v.example/longo.mp4", play_count: 99999, duration_secs: 600 },
            { content_url: "https://v.example/quebrado.mp4", play_count: 3000, duration_secs: 15 },
          ],
        },
      ])
    }
    if (u.startsWith("https://img.example/") || u.startsWith("https://v.example/")) {
      baixados.push(u)
      const corpo: Record<string, Uint8Array | string> = {
        "1.jpeg": JPEG, "2.webp": WEBP, "3.png": PNG, "ruim.jpg": "<html>bloqueado</html>",
        "a.mp4": MP4, "b.mp4": MP4, "quebrado.mp4": "erro",
      }
      const nome = u.split("/").pop()!
      if (nome === "quebrado.mp4") return new Response("proibido", { status: 403 })
      return new Response(corpo[nome] as any)
    }
    if (u === "https://dep.run.comfy.app/api/v2/assets" && init.method === "POST") {
      const fd = init.body as FormData
      return Response.json({ id: `as${++nAsset}`, file_path: fd.get("file_path") })
    }
    throw new Error("fetch inesperado: " + u)
  }) as any

  const { produtos, anuncios, arquivos } = await import("../netlify/lib/store.mts")
  const { coletar } = await import("../netlify/lib/coleta.mts")
  const { montarPacote, depoisDoPacote } = await import("../netlify/lib/pacote.mts")
  const p = {
    id: "p9", criadoEm: new Date().toISOString(), link: "https://vt.tiktok.com/ZS9yx2kS81xjD-muFd7/", nome: "", observacoes: "",
    prioridade: 3, status: "coletando" as const, fotos: [], videos: [], gerarAoTerminar: true,
  }
  await produtos.salvar(p)
  const origem = await coletar(p)

  assert.deepEqual(apifyCorpo, { items: ["1729587769570005671"], country: "br", maxItems: 1, includeCreatorVideos: true })
  assert.equal(apifyAuth, "Bearer tok")
  assert.equal(p.nome, "Fone Bettdow Bluetooth 5.3")
  assert.match(p.infoLoja!, /Preço na loja: 59.9 BRL/)
  assert.match(p.infoLoja!, /Descrição da loja:\nFone sem fio/)
  assert.deepEqual(origem && { f: origem.fotos, v: origem.videos, e: origem.videosEncontrados }, { f: 3, v: 2, e: 3 })
  assert.deepEqual(p.fotos.map((f) => [f.nome, f.tipo, f.largura, f.altura]), [
    ["loja_foto_01.jpg", "image/jpeg", 1200, 800],
    ["loja_foto_02.webp", "image/webp", 1080, 1920],
    ["loja_foto_03.png", "image/png", 512, 384],
  ])
  // mais visto primeiro; o de 10 minutos fica de fora; o que falhou é pulado
  assert.deepEqual(p.videos.map((v) => v.nome), ["loja_video_01.mp4", "loja_video_02.mp4"])
  assert.ok(baixados.indexOf("https://v.example/b.mp4") < baixados.indexOf("https://v.example/a.mp4"))
  assert.ok(!baixados.includes("https://v.example/longo.mp4"))
  assert.ok(await arquivos.ler("p9", "loja_video_01.mp4"))

  await montarPacote(p)
  assert.equal(p.status, "na_fila")
  assert.ok(p.zip?.id)
  await produtos.salvar(p)
  const a = await depoisDoPacote(p, "")
  assert.ok(a)
  assert.equal((await anuncios.ler(a!.id))!.etapa, "aguardando")
  assert.equal((await produtos.ler("p9"))!.status, "usado")

  // buscar de novo troca só o que veio da loja
  p.fotos.push({ asset: { id: "manual", file_path: "m.jpg" }, nome: "manual.jpg", tipo: "image/jpeg", tamanho: 10 })
  await coletar(p)
  assert.equal(p.fotos.filter((f) => f.nome.startsWith("loja_")).length, 3)
  assert.ok(p.fotos.some((f) => f.nome === "manual.jpg"))
  assert.equal(p.zip, undefined)
})
