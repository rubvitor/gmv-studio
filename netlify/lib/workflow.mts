// Monta os grafos (formato API do ComfyUI) usados pelo pipeline.
// Baseado no workflow 14 v2 do Rubens: 9 fotos de rosto, só cenas A/B/C com o produto na mão,
// coerência física, retoque de cabelo castanho bem escuro, até 1:30.

import { ROSTOS } from "./config.mts"

export type Asset = { id: string; file_path: string }
export type Grafo = Record<string, { class_type: string; inputs: Record<string, any> }>

export type Textos = {
  roteiro: string // linhas "A | ...", "B | ...", "C | ..." sem acento
  produto: string // inglês: aparência exata do produto
  cenario: string // inglês
  acao_A: string
  acao_B: string
  acao_C: string
}

export type RefProduto = { asset: Asset; largura?: number; altura?: number; recorte?: [number, number, number, number] | null }

export const TRECHOS = { A: 6, B: 6, C: 4 } as const // 81 + 72*(n-1) quadros a 25 fps -> 17,6 s / 17,6 s / 11,9 s

const NOS_ROSTO = ["5", "6", "201", "202", "203", "204", "205", "206", "207"]
const CENAS = {
  A: { acao: 21, img: 46, vid: 54, bases: [60, 66, 74, 82, 400, 410], cv: 90, ret: 302 },
  B: { acao: 23, img: 91, vid: 99, bases: [105, 111, 420, 430, 440, 450], cv: 119, ret: 312 },
  C: { acao: 25, img: 120, vid: 128, bases: [134, 140, 148, 460], cv: 156, ret: 322 },
} as const

export const asset = (a: Asset) => ({ __type: "core/ASSET", info: { id: a.id, file_path: a.file_path } })
const L = (i: number | string, out = 0) => [String(i), out]

const IMG = (nProd: number) =>
  "Photorealistic vertical smartphone selfie video frame of the adult man shown in images 1 to 9 (all nine images " +
  "are the same man), with exactly his real face and features, subtly rejuvenated to look about 35 years old with " +
  "natural skin texture, his exact original eyes with the same shape and the same eye color as in images 1 to 9. His " +
  "short curly hair is very dark brown and his short stubble beard is very dark brown: absolutely no gray or white " +
  "hairs anywhere in his hair or beard, even where the reference photos show some. Rose tattoo on his neck and red " +
  "sleeveless shirt, in {c}.\nHe {b}.\nThe product is {a}. " +
  (nProd > 0
    ? `Images 10 to ${9 + nProd} show the product: keep it exactly as in those photos, same shape, same colors and same details, `
    : "Keep the product exactly as described, ") +
  "with no cables if it is wireless and no other objects. Everything is physically coherent: the product is held by " +
  "his hands or worn, nothing floats or hangs.\nNatural skin texture, soft daylight, sharp focus."

const RETOQUE =
  "Edit image 1: recolor only his hair and his beard to a uniform, natural very dark brown, almost black, with " +
  "absolutely no gray, silver or white hairs anywhere, including the temples, the sides of the head, the mustache " +
  "and the chin. Keep everything else exactly the same as image 1: same face and identity, eyes, expression, skin " +
  "texture, tattoo, clothing, hands, product, background, lighting, framing and pose. Do not add, move or remove any " +
  "object. Photorealistic."

const VID =
  "The man with very dark brown hair and a very dark brown beard, no gray hairs, talks naturally to the camera in {c} " +
  "while he {b}, subtle head and hand movements, realistic lip movement, stable face, hands and product, the product " +
  "keeps its shape and colors, no cables, no extra objects."

/** Grafo de análise: lê fotos e vídeos de referência do .zip com os nós do Rubens e salva os textos. */
export function grafoAnalise(zip: Asset): Grafo {
  return {
    "2": { class_type: "TikTokEntrada", inputs: { pasta: asset(zip) } },
    "7": { class_type: "CLIPLoader", inputs: { clip_name: "qwen3.5_4b_bf16.safetensors", type: "stable_diffusion", device: "default" } },
    "8": { class_type: "TikTokLerFotos", inputs: { clip: L(7), fotos: L(2) } },
    "9": { class_type: "TikTokLerVideos", inputs: { clip: L(7), quadros: L(2, 1) } },
    "20": { class_type: "SaveText", inputs: { filename_prefix: "gmv/ficha", format: "txt", text: L(8) } },
    "21": { class_type: "SaveText", inputs: { filename_prefix: "gmv/estrutura_referencia", format: "txt", text: L(9) } },
  }
}

