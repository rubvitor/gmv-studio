// Publicação no TikTok via API do Metricool (exige plano Advanced).
// POST https://app.metricool.com/api/v2/scheduler/posts?blogId=&userId= com cabeçalho X-Mc-Auth.
// Sem as variáveis, o app deixa cada vídeo pronto para postar pelo app do TikTok.

import type { Configuracoes } from "./config.mts"

function lerEnv(nome: string): string | undefined {
  return (globalThis as any).Netlify?.env?.get(nome) ?? process.env[nome]
}

function env(nome: string): string {
  const v = lerEnv(nome)
  if (!v) throw new Error(`variável ${nome} não configurada no Netlify`)
  return v
}

export function metricoolConfigurado(): boolean {
  return !!(lerEnv("METRICOOL_TOKEN") && lerEnv("METRICOOL_USER_ID"))
}

export async function agendarTikTok(o: {
  cfg: Configuracoes
  horarioISO: string // AAAA-MM-DDTHH:MM:SS-03:00
  videoUrl: string
  texto: string
  titulo: string
  autoPublicar: boolean
}): Promise<{ id: number; plannerUrl?: string }> {
  const dateTime = o.horarioISO.slice(0, 19)
  const corpo = {
    autoPublish: o.autoPublicar,
    descendants: [],
    draft: false,
    firstCommentText: "",
    hasNotReadNotes: false,
    media: [o.videoUrl],
    mediaAltText: [],
    providers: [{ network: "tiktok" }],
    publicationDate: { dateTime, timezone: "America/Sao_Paulo" },
    shortener: false,
    smartLinkData: { ids: [] },
    text: o.texto,
    tiktokData: {
      disableComment: false,
      disableDuet: false,
      disableStitch: false,
      privacyOption: "PUBLIC_TO_EVERYONE",
      commercialContentThirdParty: o.cfg.conteudoDeMarca,
      commercialContentOwnBrand: false,
      title: o.titulo.slice(0, 90),
      autoAddMusic: false,
      isAigc: o.cfg.rotuloIA,
    },
  }
  const url = `https://app.metricool.com/api/v2/scheduler/posts?blogId=${encodeURIComponent(
    o.cfg.metricoolBlogId,
  )}&userId=${encodeURIComponent(env("METRICOOL_USER_ID"))}`
  const r = await fetch(url, {
    method: "POST",
    headers: { "X-Mc-Auth": env("METRICOOL_TOKEN"), "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  })
  const txt = await r.text()
  if (!r.ok) throw new Error(`Metricool: HTTP ${r.status} ${txt.slice(0, 400)}`)
  let j: any = {}
  try {
    j = JSON.parse(txt)
  } catch {}
  const d = j.data || j
  return { id: d.id, plannerUrl: d.plannerUrl }
}

export function montarTexto(p: { descricao_pt: string; descricao_en: string; hashtags: string[] }): string {
  return `${p.descricao_pt.trim()}\n\n${p.descricao_en.trim()}\n\n${p.hashtags.join(" ")}`
}
