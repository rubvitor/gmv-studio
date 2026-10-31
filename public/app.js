import { h, render } from "https://esm.sh/preact@10.24.3"
import { useState, useEffect, useCallback } from "https://esm.sh/preact@10.24.3/hooks"
import htm from "https://esm.sh/htm@3.1.1"

const html = htm.bind(h)

// ---------- acesso à API ----------
const lerToken = () => { try { return localStorage.getItem("gmv_token") || "" } catch { return "" } }
const gravarToken = (t) => { try { localStorage.setItem("gmv_token", t) } catch {} }

async function api(caminho, opcoes = {}) {
  const r = await fetch(`/api/${caminho}`, {
    ...opcoes,
    headers: { authorization: `Bearer ${lerToken()}`, ...(opcoes.body && !(opcoes.body instanceof ArrayBuffer) && !(opcoes.body instanceof Blob) ? { "content-type": "application/json" } : {}), ...(opcoes.headers || {}) },
  })
  if (r.status === 401) throw Object.assign(new Error("Senha do app incorreta."), { status: 401 })
  const dados = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(dados.erro || `Erro ${r.status}`)
  return dados
}
const midia = (anuncioId, assetId) => `/api/anuncios/${anuncioId}/midia/${assetId}?t=${encodeURIComponent(lerToken())}`

const ETAPAS = {
  aguardando: ["Na fila do dia", "espera"],
  analisando: ["Lendo fotos e vídeos", ""],
  planejando: ["Escrevendo roteiro", ""],
  previa: ["Gerando prévia das cenas", ""],
  gerando: ["Gerando o vídeo", ""],
  conferindo: ["Conferindo o vídeo", ""],
  pronto: ["Pronto para aprovar", "espera"],
  agendado: ["Agendado", "ok"],
  reprovado: ["Reprovado na conferência", "erro"],
  erro: ["Erro", "erro"],
}
const usd = (v) => `US$ ${(v || 0).toFixed(2)}`
const horaSP = (iso) => iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""

// ---------- componentes ----------
function Tira({ a }) {
  const rodando = !["agendado", "reprovado", "erro", "pronto"].includes(a.etapa)
  return html`<div class="tira" aria-label="Cenas A, B e C">
    ${["A", "B", "C"].map((l, i) => {
      const id = a.previa?.[i]
      return html`<div class=${`quadro ${id ? "" : "vazio"} ${!id && rodando ? "rodando" : ""}`}>
        ${id && html`<img src=${midia(a.id, id)} alt=${`Cena ${l}`} loading="lazy" />`}
        <span class="letra">${l}</span>
      </div>`
    })}
  </div>`
}

function Etapa({ etapa }) {
  const [txt, cls] = ETAPAS[etapa] || [etapa, ""]
  return html`<span class=${`etapa ${cls}`}>${txt}</span>`
}

function CartaoAnuncio({ a, abrir }) {
  return html`<button class="anuncio" onClick=${() => abrir(a.id)}>
    <div class="cabeca"><span class="nome">${a.nome || "Produto em análise"}</span><${Etapa} etapa=${a.etapa} /></div>
    <${Tira} a=${a} />
    <div class="cabeca sub">
      <span>${a.publicacao ? `Publica ${horaSP(a.publicacao.horario)}` : a.erro ? a.erro.slice(0, 90) : a.ultimoLog?.msg || ""}</span>
      <span>${usd(a.custoUSD)}</span>
    </div>
  </button>`
}

