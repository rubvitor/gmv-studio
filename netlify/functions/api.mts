// API REST do GMV Studio (usada pelo app e disponível para integrações).
import type { Config, Context } from "@netlify/functions"
import { lerConfig, salvarConfig, produtos, anuncios, arquivos, custos, type Produto, type Anuncio } from "../lib/store.mts"
import { autorizado, json, erro, disparar, urlBase, env } from "../lib/http.mts"
import { aprovarEAgendar, marcarPostado } from "../lib/pipeline.mts"
import { metricoolConfigurado } from "../lib/metricool.mts"
import { coletaConfigurada } from "../lib/coleta.mts"
import { criarAnunciosDoDia, novoAnuncio } from "../lib/radar.mts"
import * as comfy from "../lib/comfy.mts"
import { hojeSP, id } from "../lib/util.mts"
import { configurada as tiktokConfigurada } from "../lib/tiktokshop.mts"

const TAM_PARTE = 3_500_000 // bytes por parte de upload (limite de 6 MB por requisição)

export default async (req: Request, context: Context) => {
  if (!autorizado(req)) return erro("não autorizado", 401)
  const url = new URL(req.url)
  const partes = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean)
  const [recurso, idRec, acao, extra] = partes
  const m = req.method
  const base = urlBase(req, context)

  try {
    // ----- status -----
    if (recurso === "status" && m === "GET") {
      const cfg = await lerConfig()
      const [ps, as] = await Promise.all([produtos.listar(), anuncios.listar()])
      return json({
        variaveis: {
          COMFY_API_KEY: !!env("COMFY_API_KEY"),
          COMFY_DEPLOYMENT_URL: !!env("COMFY_DEPLOYMENT_URL"),
          ANTHROPIC_API_KEY: !!env("ANTHROPIC_API_KEY"),
          METRICOOL_TOKEN: !!env("METRICOOL_TOKEN"),
          METRICOOL_USER_ID: !!env("METRICOOL_USER_ID"),
          APIFY_TOKEN: coletaConfigurada(),
          TIKTOK_SHOP: tiktokConfigurada(),
        },
        // true: o app busca fotos, informações e vídeos na página do produto a partir do link
        coleta: coletaConfigurada(),
        // false: sem API do Metricool, os vídeos ficam prontos para postar pelo app do TikTok
        metricool: metricoolConfigurado(),
        config: cfg,
        hoje: hojeSP(),
        custoHojeUSD: await custos.doDia(hojeSP()),
        produtos: { total: ps.length, naFila: ps.filter((p) => p.status === "na_fila").length },
        anuncios: contar(as),
      })
    }

    // ----- configurações -----
    if (recurso === "config") {
      if (m === "GET") return json(await lerConfig())
      if (m === "PUT") return json(await salvarConfig(await req.json()))
    }

    // ----- produtos -----
    if (recurso === "produtos") {
      if (!idRec && m === "GET") {
        const ps = await produtos.listar()
        return json(ps.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)))
      }
      if (!idRec && m === "POST") {
        const b = await req.json()
        if (!b.link) return erro("informe o link do produto")
        const p: Produto = {
          id: id("p_"),
          criadoEm: new Date().toISOString(),
          link: String(b.link).trim(),
          nome: String(b.nome || "").trim(),
          observacoes: String(b.observacoes || "").trim(),
          prioridade: Number(b.prioridade) || 3,
          status: "rascunho",
          fotos: [],
          videos: [],
          gerarAoTerminar: !!b.gerarAoTerminar,
          linksVideos: linksDeVideo(b.linksVideos),
        }
        await produtos.salvar(p)
        return json(p, 201)
      }
      const p = idRec ? await produtos.ler(idRec) : null
      if (!p) return erro("produto não encontrado", 404)
      if (!acao && m === "GET") return json(p)
      if (!acao && m === "PATCH") {
        const b = await req.json()
        for (const k of ["link", "nome", "observacoes", "prioridade"] as const) if (k in b) (p as any)[k] = b[k]
        if ("linksVideos" in b) p.linksVideos = linksDeVideo(b.linksVideos)
        await produtos.salvar(p)
        return json(p)
      }
      if (!acao && m === "DELETE") {
        await produtos.apagar(p.id)
        return json({ ok: true })
      }
      if (acao === "fila" && m === "POST") {
        if (!p.fotos.length) return erro("envie pelo menos uma foto do produto")
        p.status = "preparando"
        await produtos.salvar(p)
        await disparar(base, "/interno/preparar", { produtoId: p.id })
        return json(p, 202)
      }
      if (acao === "coletar" && m === "POST") {
        if (!coletaConfigurada()) return erro("configure APIFY_TOKEN no Netlify para buscar na TikTok Shop")
        if (p.status === "coletando") return json(p, 202)
        p.status = "coletando"
        p.erro = undefined
        await produtos.salvar(p)
        await disparar(base, "/interno/coletar", { produtoId: p.id })
        return json(p, 202)
      }
      if (acao === "arquivo" && extra && m === "DELETE") {
        p.fotos = p.fotos.filter((f) => f.asset.id !== extra)
        p.videos = p.videos.filter((f) => f.asset.id !== extra)
        p.zip = undefined
        if (p.status === "na_fila") p.status = "rascunho"
        await produtos.salvar(p)
        return json(p)
      }
    }

    // ----- uploads em partes -----
    if (recurso === "uploads") {
      if (!idRec && m === "POST") {
        const b = await req.json()
        const p = await produtos.ler(b.produtoId)
        if (!p) return erro("produto não encontrado", 404)
        const upload = id("u_")
        await arquivos.meta(upload, {
          produtoId: p.id,
          nome: String(b.nome || "arquivo").replace(/[^\w.\-]+/g, "_").slice(-80),
          tipo: String(b.tipo || "application/octet-stream"),
          tamanho: Number(b.tamanho) || 0,
          largura: Number(b.largura) || undefined,
          altura: Number(b.altura) || undefined,
          categoria: b.categoria === "video" ? "video" : "foto",
        })
        return json({ upload, tamanhoParte: TAM_PARTE }, 201)
      }
      if (idRec && acao && m === "PUT" && /^\d+$/.test(acao)) {
        const dados = await req.arrayBuffer()
        if (dados.byteLength > TAM_PARTE + 1024) return erro("parte grande demais")
        await arquivos.salvarParte(idRec, Number(acao), dados)
        return json({ ok: true })
      }
      if (idRec && acao === "concluir" && m === "POST") {
        await disparar(base, "/interno/montar-upload", { upload: idRec })
        return json({ ok: true }, 202)
      }
    }

    // ----- anúncios -----
    if (recurso === "anuncios") {
      if (!idRec && m === "GET") {
        const as = await anuncios.listar()
        return json(as.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)).map(resumo))
      }
      if (!idRec && m === "POST") {
        const b = await req.json()
        const p = await produtos.ler(b.produtoId)
        if (!p) return erro("produto não encontrado", 404)
        if (p.status !== "na_fila" && p.status !== "usado") return erro("o produto ainda não está pronto (coloque na fila)")
        const a = novoAnuncio(p.id)
        await anuncios.salvar(a)
        await disparar(base, "/interno/processar", {})
        return json(a, 201)
      }
      const a = idRec ? await anuncios.ler(idRec) : null
      if (!a) return erro("anúncio não encontrado", 404)
      if (!acao && m === "GET") return json(a)
      if (!acao && m === "DELETE") {
        await anuncios.apagar(a.id)
        return json({ ok: true })
      }
      if (acao === "aprovar" && m === "POST") return json(await aprovarEAgendar(a.id))
      if (acao === "postado" && m === "POST") return json(await marcarPostado(a.id))
      if (acao === "refazer" && m === "POST") {
        if (a.jobAtual) await comfy.cancelarJob(a.jobAtual).catch(() => {})
        Object.assign(a, { etapa: a.ficha ? "planejando" : "aguardando", jobAtual: undefined, tipoJob: undefined, erro: undefined, tentativas: 0, semente: Math.floor(Math.random() * 1e9), previa: undefined, video: undefined, quadros: undefined, publicacao: undefined })
        a.log.push({ em: new Date().toISOString(), msg: "refazer pedido pelo app" })
        await anuncios.salvar(a)
        await disparar(base, "/interno/processar", {})
        return json(a)
      }
      if (acao === "midia" && extra && m === "GET") {
        return Response.redirect(await comfy.urlAssinada(extra), 302)
      }
    }

    // ----- custos e ações -----
    if (recurso === "custos" && m === "GET") return json(await custos.ultimos(30))
    if (recurso === "radar" && idRec === "agora" && m === "POST") {
      const criados = await criarAnunciosDoDia()
      await disparar(base, "/interno/processar", {})
      return json({ criados: criados.length })
    }
    if (recurso === "processar" && idRec === "agora" && m === "POST") {
      await disparar(base, "/interno/processar", {})
      return json({ ok: true }, 202)
    }

    return erro("rota não encontrada", 404)
  } catch (e: any) {
    return erro(String(e?.message || e), 500)
  }
}

/** Links de vídeos do TikTok (lista ou texto com um por linha), no máximo 6. */
function linksDeVideo(x: unknown): string[] {
  const lista = Array.isArray(x) ? x : String(x || "").split(/[\s,]+/)
  return [...new Set(lista.map((u) => String(u).trim()).filter((u) => /^https:\/\/([a-z]+\.)?tiktok\.com\//i.test(u)))].slice(0, 6)
}

function resumo(a: Anuncio) {
  return {
    id: a.id, produtoId: a.produtoId, criadoEm: a.criadoEm, dia: a.dia, etapa: a.etapa, custoUSD: a.custoUSD,
    nome: a.plano?.nome_produto, previa: a.previa, video: a.video, publicacao: a.publicacao, erro: a.erro,
    ultimoLog: a.log.at(-1),
  }
}

function contar(as: Anuncio[]) {
  const c: Record<string, number> = {}
  for (const a of as) c[a.etapa] = (c[a.etapa] || 0) + 1
  return c
}

export const config: Config = { path: "/api/*" }
