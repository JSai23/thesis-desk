// Short handles for the ids a task shows the model (T1, F2, C3 …). Ids minted in the same millisecond share their
// ULID prefix and differ only in the random tail; asked to copy one, the model attached a valid but wrong id
// ("my fintech thesis" → the AI infrastructure thesis; run #13, RD-BR-01 — MEM-053). Handles go out in the prompt and
// are validated as the only allowed values; real ids come back in code.

export class Handles {
  private toHandle = new Map<string, string>()
  private toId = new Map<string, string>()

  /** The list with each id replaced by `<prefix><n>`. */
  label<T extends { id: string }>(prefix: string, xs: T[]): T[] {
    return xs.map((x, i) => {
      const h = prefix + (i + 1)
      this.toHandle.set(x.id, h); this.toId.set(h, x.id)
      return { ...x, id: h }
    })
  }
  /** Real id → its handle (an id that was never labeled is returned as is). */
  out(id: string): string { return this.toHandle.get(id) ?? id }
  /** Handle → real id (anything unknown is returned as is, so validation of the real id still catches it). */
  back(h: string): string { return this.toId.get(h.trim()) ?? h }
  backAll<T extends string[] | null>(xs: T): T { return (xs ? xs.map(x => this.back(x)) : xs) as T }
}