// ---------- telas ----------
function Hoje({ status, anuncios, abrir, recarregar, avisar }) {
  const hoje = anuncios.filter((a) => a.dia === status?.hoje)
  const faltando = status ? Object.entries(status.variaveis).filter(([k, v]) => !v && k !== "TIKTOK_SHOP").map(([k]) => k) : []
  const cfg = status?.config
  const pct = cfg ? Math.min(100, ((status.custoHojeUSD || 0) / (cfg.orcamentoDiarioUSD || 1)) * 100) : 0
  const gerar = async () => {
    try { const r = await api("radar/agora", { method: "POST" }); avisar(r.criados ? `${r.criados} anúncio(s) criados para hoje.` : "Nada novo: a fila está vazia ou a meta do dia já foi atingida."); recarregar() } catch (e) { avisar(e.message) }
  }
  return html`
    ${faltando.length > 0 && html`<section class="bloco alerta">
      <h2>Falta configurar no Netlify</h2>
      <p class="sub">Adicione em Project configuration → Environment variables e publique de novo:</p>
      <div class="chips">${faltando.map((k) => html`<span class="chip">${k}</span>`)}</div>
    </section>`}
    <section class="bloco">
      <div class="cabeca"><h1>${hoje.length} de ${cfg?.videosPorDia ?? "–"} vídeos hoje</h1></div>
      <div class="linha sub"><span>Gasto de GPU hoje: ${usd(status?.custoHojeUSD)} de ${usd(cfg?.orcamentoDiarioUSD)}</span></div>
      <div class="barra" aria-hidden="true"><i style=${`width:${pct}%`}></i></div>
      <div class="linha">
        <button class="botao" onClick=${gerar}>Gerar os vídeos de hoje agora</button>
        <button class="botao sec" onClick=${recarregar}>Atualizar</button>
      </div>
      <p class="sub">${status?.produtos?.naFila ?? 0} produto(s) na fila. O radar roda sozinho todo dia às 06:00.</p>
    </section>
    ${hoje.length === 0
      ? html`<div class="vazio-msg"><p>Nenhum anúncio hoje ainda.</p><p class="sub">Cadastre produtos na aba Produtos e coloque na fila.</p></div>`
      : hoje.map((a) => html`<${CartaoAnuncio} a=${a} abrir=${abrir} />`)}
  `
}

function Anuncios({ anuncios, abrir }) {
  if (!anuncios.length) return html`<div class="vazio-msg"><p>Os anúncios gerados aparecem aqui.</p></div>`
  return anuncios.map((a) => html`<${CartaoAnuncio} a=${a} abrir=${abrir} />`)
}

function DetalheAnuncio({ id, voltar, avisar }) {
  const [a, setA] = useState(null)
  const carregar = useCallback(() => api(`anuncios/${id}`).then(setA).catch((e) => avisar(e.message)), [id])
  useEffect(() => { carregar(); const t = setInterval(carregar, 20000); return () => clearInterval(t) }, [carregar])
  if (!a) return html`<p class="sub">Carregando…</p>`
  const acao = async (nome, msg) => { try { await api(`anuncios/${id}/${nome}`, { method: "POST" }); avisar(msg); carregar() } catch (e) { avisar(e.message) } }
  const apagar = async () => { if (!confirm("Apagar este anúncio?")) return; await api(`anuncios/${id}`, { method: "DELETE" }); voltar() }
  const p = a.plano
  return html`
    <button class="botao sec" onClick=${voltar}>Voltar</button>
    <section class="bloco">
      <div class="cabeca"><h1>${p?.nome_produto || "Anúncio"}</h1><${Etapa} etapa=${a.etapa} /></div>
      <${Tira} a=${a} />
      ${a.video && html`<video controls playsinline preload="metadata" src=${midia(a.id, a.video.id)}></video>`}
      ${a.erro && html`<p class="sub">${a.erro}</p>`}
      ${a.publicacao && html`<p>Agendado para ${horaSP(a.publicacao.horario)}${a.publicacao.plannerUrl ? html` · <a href=${a.publicacao.plannerUrl} target="_blank" rel="noopener">abrir no Metricool</a>` : ""}</p>`}
      <div class="linha">
        ${a.etapa === "pronto" && html`<button class="botao" onClick=${() => acao("aprovar", "Aprovado e agendado no Metricool.")}>Aprovar e agendar</button>`}
        ${["reprovado", "erro", "pronto"].includes(a.etapa) && html`<button class="botao sec" onClick=${() => acao("refazer", "Refazendo o anúncio.")}>Refazer</button>`}
        <button class="botao perigo" onClick=${apagar}>Apagar</button>
      </div>
      <p class="sub">Custo de GPU: ${usd(a.custoUSD)}</p>
    </section>
    ${p && html`<section class="bloco">
      <h2>Roteiro</h2><pre class="roteiro">${p.roteiro}</pre>
      <h2>Descrição do post</h2><pre class="roteiro">${`${p.descricao_pt}\n\n${p.descricao_en}\n\n${(p.hashtags || []).join(" ")}`}</pre>
    </section>`}
    ${a.veredictos?.length > 0 && html`<section class="bloco">
      <h2>Conferências</h2>
      ${a.veredictos.map((v) => html`<p><b>${v.etapa === "previa" ? "Prévia" : "Vídeo"}: ${v.aprovado ? "aprovado" : "reprovado"}</b>${v.problemas?.length ? ` — ${v.problemas.join("; ")}` : ""}</p>`)}
    </section>`}
    <section class="bloco"><h2>Histórico</h2><ul class="log">${[...a.log].reverse().map((l) => html`<li>${horaSP(l.em)} — ${l.msg}</li>`)}</ul></section>
  `
}

