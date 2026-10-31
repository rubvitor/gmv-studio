// Segundo plano (até 15 min): avança todos os anúncios ativos, um passo por vez.
import type { Config } from "@netlify/functions"
import { interno } from "../lib/http.mts"
import { ativos, avancar } from "../lib/pipeline.mts"
import { trava } from "../lib/store.mts"

export default async (req: Request) => {
  if (!interno(req)) return
  const dono = await trava.pegar("processar", 14 * 60_000)
  if (!dono) return // já tem um processamento rodando
  const inicio = Date.now()
  try {
    // algumas voltas: um anúncio pode andar mais de uma etapa sem esperar GPU (ex.: análise -> planejamento)
    for (let volta = 0; volta < 4 && Date.now() - inicio < 12 * 60_000; volta++) {
      const lista = await ativos()
      if (!lista.length) break
      let mudou = false
      for (const a of lista) {
        if (Date.now() - inicio > 12 * 60_000) break
        const antes = `${a.etapa}|${a.jobAtual || ""}`
        const depois = await avancar(a.id)
        if (depois && `${depois.etapa}|${depois.jobAtual || ""}` !== antes) mudou = true
      }
      if (!mudou) break
    }
  } finally {
    await trava.soltar("processar", dono)
  }
}

export const config: Config = { path: "/interno/processar", background: true }
