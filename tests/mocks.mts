// ComfyUI, Claude e Metricool falsos para simular o pipeline sem rede.
// Cada arquivo de teste roda em processo próprio, então as variáveis de ambiente não vazam entre eles.

export const plano = {
  nome_produto: "Fone Bettdow",
  fatos: ["Bluetooth 5.3"],
  roteiro: "A | Olha o que esse fone faz.\nB | Abriu o estojo, ele conecta.\nC | Clica no carrinho abaixo e adquira o seu.",
  produto_en: "the exact white earbuds", cenario_en: "a bright bedroom",
  acao_A: "holds the case", acao_B: "puts one earbud in", acao_C: "wears both",
  recortes: [{ foto: 0, caixa: [0.1, 0.1, 0.9, 0.9] }],
  descricao_pt: "Fone sem fio", descricao_en: "Wireless earbuds", hashtags: ["#fone", "fonesemfio"], titulo_tiktok: "Fone",
}

export function instalarServicosFalsos() {
  let jobs = 0
  const enviados: any[] = []
  const metricool: any[] = []
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
    if (u.startsWith("https://app.metricool.com")) {
      metricool.push(u)
      return Response.json({ data: { id: 99, plannerUrl: "https://app.metricool.com/p" } })
    }
    throw new Error("fetch inesperado: " + u)
  }) as any
  return { enviados, metricool }
}

export async function prepararProduto() {
  const { produtos, salvarConfig } = await import("../netlify/lib/store.mts")
  await salvarConfig({ orcamentoDiarioUSD: 10, horarios: ["23:59"] })
  await produtos.salvar({
    id: "p1", criadoEm: new Date().toISOString(), link: "https://vt.tiktok.com/x", nome: "", observacoes: "", prioridade: 3,
    status: "na_fila", fotos: [{ asset: { id: "f1", file_path: "f.jpg" }, nome: "f.jpg", tipo: "image/jpeg", tamanho: 3, largura: 1000, altura: 800 }],
    videos: [], zip: { id: "z1", file_path: "pacote.zip" },
  })
}

// avança até parar numa etapa sem trabalho pendente
export async function rodarAte(idAnuncio: string, finais: string[]) {
  const { avancar } = await import("../netlify/lib/pipeline.mts")
  const etapas: string[] = []
  for (let i = 0; i < 12; i++) {
    const r = await avancar(idAnuncio)
    etapas.push(r!.etapa)
    if (finais.includes(r!.etapa)) break
  }
  return etapas
}