async function medirImagem(arquivo) {
  try { const b = await createImageBitmap(arquivo); const r = { largura: b.width, altura: b.height }; b.close?.(); return r } catch { return {} }
}

async function enviarArquivo(produtoId, arquivo, categoria, aoProgredir) {
  const dims = categoria === "foto" ? await medirImagem(arquivo) : {}
  const ini = await api("uploads", { method: "POST", body: JSON.stringify({ produtoId, nome: arquivo.name, tipo: arquivo.type || "application/octet-stream", tamanho: arquivo.size, categoria, ...dims }) })
  const partes = Math.ceil(arquivo.size / ini.tamanhoParte)
  for (let n = 0; n < partes; n++) {
    const pedaco = await arquivo.slice(n * ini.tamanhoParte, (n + 1) * ini.tamanhoParte).arrayBuffer()
    await api(`uploads/${ini.upload}/${n}`, { method: "PUT", body: pedaco, headers: { "content-type": "application/octet-stream" } })
    aoProgredir((n + 1) / partes)
  }
  await api(`uploads/${ini.upload}/concluir`, { method: "POST" })
}

function NovoProduto({ concluir, avisar }) {
  const [link, setLink] = useState("")
  const [obs, setObs] = useState("")
  const [prioridade, setPrioridade] = useState(3)
  const [fotos, setFotos] = useState([])
  const [videos, setVideos] = useState([])
  const [progresso, setProgresso] = useState("")
  const [enviando, setEnviando] = useState(false)
  const salvar = async (e) => {
    e.preventDefault()
    if (!link) return avisar("Cole o link do produto.")
    if (!fotos.length) return avisar("Escolha pelo menos uma foto do produto.")
    const grande = videos.find((v) => v.size > 80e6)
    if (grande) return avisar(`O vídeo ${grande.name} passa de 80 MB. Use um trecho menor.`)
    setEnviando(true)
    try {
      const p = await api("produtos", { method: "POST", body: JSON.stringify({ link, observacoes: obs, prioridade }) })
      const todos = [...fotos.map((f) => [f, "foto"]), ...videos.map((f) => [f, "video"])]
      for (let i = 0; i < todos.length; i++) {
        const [f, cat] = todos[i]
        await enviarArquivo(p.id, f, cat, (x) => setProgresso(`Enviando ${i + 1} de ${todos.length}: ${Math.round(x * 100)}%`))
      }
      setProgresso("Arquivos enviados. Montando o pacote…")
      await new Promise((r) => setTimeout(r, 4000))
      let tentativas = 0
      while (tentativas++ < 30) {
        const atual = await api(`produtos/${p.id}`)
        if (atual.fotos.length + atual.videos.length >= todos.length) break
        await new Promise((r) => setTimeout(r, 3000))
      }
      await api(`produtos/${p.id}/fila`, { method: "POST" })
      avisar("Produto salvo e entrando na fila.")
      concluir()
    } catch (e2) { avisar(e2.message) } finally { setEnviando(false) }
  }
  return html`<form class="bloco" onSubmit=${salvar}>
    <h2>Novo produto</h2>
    <label class="campo">Link do produto na TikTok Shop<input type="url" required value=${link} onInput=${(e) => setLink(e.target.value)} placeholder="https://vt.tiktok.com/…" /></label>
    <label class="campo">Fotos do produto<span class="dica">Prints da listagem e fotos com informações. Elas guiam o roteiro, mas não aparecem no vídeo.</span>
      <input type="file" accept="image/*" multiple onChange=${(e) => setFotos([...e.target.files])} /></label>
    <label class="campo">Vídeos de referência (opcional)<span class="dica">Até 80 MB cada. Servem só para o ritmo e a demonstração.</span>
      <input type="file" accept="video/*" multiple onChange=${(e) => setVideos([...e.target.files])} /></label>
    <label class="campo">Observações<span class="dica">Fatos que não estão nas fotos, como funciona, o que evitar.</span>
      <textarea value=${obs} onInput=${(e) => setObs(e.target.value)}></textarea></label>
    <label class="campo">Prioridade na fila: ${prioridade}<input type="range" min="1" max="5" value=${prioridade} onInput=${(e) => setPrioridade(Number(e.target.value))} /></label>
    ${progresso && html`<p class="progresso" aria-live="polite">${progresso}</p>`}
    <div class="linha"><button class="botao" disabled=${enviando}>${enviando ? "Enviando…" : "Salvar e colocar na fila"}</button>
    <button type="button" class="botao sec" onClick=${concluir} disabled=${enviando}>Cancelar</button></div>
  </form>`
}

