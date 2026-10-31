// Autenticação simples (um usuário) e chamadas internas às funções de segundo plano.

export function env(nome: string): string | undefined {
  return (globalThis as any).Netlify?.env?.get(nome) ?? process.env[nome]
}

export function autorizado(req: Request): boolean {
  const token = env("APP_TOKEN")
  if (!token) return false
  const h = req.headers.get("authorization") || ""
  if (h === `Bearer ${token}`) return true
  const t = new URL(req.url).searchParams.get("t")
  return t === token
}

export function interno(req: Request): boolean {
  const token = env("APP_TOKEN")
  return !!token && req.headers.get("x-gmv-token") === token
}

export const json = (dados: unknown, status = 200) => Response.json(dados, { status })
export const erro = (msg: string, status = 400) => Response.json({ erro: msg }, { status })

/** Dispara uma função de segundo plano do próprio site (resposta 202 imediata). */
export async function disparar(baseUrl: string, caminho: string, corpo: unknown = {}) {
  const token = env("APP_TOKEN") || ""
  await fetch(new URL(caminho, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", "x-gmv-token": token },
    body: JSON.stringify(corpo),
  })
}

export function urlBase(req: Request | null, contexto?: { site?: { url?: string } }): string {
  return contexto?.site?.url || env("URL") || (req ? new URL(req.url).origin : "")
}
