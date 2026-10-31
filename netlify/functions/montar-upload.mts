// Segundo plano: junta as partes de um upload, guarda o arquivo e envia ao ComfyUI.
import type { Config } from "@netlify/functions"
import { interno } from "../lib/http.mts"
import { arquivos, produtos } from "../lib/store.mts"
import { enviarAsset } from "../lib/comfy.mts"

export default async (req: Request) => {
  if (!interno(req)) return
  const { upload } = await req.json()
  const meta = (await arquivos.meta(upload)) as any
  if (!meta) return
  const dados = await arquivos.juntar(upload)
  const nomeFinal = `${Date.now()}_${meta.nome}`
  await arquivos.guardar(meta.produtoId, nomeFinal, dados)
  const asset = await enviarAsset(dados, `gmv/${meta.produtoId}/${nomeFinal}`, meta.tipo)
  const p = await produtos.ler(meta.produtoId)
  if (p) {
    const item = { asset, nome: nomeFinal, tipo: meta.tipo, tamanho: dados.length, largura: meta.largura, altura: meta.altura }
    if (meta.categoria === "video") p.videos.push(item)
    else p.fotos.push(item)
    p.zip = undefined
    if (p.status === "na_fila") p.status = "rascunho"
    await produtos.salvar(p)
  }
  await arquivos.limparUpload(upload)
}

export const config: Config = { path: "/interno/montar-upload", background: true }