function Produtos({ avisar, irParaAnuncio }) {
  const [lista, setLista] = useState(null)
  const [novo, setNovo] = useState(false)
  const carregar = () => api("produtos").then(setLista).catch((e) => avisar(e.message))
  useEffect(() => { carregar() }, [])
  if (novo) return html`<${NovoProduto} avisar=${avisar} concluir=${() => { setNovo(false); carregar() }} />`
  const gerar = async (p) => { try { const a = await api("anuncios", { method: "POST", body: JSON.stringify({ produtoId: p.id }) }); avisar("Anúncio criado."); irParaAnuncio(a.id) } catch (e) { avisar(e.message) } }
  const rotulo = { rascunho: "Rascunho", preparando: "Montando pacote", na_fila: "Na fila", usado: "Já usado", erro: "Erro" }
  return html`
    <section class="bloco"><div class="cabeca"><h1>Produtos</h1><button class="botao" onClick=${() => setNovo(true)}>Novo produto</button></div>
      <p class="sub">O radar diário pega os de maior prioridade da fila.</p></section>
    ${lista === null ? html`<p class="sub">Carregando…</p>` : lista.length === 0 ? html`<div class="vazio-msg"><p>Nenhum produto ainda.</p><button class="botao" onClick=${() => setNovo(true)}>Cadastrar o primeiro</button></div>` :
      lista.map((p) => html`<section class="bloco">
        <div class="cabeca"><h3>${p.nome || p.link}</h3><span class=${`etapa ${p.status === "na_fila" ? "espera" : p.status === "erro" ? "erro" : p.status === "usado" ? "ok" : ""}`}>${rotulo[p.status]}</span></div>
        <p class="sub">${p.fotos.length} foto(s), ${p.videos.length} vídeo(s) · prioridade ${p.prioridade}${p.erro ? ` · ${p.erro}` : ""}</p>
        <div class="linha">
          ${["na_fila", "usado"].includes(p.status) && html`<button class="botao sec" onClick=${() => gerar(p)}>Gerar anúncio agora</button>`}
          ${["rascunho", "erro"].includes(p.status) && p.fotos.length > 0 && html`<button class="botao sec" onClick=${async () => { await api(`produtos/${p.id}/fila`, { method: "POST" }); carregar() }}>Colocar na fila</button>`}
          <a href=${p.link} target="_blank" rel="noopener">Ver na TikTok Shop</a>
          <button class="botao perigo" onClick=${async () => { if (confirm("Apagar este produto?")) { await api(`produtos/${p.id}`, { method: "DELETE" }); carregar() } }}>Apagar</button>
        </div>
      </section>`)}
  `
}

