// Simula o pipeline inteiro com ComfyUI, Claude e Metricool falsos (precisa do stub de @netlify/blobs em node_modules).
import { test } from "node:test"
import assert from "node:assert/strict"

process.env.COMFY_API_KEY = "x"
process.env.COMFY_DEPLOYMENT_URL = "https://dep.run.comfy.app"
process.env.ANTHROPIC_API_KEY = "x"
process.env.METRICOOL_TOKEN = "x"
process.env.METRICOOL_USER_ID = "1"

const plano = {
  nome_produto: "Fone Bettdow",
  fatos: ["Bluetooth 5.3"],
  roteiro: "A | Olha o que esse fone faz.\nB | Abriu o estojo, ele conecta.\nC | Clica no carrinho abaixo e adquira o seu.",
  produto_en: "the exact white earbuds", cenario_en: "a bright bedroom",
  acao_A: "holds the case", acao_B: "puts one earbud in", acao_C: "wears both",
  recortes: [{ foto: 0, caixa: [0.1, 0.1, 0.9, 0.9] }],
  descricao_pt: "Fone sem fio", descricao_en: "Wireless earbuds", hashtags: ["#fone", "fonesemfio"], titulo_tiktok: "Fone",
}
let jobs = 0
const enviados: any[] = []
globalThis.fetch = (async (url: any, init: any = {}) => {
  const u = String(url)
  if (u.endsWith("/api/v2/jobs") && init.method === "POST") {
    const corpo = JSON.parse(init.body)
    enviados.push(corpo)
    return Response.json({ id: `job${++jobs}`, status: "queued" }, { status: 201 })
  }
  if (u.includes("/api/v2/jobs/job")) {
    const n = Number(u.split("job").pop())
    const etapa = enviados[n - 1].metadata.etapa
    const out =
      etapa === "analise" ? [{ id: "t1", name: "ficha_00001_.txt", type: "text", content_type: "text/plain" }, { id: "t2", name: "estrutura_referencia_00001_.txt", type: "text", content_type: "text/plain" }]
      : etapa === "previa" ? ["C", "A", "B"].map((c) => ({ id: `img${c}`, name: `cena_${c}_00001_.png`, type: "image", content_type: "image/png" }))
      : etapa === "video" ? [{ id: "vid1", name: "anuncio_00001_.mp4", type: "video", content_type: "video/mp4" }]
      : [{ id: "q1", name: "q00_00001_.png", type: "image", content_type: "image/png" }]
    return Response.json({ id: `job${n}`, status: "succeeded", started_at: "2026-10-31T10:00:00Z", completed_at: "2026-10-31T10:01:00Z", outputs: out })
  }
  if (u.includes("/api/v2/assets/") && u.endsWith("/content")) return new Response(null, { status: 302, headers: { location: "https://signed.example/x" } })
  if (u.startsWith("https://signed.example/")) return new Response("texto da ficha")
  if (u.startsWith("https://api.anthropic.com")) {
    const corpo = JSON.parse(init.body)
    const txt = corpo.system.includes("diretor") ? JSON.stringify(plano) : JSON.stringify({ aprovado: true, problemas: [], correcoes: "" })
    return Response.json({ content: [{ type: "text", text: txt }] })
  }
  if (u.startsWith("https://app.metricool.com")) return Response.json({ data: { id: 99, plannerUrl: "https://app.metricool.com/p" } })
  throw new Error("fetch inesperado: " + u)
}) as any

test("anúncio vai de aguardando até agendado", async () => {
  const { produtos, anuncios, salvarConfig } = await import("../netlify/lib/store.mts")
  const { avancar } = await import("../netlify/lib/pipeline.mts")
  const { novoAnuncio } = await import("../netlify/lib/radar.mts")
  await salvarConfig({ orcamentoDiarioUSD: 10, horarios: ["23:59"] })
  await produtos.salvar({
    id: "p1", criadoEm: new Date().toISOString(), link: "https://vt.tiktok.com/x", nome: "", observacoes: "", prioridade: 3,
    status: "na_fila", fotos: [{ asset: { id: "f1", file_path: "f.jpg" }, nome: "f.jpg", tipo: "image/jpeg", tamanho: 3, largura: 1000, altura: 800 }],
    videos: [], zip: { id: "z1", file_path: "pacote.zip" },
  })
  const a = novoAnuncio("p1")
  await anuncios.salvar(a)
  const etapas: string[] = []
  for (let i = 0; i < 10; i++) {
    const r = await avancar(a.id)
    etapas.push(r!.etapa)
    if (r!.etapa === "agendado" || r!.etapa === "erro") break
  }
  const final = await anuncios.ler(a.id)
  assert.equal(final!.etapa, "agendado", JSON.stringify(final!.log))
  assert.equal(final!.previa!.join(","), "imgA,imgB,imgC")
  assert.equal(final!.publicacao!.metricoolId, 99)
  assert.ok(final!.custoUSD > 0)
  assert.deepEqual(enviados.map((e) => e.metadata.etapa), ["analise", "previa", "video", "quadros"])
  assert.equal(enviados[1].workflow["620"].class_type, "ImageCrop")
  const p = await produtos.ler("p1")
  assert.equal(p!.nome, "Fone Bettdow")
  console.log("etapas:", etapas.join(" -> "))
})
