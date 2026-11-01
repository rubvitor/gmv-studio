// Segundo plano: busca fotos, informações e vídeos de criadores na página do produto, monta o pacote e põe na fila.
import type { Config, Context } from "@netlify/functions"
import { interno, urlBase } from "../lib/http.mts"
import { produtos } from "../lib/store.mts"
import { coletar } from "../lib/coleta.mts"
import { montarPacote, depoisDoPacote } from "../lib/pacote.mts"

export default async (req: Request, context: Context) => {
  if (!interno(req)) return
  const { produtoId } = await req.json()
  const p = await produtos.ler(produtoId)
  if (!p) return
  try {
    p.status = "coletando"
    p.erro = undefined
    await produtos.salvar(p)
    await coletar(p)
    await produtos.salvar(p)
    await montarPacote(p)
    await produtos.salvar(p)
    await depoisDoPacote(p, urlBase(req, context))
  } catch (e: any) {
    p.status = "erro"
    p.erro = String(e?.message || e)
    await produtos.salvar(p)
  }
}

export const config: Config = { path: "/interno/coletar", background: true }
