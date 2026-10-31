// Fase 2 — API de afiliado da TikTok Shop (radar de produtos, vitrine e post com produto).
// Só entra em uso quando o app de afiliado estiver aprovado no Partner Center e as variáveis
// TIKTOK_SHOP_APP_KEY, TIKTOK_SHOP_APP_SECRET e TIKTOK_SHOP_ACCESS_TOKEN existirem no Netlify.
// Os caminhos dos endpoints são confirmados na documentação do Partner Center depois do cadastro;
// por isso ficam em TIKTOK_SHOP_ENDPOINTS (JSON) em vez de fixos no código.

import { createHmac } from "node:crypto"

const BASE = "https://open-api.tiktokglobalshop.com"

function env(nome: string): string | undefined {
  return (globalThis as any).Netlify?.env?.get(nome) ?? process.env[nome]
}

export function configurada(): boolean {
  return !!(env("TIKTOK_SHOP_APP_KEY") && env("TIKTOK_SHOP_APP_SECRET") && env("TIKTOK_SHOP_ACCESS_TOKEN"))
}

/** Assinatura padrão da Open API da TikTok Shop (HMAC-SHA256 em hex). */
export function assinar(segredo: string, caminho: string, params: Record<string, string>, corpo = ""): string {
  const chaves = Object.keys(params)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort()
  const base = segredo + caminho + chaves.map((k) => k + params[k]).join("") + corpo + segredo
  return createHmac("sha256", segredo).update(base).digest("hex")
}

async function chamar(metodo: "GET" | "POST", caminho: string, params: Record<string, string> = {}, corpo?: any) {
  const app_key = env("TIKTOK_SHOP_APP_KEY")!
  const segredo = env("TIKTOK_SHOP_APP_SECRET")!
  const q: Record<string, string> = { app_key, timestamp: String(Math.floor(Date.now() / 1000)), ...params }
  const body = corpo ? JSON.stringify(corpo) : ""
  q.sign = assinar(segredo, caminho, q, body)
  const url = `${BASE}${caminho}?${new URLSearchParams(q)}`
  const r = await fetch(url, {
    method: metodo,
    headers: { "x-tts-access-token": env("TIKTOK_SHOP_ACCESS_TOKEN")!, "content-type": "application/json" },
    body: body || undefined,
  })
  const j = await r.json()
  if (!r.ok || (j.code && j.code !== 0)) throw new Error(`TikTok Shop ${caminho}: ${j.message || r.status}`)
  return j.data
}

function endpoints(): Record<string, string> {
  try {
    return JSON.parse(env("TIKTOK_SHOP_ENDPOINTS") || "{}")
  } catch {
    return {}
  }
}

export type Candidato = {
  idProduto: string
  titulo: string
  link: string
  comissao?: number
  vendas30d?: number
  videosConcorrentes?: number
  preco?: number
  imagens: string[]
}

/** Nota de oportunidade: demanda subindo, pouca concorrência de vídeos, boa comissão. */
export function nota(c: Candidato): number {
  const vendas = Math.log10(1 + (c.vendas30d || 0)) * 30
  const concorrencia = -Math.log10(1 + (c.videosConcorrentes || 0)) * 20
  const comissao = (c.comissao || 0) * 100
  return Math.round(vendas + concorrencia + comissao)
}

export async function buscarCandidatos(palavras: string[]): Promise<Candidato[]> {
  const ep = endpoints().buscar_produtos
  if (!configurada() || !ep) return []
  const resultados: Candidato[] = []
  for (const termo of palavras) {
    const data = await chamar("POST", ep, { page_size: "20" }, { title_keywords: [termo] })
    for (const p of data?.products || []) {
      resultados.push({
        idProduto: String(p.id),
        titulo: p.title,
        link: p.detail_link || "",
        comissao: Number(p.commission?.rate || 0) / 10000,
        vendas30d: Number(p.sales || 0),
        preco: Number(p.price?.floor_price || 0),
        imagens: p.main_images?.map((i: any) => i.url) || [],
      })
    }
  }
  return resultados.sort((a, b) => nota(b) - nota(a))
}

export async function adicionarNaVitrine(idProduto: string): Promise<void> {
  const ep = endpoints().adicionar_vitrine
  if (!configurada() || !ep) throw new Error("API da TikTok Shop ainda não configurada")
  await chamar("POST", ep, {}, { product_ids: [idProduto] })
}
