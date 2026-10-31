// Máquina de estados de cada anúncio. Cada chamada de avancar() faz no máximo um passo que
// não bloqueia: envia um job, ou lê o resultado de um job terminado e decide o próximo.

import { lerConfig, produtos, anuncios, custos, type Anuncio, type Produto } from "./store.mts"
import * as comfy from "./comfy.mts"
import { grafoAnalise, grafoAnuncio, grafoQuadros, conferirRoteiro, type RefProduto } from "./workflow.mts"
import { planejarAnuncio, conferirImagens, type Plano } from "./claude.mts"
import { agendarTikTok, montarTexto } from "./metricool.mts"
import { custoGpu, hojeSP, proximoHorario } from "./util.mts"
import type { Configuracoes } from "./config.mts"

// estimativas para checar orçamento antes de enviar (US$)
const ESTIMATIVA = { analise: 0.03, previa: 0.06, video: 0.6, quadros: 0.05 }

function registrar(a: Anuncio, msg: string) {
  a.log.push({ em: new Date().toISOString(), msg })
  if (a.log.length > 80) a.log = a.log.slice(-80)
}

async function cabeNoOrcamento(cfg: Configuracoes, tipo: keyof typeof ESTIMATIVA): Promise<boolean> {
  const gasto = await custos.doDia(hojeSP())
  return gasto + ESTIMATIVA[tipo] <= cfg.orcamentoDiarioUSD
}

async function fotosDoProduto(p: Produto, max = 6) {
  const out: { bytes: Uint8Array; tipo: string }[] = []
  for (const f of p.fotos.slice(0, max)) {
    try {
      out.push({ bytes: await comfy.baixarAsset(f.asset.id), tipo: f.tipo })
    } catch {}
  }
  return out
}

async function lerTexto(saida?: comfy.SaidaJob): Promise<string> {
  if (!saida) return ""
  return new TextDecoder().decode(await comfy.baixarAsset(saida.id))
}

function refsDoPlano(p: Produto, plano: Plano): RefProduto[] {
  const refs: RefProduto[] = []
  for (const r of plano.recortes || []) {
    const f = p.fotos[r.foto]
    if (!f) continue
    const caixa = r.caixa?.length === 4 ? (r.caixa.map((x) => Math.min(1, Math.max(0, Number(x)))) as [number, number, number, number]) : null
    refs.push({ asset: f.asset, largura: f.largura, altura: f.altura, recorte: caixa })
    if (refs.length === 3) break
  }
  if (!refs.length && p.fotos[0]) refs.push({ asset: p.fotos[0].asset })
  return refs
}

async function enviar(a: Anuncio, tipo: NonNullable<Anuncio["tipoJob"]>, grafo: any) {
  const job = await comfy.enviarJob(grafo, { app: "gmv-studio", anuncio: a.id, etapa: tipo }, `${a.id}-${tipo}-${a.tentativas}-${a.semente}`)
  a.jobAtual = job.id
  a.tipoJob = tipo
  registrar(a, `job ${tipo} enviado (${job.id})`)
}

async function planejar(a: Anuncio, p: Produto, cfg: Configuracoes, correcoes = "") {
  const fotos = await fotosDoProduto(p)
  let plano = await planejarAnuncio({ cfg, link: p.link, observacoes: p.observacoes, ficha: a.ficha || "", estrutura: a.estrutura || "", fotos, correcoes })
  let problemas = conferirRoteiro(plano.roteiro)
  if (problemas.length) {
    registrar(a, `roteiro refeito: ${problemas.join("; ")}`)
    plano = await planejarAnuncio({
      cfg, link: p.link, observacoes: p.observacoes, ficha: a.ficha || "", estrutura: a.estrutura || "", fotos,
      correcoes: [correcoes, "Corrija o roteiro: " + problemas.join("; ")].filter(Boolean).join("\n"),
    })
    problemas = conferirRoteiro(plano.roteiro)
    if (problemas.length) throw new Error("roteiro fora das regras: " + problemas.join("; "))
  }
  a.plano = plano
  if (!p.nome && plano.nome_produto) {
    p.nome = plano.nome_produto
    await produtos.salvar(p)
  }
}

