// Sem a API do Metricool (plano grátis): o vídeo fica pronto com horário sugerido e você marca como postado.
import { test } from "node:test"
import assert from "node:assert/strict"
import { instalarServicosFalsos, prepararProduto, rodarAte } from "./mocks.mts"

process.env.COMFY_API_KEY = "x"
process.env.COMFY_DEPLOYMENT_URL = "https://dep.run.comfy.app"
process.env.ANTHROPIC_API_KEY = "x"
delete process.env.METRICOOL_TOKEN
delete process.env.METRICOOL_USER_ID

const { metricool } = instalarServicosFalsos()

test("sem Metricool: pronto para postar, depois postado", async () => {
  const { anuncios } = await import("../netlify/lib/store.mts")
  const { novoAnuncio } = await import("../netlify/lib/radar.mts")
  const { marcarPostado, aprovarEAgendar, avancar } = await import("../netlify/lib/pipeline.mts")
  await prepararProduto()
  const a = novoAnuncio("p1")
  await anuncios.salvar(a)
  const etapas = await rodarAte(a.id, ["pronto", "agendado", "erro"])
  let final = await anuncios.ler(a.id)
  assert.equal(final!.etapa, "pronto", JSON.stringify(final!.log))
  assert.equal(final!.publicacao!.via, "tiktok")
  assert.match(final!.publicacao!.horario, /T23:59:00-03:00$/)
  assert.equal(metricool.length, 0, "não deve chamar o Metricool")

  // continua parado em "pronto" nas próximas rodadas
  assert.equal((await avancar(a.id))!.etapa, "pronto")
  // aprovar pelo Metricool não é possível sem a API
  await assert.rejects(aprovarEAgendar(a.id), /Metricool/)

  await marcarPostado(a.id)
  final = await anuncios.ler(a.id)
  assert.equal(final!.etapa, "postado")
  assert.ok(final!.publicacao!.postadoEm)
  await assert.rejects(marcarPostado(a.id), /postado/)
  console.log("etapas:", etapas.join(" -> "))
})