/** Grafo do anúncio. previa=true gera só as 3 imagens iniciais (barato). */
export function grafoAnuncio(o: {
  textos: Textos
  zip: Asset
  refs: RefProduto[]
  semente: number
  previa?: boolean
  prefixo?: string
}): Grafo {
  const g: Grafo = {}
  const no = (i: number | string, class_type: string, inputs: Record<string, any>) => {
    g[String(i)] = { class_type, inputs }
  }
  const pre = o.prefixo || "gmv"

  no(2, "TikTokEntrada", { pasta: asset(o.zip) })
  no(4, "PrimitiveInt", { value: o.semente })
  NOS_ROSTO.forEach((n, k) => {
    const [num, aid] = ROSTOS[k]
    no(n, "LoadImage", { image: asset({ id: aid, file_path: `tiktok_rosto_IMG${num}.jpg` }) })
  })
  no(13, "PrimitiveStringMultiline", { value: o.textos.roteiro })
  no(15, "PrimitiveStringMultiline", { value: o.textos.produto })
  no(17, "PrimitiveStringMultiline", { value: o.textos.cenario })
  no(21, "PrimitiveStringMultiline", { value: o.textos.acao_A })
  no(23, "PrimitiveStringMultiline", { value: o.textos.acao_B })
  no(25, "PrimitiveStringMultiline", { value: o.textos.acao_C })

  // referências do produto (recortadas quando houver caixa)
  const refNos: string[] = []
  o.refs.slice(0, 3).forEach((r, k) => {
    const lid = 600 + k
    no(lid, "LoadImage", { image: asset(r.asset) })
    if (r.recorte && r.largura && r.altura) {
      const [x0, y0, x1, y1] = r.recorte
      const x = Math.max(0, Math.round(x0 * r.largura))
      const y = Math.max(0, Math.round(y0 * r.altura))
      const w = Math.max(64, Math.round((x1 - x0) * r.largura))
      const h = Math.max(64, Math.round((y1 - y0) * r.altura))
      no(620 + k, "ImageCrop", { image: L(lid), width: w, height: h, x, y })
      refNos.push(String(620 + k))
    } else {
      refNos.push(String(lid))
    }
  })

  no(33, "UNETLoader", { unet_name: "flux-2-klein-4b-fp8.safetensors", weight_dtype: "default" })
  no(34, "CLIPLoader", { clip_name: "qwen_3_4b.safetensors", type: "flux2", device: "default" })
  no(35, "VAELoader", { vae_name: "flux2-vae.safetensors" })
  no(36, "EmptyFlux2LatentImage", { width: 576, height: 1024, batch_size: 1 })
  no(37, "Flux2Scheduler", { steps: 4, width: 576, height: 1024 })
  no(38, "KSamplerSelect", { sampler_name: "euler" })
  no(300, "PrimitiveStringMultiline", { value: RETOQUE })
  no(301, "CLIPTextEncode", { text: L(300), clip: L(34) })

  if (!o.previa) {
    no(32, "TikTokNarracao", { duracao_minima: 30, roteiro: L(13) })
    no(39, "UNETLoader", { unet_name: "Wan2_1-I2V-14B-480p_fp8_e4m3fn_scaled_KJ.safetensors", weight_dtype: "default" })
    no(40, "LoraLoaderModelOnly", {
      lora_name: "lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors",
      strength_model: 1,
      model: L(39),
    })
    no(41, "CLIPLoader", { clip_name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", type: "wan", device: "default" })
    no(42, "VAELoader", { vae_name: "Wan2_1_VAE_bf16.safetensors" })
    no(43, "ModelPatchLoader", { name: "wan2.1_infiniteTalk_single_fp16.safetensors" })
    no(44, "AudioEncoderLoader", { audio_encoder_name: "wav2vec2-chinese-base_fp16.safetensors" })
    no(45, "KSamplerSelect", { sampler_name: "euler" })
  }

  const falas: Record<string, number> = {}
  const fins: Record<string, string> = {}
  for (const [cena, c] of Object.entries(CENAS)) {
    const i = c.img
    no(i, "StringFormat", { f_string: IMG(refNos.length), "values.a": L(15), "values.b": L(c.acao), "values.c": L(17) })
    no(i + 1, "CLIPTextEncode", { text: L(i), clip: L(34) })
    const ref: Record<string, any> = {}
    NOS_ROSTO.forEach((n, k) => (ref[`images.image${k}`] = L(n)))
    refNos.forEach((n, k) => (ref[`images.image${9 + k}`] = L(n)))
    no(i + 2, "ReferenceMultiLatent", {
      resolution: "resize",
      "resolution.megapixels": 0.5,
      positive: L(i + 1),
      vae: L(35),
      ...ref,
    })
    no(i + 3, "CFGGuider", { cfg: 1, model: L(33), positive: L(i + 2), negative: L(i + 2, 1) })
    no(i + 4, "RandomNoise", { noise_seed: L(4) })
    no(i + 5, "SamplerCustomAdvanced", { noise: L(i + 4), guider: L(i + 3), sampler: L(38), sigmas: L(37), latent_image: L(36) })
    no(i + 6, "VAEDecodeTiled", { tile_size: 512, overlap: 64, temporal_size: 16, temporal_overlap: 4, samples: L(i + 5), vae: L(35) })
    const r = c.ret
    no(r, "ReferenceMultiLatent", {
      resolution: "resize",
      "resolution.megapixels": 0.6,
      positive: L(301),
      vae: L(35),
      "images.image0": L(i + 6),
    })
    no(r + 1, "CFGGuider", { cfg: 1, model: L(33), positive: L(r), negative: L(r, 1) })
    no(r + 2, "SamplerCustomAdvanced", { noise: L(i + 4), guider: L(r + 1), sampler: L(38), sigmas: L(37), latent_image: L(36) })
    no(r + 3, "VAEDecodeTiled", { tile_size: 512, overlap: 64, temporal_size: 16, temporal_overlap: 4, samples: L(r + 2), vae: L(35) })
    no(r + 4, "SaveImage", { filename_prefix: `${pre}/cena_${cena}`, images: L(r + 3) })
    if (o.previa) continue

    const v = c.vid
    no(v, "StringFormat", { f_string: VID, "values.b": L(c.acao), "values.c": L(17) })
    no(v + 1, "CLIPTextEncode", { text: L(v), clip: L(41) })
    no(v + 2, "ConditioningZeroOut", { conditioning: L(v + 1) })
    no(v + 3, "ImageScale", { upscale_method: "lanczos", width: 432, height: 768, crop: "center", image: L(r + 3) })
    no(v + 4, "TikTokFalaTrecho", { cena, trechos: TRECHOS[cena as "A"], locucao: L(32), tempos: L(32, 1) })
    no(v + 5, "AudioEncoderEncode", { audio_encoder: L(44), audio: L(v + 4) })
    const comum = {
      mode: "single_speaker",
      width: 432,
      height: 768,
      length: 81,
      motion_frame_count: 9,
      audio_scale: 1,
      model: L(40),
      model_patch: L(43),
      positive: L(v + 1),
      negative: L(v + 2),
      vae: L(42),
      audio_encoder_output_1: L(v + 5),
      start_image: L(v + 3),
    }
    let acumulado: number | null = null
    c.bases.slice(0, TRECHOS[cena as "A"]).forEach((b) => {
      no(b, "WanInfiniteTalkToVideo", acumulado === null ? { ...comum } : { ...comum, previous_frames: L(acumulado) })
      no(b + 1, "CFGGuider", { cfg: 1, model: L(b), positive: L(b, 1), negative: L(b, 2) })
      no(b + 2, "BasicScheduler", { scheduler: "normal", steps: 4, denoise: 1, model: L(b) })
      no(b + 3, "RandomNoise", { noise_seed: L(4) })
      no(b + 4, "SamplerCustomAdvanced", { noise: L(b + 3), guider: L(b + 1), sampler: L(45), sigmas: L(b + 2), latent_image: L(b, 3) })
      no(b + 5, "VAEDecode", { samples: L(b + 4), vae: L(42) })
      if (acumulado === null) {
        acumulado = b + 5
      } else {
        no(b + 6, "ImageFromBatch", { batch_index: 9, length: 72, image: L(b + 5) })
        no(b + 7, "ImageBatch", { image1: L(acumulado), image2: L(b + 6) })
        acumulado = b + 7
      }
    })
    no(c.cv, "CreateVideo", { fps: 25, bit_depth: "auto", color_space: "sRGB", codec: "none", images: L(acumulado!) })
    falas[cena] = c.cv
    fins[cena] = String(acumulado)
  }

  if (!o.previa) {
    no(157, "TikTokMontagem", {
      locucao: L(32),
      tempos: L(32, 1),
      fala_a: L(falas.A),
      fala_b: L(falas.B),
      fala_c: L(falas.C),
      fotos: L(2),
    })
    no(158, "SaveVideo", {
      filename_prefix: `${pre}/anuncio`,
      format: "mp4",
      "format.codec": "h264",
      "format.codec.encoding": "auto",
      video: L(157),
    })
  } else {
    delete g["2"]
  }
  validarLigacoes(g)
  return g
}

/** Extrai quadros de um vídeo pronto (asset de saída) para conferência visual. */
export function grafoQuadros(video: Asset, indices = [50, 200, 400, 600, 800, 1000, 1400, 99999]): Grafo {
  const g: Grafo = {
    "1": { class_type: "LoadVideo", inputs: { file: asset(video) } },
    "2": { class_type: "GetVideoComponents", inputs: { video: L(1) } },
  }
  indices.forEach((idx, k) => {
    const b = 10 + k * 3
    g[String(b)] = { class_type: "ImageFromBatch", inputs: { batch_index: idx, length: 1, image: L(2) } }
    g[String(b + 1)] = {
      class_type: "ImageScale",
      inputs: { upscale_method: "bilinear", width: 540, height: 960, crop: "center", image: L(b) },
    }
    g[String(b + 2)] = {
      class_type: "SaveImage",
      inputs: { filename_prefix: `gmv_quadros/q${String(k).padStart(2, "0")}`, images: L(b + 1) },
    }
  })
  return g
}

export function validarLigacoes(g: Grafo) {
  for (const [k, v] of Object.entries(g)) {
    for (const val of Object.values(v.inputs)) {
      if (Array.isArray(val) && val.length === 2 && typeof val[0] === "string" && !(val[0] in g)) {
        throw new Error(`nó ${k} aponta para nó inexistente ${val[0]}`)
      }
    }
  }
}

/** Valida o roteiro antes de gastar GPU. Devolve a lista de problemas (vazia = ok). */
export function conferirRoteiro(roteiro: string, maxPalavras = { A: 38, B: 38, C: 25 }): string[] {
  const problemas: string[] = []
  const linhas = roteiro.split("\n").map((l) => l.trim()).filter(Boolean)
  const cont: Record<string, number> = { A: 0, B: 0, C: 0 }
  let ordem = ""
  for (const l of linhas) {
    const m = l.match(/^([ABC])\s*\|\s*(.+)$/)
    if (!m) {
      problemas.push(`linha fora do formato: ${l}`)
      continue
    }
    const [, cena, fala] = m
    if (!ordem.endsWith(cena)) ordem += cena
    cont[cena] += fala.split(/\s+/).filter(Boolean).length
    if (/[^\x00-\x7F]/.test(fala)) problemas.push(`fala com acento ou caractere especial: ${fala}`)
  }
  if (ordem !== "ABC") problemas.push(`ordem das cenas deve ser A, B, C (veio ${ordem || "vazio"})`)
  for (const c of ["A", "B", "C"] as const) {
    if (cont[c] === 0) problemas.push(`cena ${c} sem fala`)
    if (cont[c] > maxPalavras[c]) problemas.push(`cena ${c} com ${cont[c]} palavras (máximo ${maxPalavras[c]})`)
  }
  return problemas
}