async function agendar(a: Anuncio, cfg: Configuracoes) {
  if (!a.video || !a.plano) throw new Error("anúncio sem vídeo ou plano")
  const todos = await anuncios.listar()
  const ocupados = todos.map((x) => x.publicacao?.horario).filter(Boolean) as string[]
  const horario = proximoHorario(cfg.horarios, ocupados)
  const url = await comfy.urlAssinada(a.video.id)
  const r = await agendarTikTok({ cfg, horarioISO: horario, videoUrl: url, texto: montarTexto(a.plano), titulo: a.plano.titulo_tiktok || a.plano.nome_produto, autoPublicar: true })
  a.publicacao = { horario, metricoolId: r.id, plannerUrl: r.plannerUrl }
  a.etapa = "agendado"
  registrar(a, `agendado no Metricool para ${horario}`)
}

export async function aprovarEAgendar(idAnuncio: string) {
  const a = await anuncios.ler(idAnuncio)
  if (!a) throw new Error("anúncio não encontrado")
  if (a.etapa !== "pronto") throw new Error(`anúncio está em "${a.etapa}", não em "pronto"`)
  await agendar(a, await lerConfig())
  await anuncios.salvar(a)
  return a
}

export async function avancar(idAnuncio: string): Promise<Anuncio | null> {
  const a = await anuncios.ler(idAnuncio)
  if (!a || ["agendado", "reprovado", "erro"].includes(a.etapa)) return a
  const cfg = await lerConfig()
  const p = await produtos.ler(a.produtoId)
  if (!p) {
    a.etapa = "erro"
    a.erro = "produto apagado"
    await anuncios.salvar(a)
    return a
  }
  try {
    // 1) há job em andamento? confere e trata o resultado
    if (a.jobAtual) {
      const job = await comfy.consultarJob(a.jobAtual)
      if (!comfy.terminal(job.status)) return a
      const usd = custoGpu(comfy.segundosDeGpu(job), cfg.precoGpuHoraUSD)
      a.custoUSD = Math.round((a.custoUSD + usd) * 10000) / 10000
      await custos.somar(hojeSP(), usd, `${a.id} ${a.tipoJob}`)
      const tipo = a.tipoJob
      a.jobAtual = undefined
      if (job.status !== "succeeded") throw new Error(`job ${tipo} terminou como ${job.status}: ${JSON.stringify(job.error || "").slice(0, 300)}`)
      const saidas = job.outputs || []

      if (tipo === "analise") {
        const textos = saidas.filter((s) => s.content_type?.startsWith("text") || s.type === "text" || s.name.endsWith(".txt"))
        a.ficha = await lerTexto(textos.find((s) => s.name.includes("ficha")))
        a.estrutura = await lerTexto(textos.find((s) => s.name.includes("estrutura")))
        a.etapa = "planejando"
        registrar(a, "análise do ComfyUI concluída")
      } else if (tipo === "previa") {
        const imgs = saidas.filter((s) => s.type === "image").sort((x, y) => x.name.localeCompare(y.name))
        a.previa = imgs.map((s) => s.id)
        const veredito = await conferirImagens({
          cfg, etapa: "previa", plano: a.plano!,
          imagens: await Promise.all(imgs.map(async (s) => ({ bytes: await comfy.baixarAsset(s.id), tipo: s.content_type || "image/png" }))),
          fotosProduto: await fotosDoProduto(p, 3),
        })
        a.veredictos.push({ ...veredito, etapa: "previa", em: new Date().toISOString() })
        if (veredito.aprovado) {
          registrar(a, "prévia aprovada na conferência")
          if (!(await cabeNoOrcamento(cfg, "video"))) {
            registrar(a, "aguardando orçamento do dia para gerar o vídeo")
          } else {
            await enviar(a, "video", grafoAnuncio({ textos: textosDe(a.plano!), zip: p.zip!, refs: refsDoPlano(p, a.plano!), semente: a.semente, prefixo: `gmv/${a.id}` }))
            a.etapa = "gerando"
          }
        } else if (a.tentativas + 1 < cfg.maxTentativasPrevia) {
          a.tentativas += 1
          a.semente += 7919
          registrar(a, `prévia reprovada (${veredito.problemas.join("; ")}); nova tentativa`)
          await planejar(a, p, cfg, veredito.correcoes)
          await enviar(a, "previa", grafoAnuncio({ textos: textosDe(a.plano!), zip: p.zip!, refs: refsDoPlano(p, a.plano!), semente: a.semente, previa: true, prefixo: `gmv/${a.id}` }))
        } else {
          a.etapa = "reprovado"
          a.erro = "prévia reprovada: " + veredito.problemas.join("; ")
        }
      } else if (tipo === "video") {
        const v = saidas.find((s) => s.type === "video" || s.content_type?.startsWith("video"))
        if (!v) throw new Error("job de vídeo terminou sem vídeo")
        a.video = { id: v.id, file_path: v.name }
        await enviar(a, "quadros", grafoQuadros(a.video))
        a.etapa = "conferindo"
      } else if (tipo === "quadros") {
        const imgs = saidas.filter((s) => s.type === "image").sort((x, y) => x.name.localeCompare(y.name))
        a.quadros = imgs.map((s) => s.id)
        const veredito = await conferirImagens({
          cfg, etapa: "video", plano: a.plano!,
          imagens: await Promise.all(imgs.map(async (s) => ({ bytes: await comfy.baixarAsset(s.id), tipo: s.content_type || "image/png" }))),
          fotosProduto: await fotosDoProduto(p, 2),
        })
        a.veredictos.push({ ...veredito, etapa: "video", em: new Date().toISOString() })
        if (!veredito.aprovado) {
          a.etapa = "reprovado"
          a.erro = "vídeo reprovado: " + veredito.problemas.join("; ")
        } else {
          a.etapa = "pronto"
          registrar(a, "vídeo aprovado na conferência")
          if (cfg.modoPublicacao === "automatico") await agendar(a, cfg)
        }
      }
      await anuncios.salvar(a)
      return a
    }

    // 2) sem job em andamento: inicia a próxima etapa
    if (a.etapa === "aguardando") {
      if (!p.zip) throw new Error("produto sem pacote de fotos/vídeos pronto")
      if (!(await cabeNoOrcamento(cfg, "analise"))) return a
      await enviar(a, "analise", grafoAnalise(p.zip))
      a.etapa = "analisando"
    } else if (a.etapa === "planejando") {
      if (!(await cabeNoOrcamento(cfg, "previa"))) return a
      await planejar(a, p, cfg)
      await enviar(a, "previa", grafoAnuncio({ textos: textosDe(a.plano!), zip: p.zip!, refs: refsDoPlano(p, a.plano!), semente: a.semente, previa: true, prefixo: `gmv/${a.id}` }))
      a.etapa = "previa"
    } else if (a.etapa === "previa" && a.veredictos.at(-1)?.etapa === "previa" && a.veredictos.at(-1)?.aprovado) {
      // prévia aprovada esperando orçamento para o vídeo
      if (!(await cabeNoOrcamento(cfg, "video"))) return a
      await enviar(a, "video", grafoAnuncio({ textos: textosDe(a.plano!), zip: p.zip!, refs: refsDoPlano(p, a.plano!), semente: a.semente, prefixo: `gmv/${a.id}` }))
      a.etapa = "gerando"
    }
    await anuncios.salvar(a)
    return a
  } catch (e: any) {
    a.etapa = "erro"
    a.erro = String(e?.message || e)
    registrar(a, "erro: " + a.erro)
    await anuncios.salvar(a)
    return a
  }
}

function textosDe(pl: Plano) {
  return { roteiro: pl.roteiro, produto: pl.produto_en, cenario: pl.cenario_en, acao_A: pl.acao_A, acao_B: pl.acao_B, acao_C: pl.acao_C }
}

export async function ativos(): Promise<Anuncio[]> {
  return (await anuncios.listar()).filter((a) => !["agendado", "reprovado", "erro", "pronto"].includes(a.etapa))
}
