import { z } from 'zod'

export const messageSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
})

export type Message = { slug: string; title: string; content: string }