function Ajustes({ avisar }) {
  const [c, setC] = useState(null)
  const [novoHorario, setNovoHorario] = useState("")
  const [custos, setCustos] = useState([])
  useEffect(() => { api("config").then(setC).catch((e) => avisar(e.message)); api("custos").then(setCustos).catch(() => {}) }, [])
  if (!c) return html`<p class="sub">Carregando…</p>`
  const mudar = (k, v) => setC({ ...c, [k]: v })
  const salvar = async () => { try { setC(await api("config", { method: "PUT", body: JSON.stringify(c) })); avisar("Ajustes salvos.") } catch (e) { avisar(e.message) } }
  const custoMes = custos.reduce((s, d) => s + (d.usd || 0), 0)
  return html`
    <section class="bloco"><h1>Ajustes</h1><p class="sub">Valem a partir do próximo anúncio.</p></section>
    <section class="bloco">
      <h2>Produção</h2>
      <label class="campo">Vídeos por dia: ${c.videosPorDia}<input type="range" min="0" max="10" value=${c.videosPorDia} onInput=${(e) => mudar("videosPorDia", Number(e.target.value))} /></label>
      <label class="campo">Orçamento diário de GPU (US$)<span class="dica">Cada vídeo aprovado de primeira custa perto de US$ 0,70.</span>
        <input type="number" min="0" step="0.5" value=${c.orcamentoDiarioUSD} onInput=${(e) => mudar("orcamentoDiarioUSD", Number(e.target.value))} /></label>
      <label class="campo">Duração máxima (segundos)<input type="number" min="20" max="90" value=${c.duracaoMaxSegundos} onInput=${(e) => mudar("duracaoMaxSegundos", Number(e.target.value))} /></label>
      <label class="campo">Tentativas de prévia antes de desistir<input type="number" min="1" max="4" value=${c.maxTentativasPrevia} onInput=${(e) => mudar("maxTentativasPrevia", Number(e.target.value))} /></label>
    </section>
    <section class="bloco">
      <h2>Publicação</h2>
      <div class="segmento" role="group" aria-label="Modo de publicação">
        <button aria-pressed=${c.modoPublicacao === "automatico"} onClick=${() => mudar("modoPublicacao", "automatico")}>Automático</button>
        <button aria-pressed=${c.modoPublicacao === "aprovacao"} onClick=${() => mudar("modoPublicacao", "aprovacao")}>Eu aprovo antes</button>
      </div>
      <div class="campo">Horários de publicação (São Paulo)
        <div class="chips">${c.horarios.map((hh) => html`<span class="chip">${hh}<button aria-label=${`Remover ${hh}`} onClick=${() => mudar("horarios", c.horarios.filter((x) => x !== hh))}>×</button></span>`)}</div>
        <div class="linha"><input type="time" value=${novoHorario} onInput=${(e) => setNovoHorario(e.target.value)} style="max-width:160px" />
          <button class="botao sec" onClick=${() => { if (novoHorario) { mudar("horarios", [...new Set([...c.horarios, novoHorario])].sort()); setNovoHorario("") } }}>Adicionar horário</button></div>
      </div>
      <label class="alternar">Marcar como conteúdo gerado por IA<input type="checkbox" checked=${c.rotuloIA} onChange=${(e) => mudar("rotuloIA", e.target.checked)} /></label>
      <label class="alternar">Marcar como conteúdo de marca (afiliado)<input type="checkbox" checked=${c.conteudoDeMarca} onChange=${(e) => mudar("conteudoDeMarca", e.target.checked)} /></label>
      <label class="campo">ID da marca no Metricool<input type="text" value=${c.metricoolBlogId} onInput=${(e) => mudar("metricoolBlogId", e.target.value)} /></label>
    </section>
    <section class="bloco">
      <h2>Roteiro e descrição</h2>
      <label class="campo">Chamada final<input type="text" value=${c.chamadaFinal} onInput=${(e) => mudar("chamadaFinal", e.target.value)} /></label>
      <label class="campo">Quantidade de hashtags<input type="number" min="0" max="10" value=${c.qtdHashtags} onInput=${(e) => mudar("qtdHashtags", Number(e.target.value))} /></label>
      <label class="campo">Regras extras<span class="dica">Somam às regras fixas: produto só na mão, sem fotos em tela cheia, cabelo castanho escuro.</span>
        <textarea value=${c.regrasExtras} onInput=${(e) => mudar("regrasExtras", e.target.value)}></textarea></label>
      <label class="campo">Modelo do roteiro<input type="text" value=${c.modeloRoteiro} onInput=${(e) => mudar("modeloRoteiro", e.target.value)} /></label>
      <label class="campo">Modelo da conferência<input type="text" value=${c.modeloConferencia} onInput=${(e) => mudar("modeloConferencia", e.target.value)} /></label>
    </section>
    <section class="bloco">
      <h2>Radar da TikTok Shop</h2>
      <p class="sub">Fica disponível quando o app de afiliado for aprovado no Partner Center.</p>
      <label class="alternar">Buscar produtos sozinho todo dia<input type="checkbox" checked=${c.radarAutomatico} onChange=${(e) => mudar("radarAutomatico", e.target.checked)} /></label>
      <label class="campo">Nichos (separados por vírgula)<input type="text" value=${c.nichos.join(", ")} onInput=${(e) => mudar("nichos", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} /></label>
    </section>
    <div class="linha"><button class="botao" onClick=${salvar}>Salvar ajustes</button></div>
    <section class="bloco"><h2>Gasto de GPU</h2><p>Últimos ${custos.length} dias: ${usd(custoMes)}</p>
      <ul class="log">${[...custos].reverse().map((d) => html`<li>${d.dia.split("-").reverse().join("/")}: ${usd(d.usd)}</li>`)}</ul></section>
  `
}

