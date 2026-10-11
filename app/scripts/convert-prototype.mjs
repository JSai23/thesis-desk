// One-time port of the approved prototype template (design/prototype/Research Workspace.dc.html) to TSX.
// Bindings `{{ path }}` become `V.path` (or a loop variable), <sc-for> becomes .map, <sc-if> becomes a conditional,
// inline style strings become React style objects, and style-hover/style-focus become generated CSS classes.
// Output: app/src/renderer/view/Template.tsx and app/src/renderer/prototype.css. Run: node app/scripts/convert-prototype.mjs
import fs from 'node:fs'
import path from 'node:path'
import { parseFragment } from 'parse5'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const SRC = path.join(ROOT, 'design/prototype/Research Workspace.dc.html')
const html = fs.readFileSync(SRC, 'utf8')
const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'))
const tpl = html.slice(html.indexOf('</helmet>') + 9, html.indexOf('<script type="text/x-dc"'))

const ATTR = {
  onclick: 'onClick', onchange: 'onChange', oncontextmenu: 'onContextMenu', ondragover: 'onDragOver', ondragstart: 'onDragStart', ondrop: 'onDrop',
  onkeydown: 'onKeyDown', onmouseup: 'onMouseUp', onmouseenter: 'onMouseEnter', onmousedown: 'onMouseDown', onmouseleave: 'onMouseLeave',
  onmousemove: 'onMouseMove', onblur: 'onBlur', onscroll: 'onScroll', contenteditable: 'contentEditable',
  suppresscontenteditablewarning: 'suppressContentEditableWarning', spellcheck: 'spellCheck', tabindex: 'tabIndex', readonly: 'readOnly', autofocus: 'autoFocus'
}

const hoverRules = []
const bindRe = /\{\{\s*([^}]+?)\s*\}\}/g

function expr(p, scope) {
  p = p.trim()
  if (p === 'true' || p === 'false' || /^-?\d+(\.\d+)?$/.test(p)) return p
  const parts = p.split('.')
  const head = scope.includes(parts[0]) ? parts[0] : 'V?.' + parts[0]
  return [head, ...parts.slice(1)].join('?.')
}

