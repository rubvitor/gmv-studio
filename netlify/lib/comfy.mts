// Cliente da API v2 do deployment do ComfyUI (https://{deployment}.run.comfy.app).
// Auth: Authorization: Bearer <COMFY_API_KEY>. Docs: https://docs.comfy.org/api-reference/v2/overview

import type { Asset, Grafo } from "./workflow.mts"

export type SaidaJob = {
  node_id: string
  name: string
  type: string
  content_type: string
  size_bytes: number
  id: string
  url?: string
}

export type Job = {
  id: string
  status: "queued" | "running" | "succeeded" | "canceling" | "canceled" | "failed" | "expired"
  created_at?: string
  started_at?: string | null
  completed_at?: string | null
  outputs?: SaidaJob[]
  error?: any
  progress?: { value?: number; nodes_done?: number; nodes_total?: number }
}

function env(nome: string): string {
  const v = (globalThis as any).Netlify?.env?.get(nome) ?? process.env[nome]
  if (!v) throw new Error(`variável de ambiente ${nome} não configurada no Netlify`)
  return v
}

function base(): string {
  return env("COMFY_DEPLOYMENT_URL").replace(/\/+$/, "")
}

function auth(): Record<string, string> {
  return { Authorization: `Bearer ${env("COMFY_API_KEY")}` }
}

async function erroLegivel(r: Response, oque: string): Promise<never> {
  let corpo = ""
  try {
    corpo = await r.text()
  } catch {}
  throw new Error(`${oque}: HTTP ${r.status} ${corpo.slice(0, 500)}`)
}

export async function enviarAsset(
  dados: Uint8Array,
  file_path: string,
  content_type: string,
  expiraEmSegundos?: number,
): Promise<Asset> {
  const fd = new FormData()
  fd.append("file", new Blob([dados], { type: content_type }), file_path.split("/").pop() || file_path)
  fd.append("content_type", content_type)
  fd.append("file_path", file_path)
  if (expiraEmSegundos) fd.append("expires_in", String(Math.max(60, Math.min(604800, expiraEmSegundos))))
  const r = await fetch(`${base()}/api/v2/assets`, { method: "POST", headers: auth(), body: fd })
  if (!r.ok) await erroLegivel(r, "envio de arquivo ao ComfyUI")
  const a = (await r.json()) as { id: string; file_path?: string }
  return { id: a.id, file_path: a.file_path || file_path }
}

export async function enviarJob(workflow: Grafo, metadata: Record<string, string>, chave?: string): Promise<Job> {
  const headers: Record<string, string> = { ...auth(), "Content-Type": "application/json" }
  if (chave) headers["Idempotency-Key"] = chave
  const r = await fetch(`${base()}/api/v2/jobs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ workflow, metadata }),
  })
  if (!r.ok) await erroLegivel(r, "envio de job ao ComfyUI")
  return (await r.json()) as Job
}

export async function consultarJob(idJob: string): Promise<Job> {
  const r = await fetch(`${base()}/api/v2/jobs/${idJob}`, { headers: auth() })
  if (!r.ok) await erroLegivel(r, "consulta de job")
  return (await r.json()) as Job
}

export async function cancelarJob(idJob: string): Promise<void> {
  await fetch(`${base()}/api/v2/jobs/${idJob}/cancel`, { method: "POST", headers: auth() })
}

/** URL assinada (sem autenticação, válida por algumas horas) para um asset. */
export async function urlAssinada(idAsset: string): Promise<string> {
  const r = await fetch(`${base()}/api/v2/assets/${idAsset}/content`, { headers: auth(), redirect: "manual" })
  const loc = r.headers.get("location")
  if (r.status >= 300 && r.status < 400 && loc) return loc
  // alguns ambientes devolvem os bytes direto; nesse caso usa os metadados
  const m = await fetch(`${base()}/api/v2/assets/${idAsset}`, { headers: auth() })
  if (!m.ok) await erroLegivel(m, "metadados do arquivo")
  const j = (await m.json()) as { url?: string }
  if (!j.url) throw new Error("asset sem URL")
  return j.url
}

export async function baixarAsset(idAsset: string): Promise<Uint8Array> {
  const url = await urlAssinada(idAsset)
  const r = await fetch(url) // sem cabeçalho de auth (URL assinada)
  if (!r.ok) await erroLegivel(r, "download de arquivo")
  return new Uint8Array(await r.arrayBuffer())
}

export function segundosDeGpu(j: Job): number {
  if (!j.started_at || !j.completed_at) return 0
  return Math.max(0, (new Date(j.completed_at).getTime() - new Date(j.started_at).getTime()) / 1000)
}

export const terminal = (s: Job["status"]) => ["succeeded", "canceled", "failed", "expired"].includes(s)
