// LOCATE_POST (RFC §1B.12.3, DEC-070/072): find the post inside the visible text of a page's main/article landmark.
// The model returns offsets only; the stored text is the verified verbatim slice, never model-written text.
import { z } from 'zod'
import { doc, UNTRUSTED, type TaskDef } from '../runtime'

export interface LocateIn { visibleText: string; url: string }
export const LocateOut = z.object({ textStart: z.number().int(), textEnd: z.number().int(), author: z.string().nullable(), postedAt: z.string().nullable() })
export const LOCATE: TaskDef<LocateIn, z.infer<typeof LocateOut>> = {
  name: 'LOCATE_POST', promptVersion: 'locate-1', schema: LocateOut,
  system: `The text below is the visible text of one social-media post page. Return the character offsets [textStart, textEnd) of the post's own body text within that exact string (0-based, end exclusive), plus the author name and posting time if visible. Do not include navigation, profile cards, replies, counts or buttons. ${UNTRUSTED}`,
  user: i => `URL: ${i.url}\nText length: ${i.visibleText.length}\n${doc(i.visibleText.slice(0, 30000))}`,
  validate: (o, i) => {
    const len = Math.min(i.visibleText.length, 30000)
    if (!(o.textStart >= 0 && o.textStart < o.textEnd && o.textEnd <= len)) return [`offsets must satisfy 0 ≤ textStart < textEnd ≤ ${len}`]
    if (o.textEnd - o.textStart < 20) return ['the post span must be at least 20 characters']
    return []
  }
}
