// Segundo plano: monta o .zip (fotos + vídeos de referência) que os nós TikTokEntrada/LerFotos/LerVideos/Montagem usam.
import type { Config } from "@netlify/functions"
import { interno } from "../lib/http.mts"
import { arquivos, produtos } from "../lib/store.mts"
import { enviarAsset } from "../lib/comfy.mts"
import { criarZip } from "../lib/util.mts"

export default async (req: Request) => {
  if (!interno(req)) return
  const { produtoId } = await req.json()
  const p = await produtos.ler(produtoId)
  if (!p) return
  try {
    const itens: { nome: string; dados: Uint8Array }[] = []
    let n = 0
    for (const f of [...p.fotos, ...p.videos]) {
      const dados = await arquivos.ler(p.id, f.nome)
      if (!dados) continue
      const ext = f.nome.split(".").pop()?.toLowerCase() || (f.tipo.startsWith("video") ? "mp4" : "jpg")
      const prefixo = f.tipo.startsWith("video") ? "referencia" : "foto"
      itens.push({ nome: `${prefixo}_${String(++n).padStart(2, "0")}.${ext}`, dados })
    }
    if (!itens.some((i) => i.nome.startsWith("foto"))) throw new Error("nenhuma foto encontrada")
    const zip = criarZip(itens)
    p.zip = await enviarAsset(zip, `gmv/${p.id}/pacote.zip`, "application/zip")
    p.status = "na_fila"
    p.erro = undefined
  } catch (e: any) {
    p.status = "erro"
    p.erro = String(e?.message || e)
  }
  await produtos.salvar(p)
}

export const config: Config = { path: "/interno/preparar", background: true }
