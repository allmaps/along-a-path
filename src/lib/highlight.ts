import { createHighlighterCore } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'

import nord from 'shiki/themes/nord.mjs'

import type { HighlighterCore } from 'shiki/core'

let highlighter: HighlighterCore | undefined

async function initialize() {
  highlighter = await createHighlighterCore({
    themes: [nord],
    langs: [import('shiki/langs/javascript.mjs')],
    engine: createOnigurumaEngine(import('shiki/wasm'))
  })
}

const initPromise = initialize()

export async function highlight(code: string): Promise<string> {
  await initPromise
  if (!highlighter) return ''
  return highlighter.codeToHtml(code, { lang: 'javascript', theme: 'nord' })
}
