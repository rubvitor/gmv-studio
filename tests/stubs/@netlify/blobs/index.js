const mem = new Map()
export function getStore({ name }) {
  const k = (x) => name + "/" + x
  return {
    async setJSON(key, v) { mem.set(k(key), JSON.stringify(v)) },
    async set(key, v) { mem.set(k(key), v) },
    async get(key, o) { const v = mem.get(k(key)); if (v === undefined) return null; return o?.type === "json" ? JSON.parse(v) : v },
    async delete(key) { mem.delete(k(key)) },
    async list(o = {}) { const p = name + "/" + (o.prefix || ""); return { blobs: [...mem.keys()].filter((x) => x.startsWith(p)).map((x) => ({ key: x.slice(name.length + 1) })) } },
  }
}