function Entrar({ pronto }) {
  const [t, setT] = useState("")
  const [erro, setErro] = useState("")
  const enviar = async (e) => { e.preventDefault(); gravarToken(t.trim()); try { await api("status"); pronto() } catch (e2) { setErro(e2.message) } }
  return html`<div class="entrar"><form class="bloco" onSubmit=${enviar}>
    <h1>GMV Studio</h1><p class="sub">Digite a senha do app (APP_TOKEN no Netlify).</p>
    <input type="password" value=${t} onInput=${(e) => setT(e.target.value)} autocomplete="current-password" />
    ${erro && html`<p class="sub">${erro}</p>`}
    <button class="botao">Entrar</button></form></div>`
}

function App() {
  const [logado, setLogado] = useState(!!lerToken())
  const [aba, setAba] = useState("hoje")
  const [aberto, setAberto] = useState(null)
  const [status, setStatus] = useState(null)
  const [anuncios, setAnuncios] = useState([])
  const [toast, setToast] = useState("")
  const avisar = (m) => { setToast(m); setTimeout(() => setToast(""), 4500) }
  const recarregar = useCallback(async () => {
    try { const [s, a] = await Promise.all([api("status"), api("anuncios")]); setStatus(s); setAnuncios(a) } catch (e) { if (e.status === 401) setLogado(false); else avisar(e.message) }
  }, [])
  useEffect(() => { if (logado) { recarregar(); const t = setInterval(recarregar, 30000); return () => clearInterval(t) } }, [logado])
  if (!logado) return html`<${Entrar} pronto=${() => setLogado(true)} />`
  const produzindo = anuncios.some((a) => !["agendado", "reprovado", "erro", "pronto"].includes(a.etapa))
  const abrir = (id) => setAberto(id)
  let conteudo
  if (aberto) conteudo = html`<${DetalheAnuncio} id=${aberto} avisar=${avisar} voltar=${() => { setAberto(null); recarregar() }} />`
  else if (aba === "hoje") conteudo = html`<${Hoje} status=${status} anuncios=${anuncios} abrir=${abrir} recarregar=${recarregar} avisar=${avisar} />`
  else if (aba === "produtos") conteudo = html`<${Produtos} avisar=${avisar} irParaAnuncio=${(id) => { setAberto(id); recarregar() }} />`
  else if (aba === "anuncios") conteudo = html`<${Anuncios} anuncios=${anuncios} abrir=${abrir} />`
  else conteudo = html`<${Ajustes} avisar=${avisar} />`
  const abas = [["hoje", "Hoje"], ["produtos", "Produtos"], ["anuncios", "Anúncios"], ["ajustes", "Ajustes"]]
  return html`
    <header class="topo"><span class="marca"><span class=${`tally ${produzindo ? "on" : ""}`} title=${produzindo ? "Produzindo" : "Parado"}></span>GMV Studio</span>
      <span class="gasto">${status ? `Hoje ${usd(status.custoHojeUSD)}` : ""}</span></header>
    <main>${conteudo}</main>
    <nav class="abas">${abas.map(([k, rot]) => html`<button aria-current=${!aberto && aba === k ? "page" : undefined} onClick=${() => { setAberto(null); setAba(k) }}><span class="ponto"></span>${rot}</button>`)}</nav>
    ${toast && html`<div class="toast" role="status">${toast}</div>`}
  `
}

render(html`<${App} />`, document.getElementById("app"))