/** A string with optional bindings → JS expression. */
function strExpr(s, scope) {
  const only = s.match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/)
  if (only) return expr(only[1], scope)
  if (!s.includes('{{')) return JSON.stringify(s)
  return '`' + s.replace(/[`\\]/g, m => '\\' + m).replace(/\$\{/g, '\\${').replace(bindRe, (_, p) => '${' + expr(p, scope) + ' ?? ""}') + '`'
}

function splitDecls(s) {
  const out = []; let depth = 0; let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ';' && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out.map(d => d.trim()).filter(Boolean)
}

const camel = p => p.startsWith('--') ? p : p.replace(/^-webkit-/, 'Webkit-').replace(/-([a-z])/g, (_, c) => c.toUpperCase())

function styleObj(s, scope) {
  const props = splitDecls(s).map(d => {
    const i = d.indexOf(':')
    const k = d.slice(0, i).trim(); const v = d.slice(i + 1).trim()
    return `${JSON.stringify(camel(k))}: ${strExpr(v, scope)}`
  })
  return `{{ ${props.join(', ')} }}`
}

function attrs(node, scope) {
  const out = []
  const classes = []
  for (const a of node.attrs) {
    const name = a.name
    if (name.startsWith('hint-')) continue
    if (name === 'style') { out.push(`style=${styleObj(a.value, scope)}`); continue }
    if (name === 'style-hover' || name === 'style-focus') {
      const cls = `dch${hoverRules.length}`
      const sel = name === 'style-hover' ? ':hover' : ':focus'
      hoverRules.push(`.${cls}${sel}{${splitDecls(a.value).map(d => d + ' !important').join(';')}}`)
      classes.push(cls); continue
    }
    const rn = ATTR[name] || name
    if (rn === 'suppressContentEditableWarning') { out.push('suppressContentEditableWarning={true}'); continue }
    const e = strExpr(a.value, scope)
    out.push(e.startsWith('"') ? `${rn}=${e}` : `${rn}={${e}}`)
  }
  if (classes.length) out.push(`className="${classes.join(' ')}"`)
  return out.length ? ' ' + out.join(' ') : ''
}

const VOID = new Set(['input', 'br', 'img', 'hr'])
let depthCounter = 0

const isFlex = n => /display:\s*(inline-)?(flex|grid)/.test((n.attrs || []).find(a => a.name === 'style')?.value || '')

function render(node, scope, ind, flexParent = false) {
  const pad = '  '.repeat(ind)
  if (node.nodeName === '#text') {
    const t = node.value
    // Whitespace-only text renders nothing inside flex/grid containers; elsewhere it collapses to one space.
    if (!t.trim()) return t.length && !flexParent ? `${pad}{' '}` : ''
    const pieces = []; let last = 0
    for (const m of t.matchAll(bindRe)) {
      if (m.index > last) pieces.push(`{${JSON.stringify(t.slice(last, m.index))}}`)
      pieces.push(`{${expr(m[1], scope)}}`)
      last = m.index + m[0].length
    }
    if (last < t.length) pieces.push(`{${JSON.stringify(t.slice(last))}}`)
    return pad + pieces.join('')
  }
  if (node.nodeName === '#comment') return ''
  if (node.nodeName === 'sc-for') {
    const list = node.attrs.find(a => a.name === 'list').value.match(/\{\{\s*([^}]+?)\s*\}\}/)[1]
    const as = node.attrs.find(a => a.name === 'as').value
    const idx = `${as}_i${depthCounter++}`
    const inner = (node.childNodes || []).map(c => render(c, [...scope, as], ind + 2, flexParent)).filter(Boolean).join('\n')
    return `${pad}{((${expr(list, scope)}) || []).map((${as}: any, ${idx}: number) => (\n${pad}  <React.Fragment key={${idx}}>\n${inner}\n${pad}  </React.Fragment>\n${pad}))}`
  }
  if (node.nodeName === 'sc-if') {
    const cond = node.attrs.find(a => a.name === 'value').value.match(/\{\{\s*([^}]+?)\s*\}\}/)[1]
    const inner = (node.childNodes || []).map(c => render(c, scope, ind + 2, flexParent)).filter(Boolean).join('\n')
    return `${pad}{${expr(cond, scope)} ? (\n${pad}  <>\n${inner}\n${pad}  </>\n${pad}) : null}`
  }
  const tag = node.tagName
  const a = attrs(node, scope)
  if (VOID.has(tag)) return `${pad}<${tag}${a} />`
  const childNodes = node.nodeName === 'template' ? node.content.childNodes : node.childNodes
  const inner = (childNodes || []).map(c => render(c, scope, ind + 1, isFlex(node))).filter(Boolean).join('\n')
  if (tag === 'textarea') return `${pad}<${tag}${a} />`
  return inner ? `${pad}<${tag}${a}>\n${inner}\n${pad}</${tag}>` : `${pad}<${tag}${a} />`
}

const frag = parseFragment(tpl)
const body = frag.childNodes.map(n => render(n, [], 3, true)).filter(Boolean).join('\n')
const out = `// GENERATED ONCE by app/scripts/convert-prototype.mjs from the approved prototype, then maintained by hand.
// Every binding reads from the view-model V computed by the controller (port of the prototype's rv*() methods).
/* eslint-disable */
import React from 'react'

export function Template({ V }: { V: any }) {
  return (
    <>
${body}
    </>
  )
}
`
fs.mkdirSync(path.join(ROOT, 'app/src/renderer/view'), { recursive: true })
fs.writeFileSync(path.join(ROOT, 'app/src/renderer/view/Template.tsx'), out)
fs.writeFileSync(path.join(ROOT, 'app/src/renderer/prototype.css'), `/* Ported verbatim from the prototype <helmet> styles (tokens), plus generated hover/focus classes. */\n${css.trim()}\n\n/* style-hover / style-focus */\n${hoverRules.join('\n')}\n`)
console.log('Template.tsx lines:', out.split('\n').length, 'hover rules:', hoverRules.length)
