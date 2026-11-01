// Pipeline inteiro com a API do Metricool configurada: termina agendado (precisa do stub de @netlify/blobs em node_modules).
import { test } from "node:test"
import assert from "node:assert/strict"
import { instalarServicosFalsos, prepararProduto, rodarAte } from "./mocks.mts"

process.env.COMFY_API_KEY = "x"
process.env.COMFY_DEPLOYMENT_URL = "https://dep.run.comfy.app"
process.env.ANTHROPIC_API_KEY = "x"
process.env.METRICOOL_TOKEN = "x"
process.env.METRICOOL_USER_ID = "1"

const { enviados, metricool } = instalarServicosFalsos()

test("anúncio vai de aguardando até agendado", async () => {
  const { produtos, anuncios } = await import("../netlify/lib/store.mts")
  const { novoAnuncio } = await import("../netlify/lib/radar.mts")
  await prepararProduto()
  const a = novoAnuncio("p1")
  await anuncios.salvar(a)
  const etapas = await rodarAte(a.id, ["agendado", "erro"])
  const final = await anuncios.ler(a.id)
  assert.equal(final!.etapa, "agendado", JSON.stringify(final!.log))
  assert.equal(final!.previa!.join(","), "imgA,imgB,imgC")
  assert.equal(final!.publicacao!.metricoolId, 99)
  assert.equal(final!.publicacao!.via, "metricool")
  assert.equal(metricool.length, 1)
  assert.ok(final!.custoUSD > 0)
  assert.deepEqual(enviados.map((e) => e.metadata.etapa), ["analise", "previa", "video", "quadros"])
  assert.equal(enviados[1].workflow["620"].class_type, "ImageCrop")
  const p = await produtos.ler("p1")
  assert.equal(p!.nome, "Fone Bettdow")
  console.log("etapas:", etapas.join(" -> "))
})
