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

/** Tipo real de uma imagem pelos primeiros bytes (só os formatos que o ComfyUI e o Claude aceitam). */
export function tipoImagem(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b.length < 12) return null
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg"
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png"
  const txt = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n))
  if (txt(0, 4) === "RIFF" && txt(8, 4) === "WEBP") return "image/webp"
  return null
}

/** Vídeo MP4/MOV: caixa "ftyp" logo no início. */
export function ehMp4(b: Uint8Array): boolean {
  return b.length > 12 && String.fromCharCode(...b.subarray(4, 8)) === "ftyp"
}

/** Largura e altura de JPEG, PNG ou WebP sem decodificar a imagem. */
export function dimensoesImagem(b: Uint8Array): { largura?: number; altura?: number } {
  const tipo = tipoImagem(b)
  if (tipo === "image/png" && b.length >= 24) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
    return { largura: v.getUint32(16), altura: v.getUint32(20) }
  }
  if (tipo === "image/jpeg") {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue }
      const m = b[i + 1]
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue }
      const tam = (b[i + 2] << 8) | b[i + 3]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { altura: (b[i + 5] << 8) | b[i + 6], largura: (b[i + 7] << 8) | b[i + 8] }
      }
      i += 2 + tam
    }
    return {}
  }
  if (tipo === "image/webp" && b.length >= 30) {
    const bloco = String.fromCharCode(...b.subarray(12, 16))
    if (bloco === "VP8 ") return { largura: ((b[27] << 8) | b[26]) & 0x3fff, altura: ((b[29] << 8) | b[28]) & 0x3fff }
    if (bloco === "VP8L") {
      return { largura: 1 + (((b[22] & 0x3f) << 8) | b[21]), altura: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) }
    }
    if (bloco === "VP8X") return { largura: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), altura: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
  }
  return {}
}
