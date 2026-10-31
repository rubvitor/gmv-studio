// Agendada a cada 3 minutos: acorda o processamento em segundo plano (a função agendada só pode durar 30 s).
import type { Config, Context } from "@netlify/functions"
import { disparar, urlBase } from "../lib/http.mts"
import { ativos } from "../lib/pipeline.mts"

export default async (_req: Request, context: Context) => {
  if (!(await ativos()).length) return
  await disparar(urlBase(null, context), "/interno/processar", {})
}

export const config: Config = { schedule: "*/3 * * * *" }
