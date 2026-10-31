// Radar diário: escolhe os produtos do dia e cria os anúncios.
// Fase 1: usa a fila de produtos cadastrados no app (maior prioridade primeiro).
// Fase 2: com a API de afiliado da TikTok Shop configurada, completa a fila sozinho.

import { lerConfig, produtos, anuncios, type Anuncio, type Produto } from "./store.mts"
import { hojeSP, id } from "./util.mts"
import { buscarCandidatos, configurada as tiktokConfigurada, nota } from "./tiktokshop.mts"

export function novoAnuncio(produtoId: string): Anuncio {
  return {
    id: id("a_"),
    produtoId,
    criadoEm: new Date().toISOString(),
    dia: hojeSP(),
    etapa: "aguardando",
    semente: Math.floor(Math.random() * 1e9),
    tentativas: 0,
    veredictos: [],
    custoUSD: 0,
    log: [{ em: new Date().toISOString(), msg: "criado" }],
  }
}

export async function criarAnunciosDoDia(): Promise<Anuncio[]> {
  const cfg = await lerConfig()
  const hoje = hojeSP()
  const todos = await anuncios.listar()
  const jaHoje = todos.filter((a) => a.dia === hoje).length
  const faltam = Math.max(0, cfg.videosPorDia - jaHoje)
  if (!faltam) return []

  if (cfg.radarAutomatico && tiktokConfigurada()) {
    // Fase 2: candidatos ficam como rascunho para o app buscar fotos e montar o pacote.
    const existentes = new Set((await produtos.listar()).map((p) => p.link))
    const candidatos = await buscarCandidatos(cfg.nichos)
    for (const c of candidatos.slice(0, faltam * 2)) {
      if (!c.link || existentes.has(c.link)) continue
      const p: Produto = {
        id: id("p_"), criadoEm: new Date().toISOString(), link: c.link, nome: c.titulo,
        observacoes: `Encontrado pelo radar (nota ${nota(c)}).`, prioridade: 2, status: "rascunho", fotos: [], videos: [],
      }
      await produtos.salvar(p)
    }
  }

  const fila = (await produtos.listar())
    .filter((p) => p.status === "na_fila" && p.zip)
    .sort((a, b) => b.prioridade - a.prioridade || a.criadoEm.localeCompare(b.criadoEm))
    .slice(0, faltam)
  const criados: Anuncio[] = []
  for (const p of fila) {
    const a = novoAnuncio(p.id)
    await anuncios.salvar(a)
    p.status = "usado"
    await produtos.salvar(p)
    criados.push(a)
  }
  return criados
}
