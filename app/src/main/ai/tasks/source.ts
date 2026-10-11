// CONFIGURE_SOURCE (RFC §1B.12.3): the user's watch option + instruction → validated relevance block.
import { z } from 'zod'
import type { TaskDef } from '../runtime'

export interface ConfigureIn { name: string; typeLabel: string; mode: string; instruction: string; recentTitles: string[] }
export const ConfigureOut = z.object({ include: z.array(z.string()).max(10), exclude: z.array(z.string()).max(10), entityFocus: z.enum(['none', 'followed_only']) })
export const CONFIGURE: TaskDef<ConfigureIn, z.infer<typeof ConfigureOut>> = {
  name: 'CONFIGURE_SOURCE', promptVersion: 'configure-1', schema: ConfigureOut,
  system: 'Turn a venture investor\'s instruction for a news source into short topic filters. include: up to 10 short topic phrases (≤ 60 characters each) the investor wants from this source; exclude: up to 10 phrases they do not want; entityFocus: "followed_only" only when they ask for items about companies/firms they follow, else "none". Use empty lists when the instruction gives no topics.',
  user: i => `Source: ${i.name} (${i.typeLabel})\nWatch option: ${i.mode}\nInstruction: ${i.instruction || '(none)'}\nRecent titles:\n${i.recentTitles.map(t => '- ' + t).join('\n') || '(none)'}`,
  validate: o => [...o.include, ...o.exclude].filter(s => s.length > 60).map(s => `phrase too long: ${s.slice(0, 30)}…`)
}
