// Configurações do app (editáveis na tela Configurações) e constantes fixas do Rubens.

export type Configuracoes = {
  videosPorDia: number
  horarios: string[] // "HH:MM" no fuso de São Paulo
  modoPublicacao: "automatico" | "aprovacao"
  orcamentoDiarioUSD: number
  precoGpuHoraUSD: number
  modeloRoteiro: string
  modeloConferencia: string
  duracaoMaxSegundos: number
  chamadaFinal: string
  qtdHashtags: number
  rotuloIA: boolean
  conteudoDeMarca: boolean
  metricoolBlogId: string
  maxTentativasPrevia: number
  regrasExtras: string
  radarAutomatico: boolean // fase 2: TikTok Shop API
  nichos: string[]
}

export const PADRAO: Configuracoes = {
  videosPorDia: 3,
  horarios: ["11:40", "18:20", "21:10"],
  modoPublicacao: "automatico",
  orcamentoDiarioUSD: 5,
  precoGpuHoraUSD: 3.49,
  modeloRoteiro: "claude-opus-5-5",
  modeloConferencia: "claude-sonnet-5-5",
  duracaoMaxSegundos: 90,
  chamadaFinal: "Clica no carrinho abaixo e adquira o seu.",
  qtdHashtags: 5,
  rotuloIA: true,
  conteudoDeMarca: true,
  metricoolBlogId: "7350501",
  maxTentativasPrevia: 2,
  regrasExtras: "",
  radarAutomatico: false,
  nichos: ["eletrônicos", "casa", "ferramentas", "automotivo"],
}

export function mesclarConfig(salva: Partial<Configuracoes> | null | undefined): Configuracoes {
  const c = { ...PADRAO, ...(salva || {}) }
  c.videosPorDia = Math.max(0, Math.min(10, Math.round(Number(c.videosPorDia) || 0)))
  c.duracaoMaxSegundos = Math.max(20, Math.min(90, Math.round(Number(c.duracaoMaxSegundos) || 90)))
  c.orcamentoDiarioUSD = Math.max(0, Number(c.orcamentoDiarioUSD) || 0)
  c.horarios = (Array.isArray(c.horarios) ? c.horarios : PADRAO.horarios)
    .map((h) => String(h).trim())
    .filter((h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h))
    .sort()
  if (!c.horarios.length) c.horarios = [...PADRAO.horarios]
  return c
}

// Fotos do rosto já cadastradas no deployment da Comfy (enviadas em 31/10/2026).
export const ROSTOS: [string, string][] = [
  ["7243", "3027a38b-4b4f-4e40-b432-f6ddc29a8ca4"],
  ["7244", "0406a486-3f9d-43c0-938e-5e7aac939c86"],
  ["7236", "1fabe1a6-2514-4713-aff2-7914f361b66f"],
  ["7237", "6e2549a8-b2df-4cb3-be5f-17643b525074"],
  ["7238", "46414dd0-e0c8-4233-9b88-46d853c331fb"],
  ["7239", "4b954366-a59f-4290-95e3-30065882e657"],
  ["7240", "4b04105d-a876-44b4-a113-98f86c0ae066"],
  ["7241", "f654dcbf-dfc5-4661-8394-6c3aed97cf94"],
  ["7242", "cb9057fd-1e6f-42b3-a2bd-c005f33fd519"],
]

// Regras fixas do Rubens para todo anúncio (entram nos prompts do Claude).
export const REGRAS_RUBENS = `
- As fotos do produto são só referência e informação: nunca aparecem em tela cheia no vídeo. O produto só aparece na mão do apresentador ou em uso.
- Coerência física: produto sem fio não tem cabo; cores iguais às fotos; nada pendurado ou flutuando; as mãos seguram o produto.
- Sequência lógica de uso, como nos vídeos de referência (ex.: segura o estojo fechado -> abre e coloca o fone no ouvido -> já usando, benefícios e chamada).
- Apresentador: o próprio Rubens, cabelo e barba castanho bem escuro, sem nenhum fio grisalho, aparência de uns 35 anos, identidade preservada.
- Narração em português do Brasil natural, primeira pessoa, só fatos das fotos e da listagem; sem preço, desconto, avaliações ou certificações inventadas.
- O roteiro NÃO pode ter palavras com acento ou cedilha (a legenda do vídeo não mostra esses caracteres). Reescreva com sinônimos sem acento, mantendo o português correto.
- Duração entre 40 e 60 segundos, nunca acima do limite configurado.
`.trim()
