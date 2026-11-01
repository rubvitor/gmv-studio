// Pacote .zip (fotos + vídeos de referência) que os nós TikTokEntrada/LerFotos/LerVideos/Montagem usam.

import { arquivos, produtos, anuncios, type Anuncio, type Produto } from "./store.mts"
import { enviarAsset } from "./comfy.mts"
import { criarZip } from "./util.mts"
import { novoAnuncio } from "./radar.mts"
import { disparar } from "./http.mts"

/** Monta o zip, envia ao ComfyUI e põe o produto na fila. Lança erro se não houver foto. */
export async function montarPacote(p: Produto) {
  const itens: { nome: string; dados: Uint8Array }[] = []
  let n = 0
  for (const f of [...p.fotos, ...p.videos]) {
    const dados = await arquivos.ler(p.id, f.nome)
    if (!dados) continue
    let ext = f.nome.split(".").pop()?.toLowerCase() || (f.tipo.startsWith("video") ? "mp4" : "jpg")
    // fotos .webp da loja entram como .jpg: os nós leem pelo conteúdo, mas alguns filtram pela extensão
    if (ext === "webp") ext = "jpg"
    const prefixo = f.tipo.startsWith("video") ? "referencia" : "foto"
    itens.push({ nome: `${prefixo}_${String(++n).padStart(2, "0")}.${ext}`, dados })
  }
  if (!itens.some((i) => i.nome.startsWith("foto"))) throw new Error("nenhuma foto encontrada")
  p.zip = await enviarAsset(criarZip(itens), `gmv/${p.id}/pacote.zip`, "application/zip")
  p.status = "na_fila"
  p.erro = undefined
}

/** Com o pacote pronto: se você pediu "gerar assim que terminar", cria o anúncio e acorda o processamento. */
export async function depoisDoPacote(p: Produto, base: string): Promise<Anuncio | null> {
  if (!p.gerarAoTerminar || p.status !== "na_fila") return null
  const a = novoAnuncio(p.id)
  await anuncios.salvar(a)
  p.status = "usado"
  p.gerarAoTerminar = false
  await produtos.salvar(p)
  if (base) await disparar(base, "/interno/processar", {})
  return a
}
