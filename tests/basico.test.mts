import { test } from "node:test"
import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import { grafoAnuncio, grafoAnalise, grafoQuadros, conferirRoteiro } from "../netlify/lib/workflow.mts"
import { criarZip, crc32, proximoHorario, semAcento, extrairJSON } from "../netlify/lib/util.mts"
import { mesclarConfig } from "../netlify/lib/config.mts"
import { assinar, nota } from "../netlify/lib/tiktokshop.mts"

const textos = {
  roteiro: "A | Olha o que esse fone faz quando eu abro o estojo.\nB | Abriu o estojo, ele conecta sozinho.\nC | Clica no carrinho abaixo e adquira o seu.",
  produto: "the exact white earbuds",
  cenario: "a bright bedroom",
  acao_A: "holds the closed case",
  acao_B: "puts one earbud in his ear",
  acao_C: "wears both earbuds and smiles",
}
const zip = { id: "z1", file_path: "pacote.zip" }
const refs = [
  { asset: { id: "f1", file_path: "f1.jpg" }, largura: 1290, altura: 1242, recorte: [0.1, 0.2, 0.9, 0.9] as [number, number, number, number] },
  { asset: { id: "f2", file_path: "f2.jpg" } },
]

test("grafo completo tem montagem, 9 rostos e referências recortadas", () => {
  const g = grafoAnuncio({ textos, zip, refs, semente: 42 })
  assert.equal(g["157"].class_type, "TikTokMontagem")
  assert.equal(g["158"].class_type, "SaveVideo")
  assert.equal(g["620"].class_type, "ImageCrop")
  assert.equal(g["620"].inputs.width, Math.round(0.8 * 1290))
  const ref = g["48"].inputs
  assert.deepEqual(ref["images.image9"], ["620", 0])
  assert.deepEqual(ref["images.image10"], ["601", 0])
  assert.ok(String(g["46"].inputs.f_string).includes("Images 10 to 11"))
  assert.deepEqual(g["90"].inputs.images, ["417", 0])
  assert.deepEqual(g["119"].inputs.images, ["457", 0])
  assert.deepEqual(g["156"].inputs.images, ["467", 0])
  writeFileSync("/tmp/claude-0/-home-claude/04a97513-42f0-57ce-9725-48e319a201b1/scratchpad/teste_grafo.json", JSON.stringify(g))
})

test("prévia só gera imagens", () => {
  const g = grafoAnuncio({ textos, zip, refs, semente: 42, previa: true })
  const tipos = new Set(Object.values(g).map((n) => n.class_type))
  assert.ok(!tipos.has("WanInfiniteTalkToVideo"))
  assert.ok(!tipos.has("TikTokEntrada"))
  assert.equal(Object.values(g).filter((n) => n.class_type === "SaveImage").length, 3)
})

test("análise e quadros", () => {
  assert.equal(grafoAnalise(zip)["9"].class_type, "TikTokLerVideos")
  assert.equal(Object.values(grafoQuadros({ id: "v", file_path: "v.mp4" })).filter((n) => n.class_type === "SaveImage").length, 8)
})

test("conferência de roteiro", () => {
  assert.deepEqual(conferirRoteiro(textos.roteiro), [])
  const ruim = conferirRoteiro("B | três toques\nA | oi")
  assert.ok(ruim.some((p) => p.includes("acento")))
  assert.ok(ruim.some((p) => p.includes("ordem")))
  assert.ok(ruim.some((p) => p.includes("cena C")))
})

test("zip válido", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926)
  const z = criarZip([
    { nome: "foto_01.jpg", dados: new Uint8Array([1, 2, 3]) },
    { nome: "referencia_02.mp4", dados: new TextEncoder().encode("abc") },
  ])
  writeFileSync("/tmp/claude-0/-home-claude/04a97513-42f0-57ce-9725-48e319a201b1/scratchpad/teste.zip", z)
  assert.equal(z[0], 0x50)
})

test("horários e utilidades", () => {
  const base = new Date("2026-10-31T14:00:00Z") // 11:00 em SP
  assert.equal(proximoHorario(["11:40", "18:20"], [], base), "2026-10-31T11:40:00-03:00")
  assert.equal(proximoHorario(["11:40", "18:20"], ["2026-10-31T11:40:00-03:00"], base), "2026-10-31T18:20:00-03:00")
  assert.equal(proximoHorario(["09:00"], [], base), "2026-11-01T09:00:00-03:00")
  assert.equal(semAcento("três música ligação"), "tres musica ligacao")
  assert.deepEqual(extrairJSON('```json\n{"a":1}\n```'), { a: 1 })
  assert.equal(mesclarConfig({ videosPorDia: 50, horarios: ["25:00", "18:00"] }).videosPorDia, 10)
  assert.deepEqual(mesclarConfig({ horarios: ["25:00", "18:00"] }).horarios, ["18:00"])
})

test("tiktok shop", () => {
  assert.match(assinar("seg", "/x", { b: "2", a: "1", sign: "z" }, ""), /^[0-9a-f]{64}$/)
  assert.ok(nota({ idProduto: "1", titulo: "", link: "", vendas30d: 1000, videosConcorrentes: 5, comissao: 0.1, imagens: [] }) > nota({ idProduto: "2", titulo: "", link: "", vendas30d: 1000, videosConcorrentes: 5000, comissao: 0.1, imagens: [] }))
})
