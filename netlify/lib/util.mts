// Utilidades sem dependências (testáveis com node --experimental-strip-types).

export const FUSO_OFFSET = "-03:00" // America/Sao_Paulo (sem horário de verão desde 2019)

export function agoraSP(base: Date = new Date()): Date {
  return new Date(base.getTime() - 3 * 3600 * 1000)
}

export function hojeSP(base: Date = new Date()): string {
  return agoraSP(base).toISOString().slice(0, 10)
}

/** Próximo horário livre (HH:MM em São Paulo) a partir de agora + folga, pulando os já ocupados. */
export function proximoHorario(
  horarios: string[],
  ocupados: string[],
  base: Date = new Date(),
  folgaMin = 10,
): string {
  const limite = base.getTime() + folgaMin * 60000
  for (let dia = 0; dia < 14; dia++) {
    const d = new Date(agoraSP(base).getTime() + dia * 86400000).toISOString().slice(0, 10)
    for (const h of [...horarios].sort()) {
      const iso = `${d}T${h}:00${FUSO_OFFSET}`
      if (new Date(iso).getTime() < limite) continue
      if (ocupados.includes(iso)) continue
      return iso
    }
  }
  throw new Error("sem horário livre nos próximos 14 dias")
}

export function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "")
}

export function temAcento(s: string): boolean {
  return /[^\x00-\x7F]/.test(s.replace(/[|]/g, ""))
}

export function contarPalavras(s: string): number {
  return s.split(/\s+/).filter(Boolean).length
}

/** Extrai o primeiro objeto JSON de um texto (tolerante a ```json ... ```). */
export function extrairJSON<T = any>(texto: string): T {
  const ini = texto.indexOf("{")
  const fim = texto.lastIndexOf("}")
  if (ini < 0 || fim <= ini) throw new Error("resposta sem JSON")
  return JSON.parse(texto.slice(ini, fim + 1)) as T
}

export function id(prefixo = ""): string {
  const r = crypto.getRandomValues(new Uint8Array(8))
  return prefixo + Array.from(r, (b) => b.toString(16).padStart(2, "0")).join("")
}

export function custoGpu(segundos: number, precoHora: number): number {
  return Math.round(((segundos * precoHora) / 3600) * 10000) / 10000
}

// ---------- ZIP mínimo (sem compressão) para o nó TikTokEntrada ----------
const TABELA_CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(dados: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < dados.length; i++) c = TABELA_CRC[(c ^ dados[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function criarZip(arquivos: { nome: string; dados: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder()
  const partes: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const a of arquivos) {
    const nome = enc.encode(a.nome)
    const crc = crc32(a.dados)
    const loc = new DataView(new ArrayBuffer(30))
    loc.setUint32(0, 0x04034b50, true)
    loc.setUint16(4, 20, true)
    loc.setUint16(6, 0x0800, true) // nomes em UTF-8
    loc.setUint16(8, 0, true) // sem compressão
    loc.setUint32(14, crc, true)
    loc.setUint32(18, a.dados.length, true)
    loc.setUint32(22, a.dados.length, true)
    loc.setUint16(26, nome.length, true)
    partes.push(new Uint8Array(loc.buffer), nome, a.dados)
    const cen = new DataView(new ArrayBuffer(46))
    cen.setUint32(0, 0x02014b50, true)
    cen.setUint16(4, 20, true)
    cen.setUint16(6, 20, true)
    cen.setUint16(8, 0x0800, true)
    cen.setUint32(16, crc, true)
    cen.setUint32(20, a.dados.length, true)
    cen.setUint32(24, a.dados.length, true)
    cen.setUint16(28, nome.length, true)
    cen.setUint32(42, offset, true)
    central.push(new Uint8Array(cen.buffer), nome)
    offset += 30 + nome.length + a.dados.length
  }
  const tamCentral = central.reduce((s, p) => s + p.length, 0)
  const fim = new DataView(new ArrayBuffer(22))
  fim.setUint32(0, 0x06054b50, true)
  fim.setUint16(8, arquivos.length, true)
  fim.setUint16(10, arquivos.length, true)
  fim.setUint32(12, tamCentral, true)
  fim.setUint32(16, offset, true)
  const todas = [...partes, ...central, new Uint8Array(fim.buffer)]
  const total = todas.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let pos = 0
  for (const p of todas) {
    out.set(p, pos)
    pos += p.length
  }
  return out
}
