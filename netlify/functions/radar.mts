// Agendada todo dia às 06:00 de São Paulo (09:00 UTC; o Brasil não tem horário de verão):
// cria os anúncios do dia a partir da fila (e, na fase 2, do radar da TikTok Shop).
import type { Config, Context } from "@netlify/functions"
import { criarAnunciosDoDia } from "../lib/radar.mts"
import { disparar, urlBase } from "../lib/http.mts"

export default async (_req: Request, context: Context) => {
  const criados = await criarAnunciosDoDia()
  if (criados.length) await disparar(urlBase(null, context), "/interno/processar", {})
}

export const config: Config = { schedule: "0 9 * * *" }
