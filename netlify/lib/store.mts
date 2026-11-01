// Persistência em Netlify Blobs (consistência forte para o estado do pipeline).

import { getStore } from "@netlify/blobs"
import { mesclarConfig, type Configuracoes } from "./config.mts"
import type { Asset } from "./workflow.mts"
import type { Plano, Veredito } from "./claude.mts"

const loja = (nome: string) => getStore({ name: nome, consistency: "strong" })

export type Arquivo = { asset: Asset; nome: string; tipo: string; tamanho: number; largura?: number; altura?: number }

export type Produto = {
  id: string
  criadoEm: string
  link: string
  nome: string
  observacoes: string
  prioridade: number
  status: "rascunho" | "preparando" | "na_fila" | "usado" | "erro"
  fotos: Arquivo[]
  videos: Arquivo[]
  zip?: Asset
  erro?: string
}

export type EtapaVideo =
  | "aguardando"
  | "analisando"
  | "planejando"
  | "previa"
  | "gerando"
  | "conferindo"
  | "pronto"
  | "agendado"
  | "postado" // postado por você no app do TikTok (com o produto anexado)
  | "reprovado"
  | "erro"

export type Anuncio = {
  id: string
  produtoId: string
  criadoEm: string
  dia: string // AAAA-MM-DD (São Paulo)
  etapa: EtapaVideo
  semente: number
  tentativas: number
  jobAtual?: string
  tipoJob?: "analise" | "previa" | "video" | "quadros"
  ficha?: string
  estrutura?: string
  plano?: Plano
  previa?: string[] // ids de assets das cenas
  video?: Asset
  quadros?: string[]
  veredictos: (Veredito & { etapa: string; em: string })[]
  custoUSD: number
  // via "metricool": agendado pela API; via "tiktok": horário sugerido para você postar no app
  publicacao?: { horario: string; via?: "metricool" | "tiktok"; metricoolId?: number; plannerUrl?: string; postadoEm?: string }
  erro?: string
  log: { em: string; msg: string }[]
}

export async function lerConfig(): Promise<Configuracoes> {
  const c = (await loja("config").get("atual", { type: "json" })) as Partial<Configuracoes> | null
  return mesclarConfig(c)
}

export async function salvarConfig(c: Partial<Configuracoes>): Promise<Configuracoes> {
  const atual = await lerConfig()
  const nova = mesclarConfig({ ...atual, ...c })
  await loja("config").setJSON("atual", nova)
  return nova
}

async function listar<T>(nome: string): Promise<T[]> {
  const s = loja(nome)
  const { blobs } = await s.list()
  const itens = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })))
  return itens.filter(Boolean) as T[]
}

export const produtos = {
  listar: () => listar<Produto>("produtos"),
  ler: (id: string) => loja("produtos").get(id, { type: "json" }) as Promise<Produto | null>,
  salvar: (p: Produto) => loja("produtos").setJSON(p.id, p),
  apagar: (id: string) => loja("produtos").delete(id),
}

export const anuncios = {
  listar: () => listar<Anuncio>("anuncios"),
  ler: (id: string) => loja("anuncios").get(id, { type: "json" }) as Promise<Anuncio | null>,
  salvar: (a: Anuncio) => loja("anuncios").setJSON(a.id, a),
  apagar: (id: string) => loja("anuncios").delete(id),
}

export const arquivos = {
  salvarParte: (upload: string, n: number, dados: ArrayBuffer) => loja("uploads").set(`${upload}/${String(n).padStart(5, "0")}`, dados),
  meta: (upload: string, m?: any) =>
    m === undefined ? loja("uploads").get(`${upload}/meta`, { type: "json" }) : loja("uploads").setJSON(`${upload}/meta`, m),
  async juntar(upload: string): Promise<Uint8Array> {
    const s = loja("uploads")
    const { blobs } = await s.list({ prefix: `${upload}/` })
    const partes = blobs.map((b) => b.key).filter((k) => !k.endsWith("/meta")).sort()
    const bufs: Uint8Array[] = []
    for (const k of partes) bufs.push(new Uint8Array((await s.get(k, { type: "arrayBuffer" })) as ArrayBuffer))
    const total = bufs.reduce((t, b) => t + b.length, 0)
    const out = new Uint8Array(total)
    let pos = 0
    for (const b of bufs) {
      out.set(b, pos)
      pos += b.length
    }
    return out
  },
  async guardar(produtoId: string, nome: string, dados: Uint8Array) {
    await loja("arquivos").set(`${produtoId}/${nome}`, dados)
  },
  async ler(produtoId: string, nome: string): Promise<Uint8Array | null> {
    const b = (await loja("arquivos").get(`${produtoId}/${nome}`, { type: "arrayBuffer" })) as ArrayBuffer | null
    return b ? new Uint8Array(b) : null
  },
  async limparUpload(upload: string) {
    const s = loja("uploads")
    const { blobs } = await s.list({ prefix: `${upload}/` })
    await Promise.all(blobs.map((b) => s.delete(b.key)))
  },
}

/** Trava simples para não rodar dois processamentos ao mesmo tempo. */
export const trava = {
  async pegar(nome: string, validadeMs: number): Promise<string | null> {
    const s = loja("travas")
    const atual = (await s.get(nome, { type: "json" })) as { dono: string; em: number } | null
    if (atual && Date.now() - atual.em < validadeMs) return null
    const dono = Math.random().toString(36).slice(2)
    await s.setJSON(nome, { dono, em: Date.now() })
    const conf = (await s.get(nome, { type: "json" })) as { dono: string } | null
    return conf?.dono === dono ? dono : null
  },
  async soltar(nome: string, dono: string) {
    const s = loja("travas")
    const atual = (await s.get(nome, { type: "json" })) as { dono: string } | null
    if (atual?.dono === dono) await s.delete(nome)
  },
}

export const custos = {
  async somar(dia: string, usd: number, nota: string) {
    const s = loja("custos")
    const atual = ((await s.get(dia, { type: "json" })) as { usd: number; itens: any[] } | null) || { usd: 0, itens: [] }
    atual.usd = Math.round((atual.usd + usd) * 10000) / 10000
    atual.itens.push({ em: new Date().toISOString(), usd, nota })
    await s.setJSON(dia, atual)
    return atual.usd
  },
  async doDia(dia: string): Promise<number> {
    const x = (await loja("custos").get(dia, { type: "json" })) as { usd: number } | null
    return x?.usd || 0
  },
  async ultimos(n = 30) {
    const s = loja("custos")
    const { blobs } = await s.list()
    const chaves = blobs.map((b) => b.key).sort().slice(-n)
    return Promise.all(chaves.map(async (k) => ({ dia: k, ...((await s.get(k, { type: "json" })) as any) })))
  },
}
