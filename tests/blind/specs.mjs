// Blind-evaluation specs, copied verbatim from RFC.md §3C.1 (BK) and §3C.2 (UX) table cells. Do not paraphrase:
// the asker/agent receives `question`/`goal` text exactly as written in the RFC (UX notes in parentheses that describe
// the pre-state are separated into `preState` by agentGoal() below, not edited here).

export const UX_PREAMBLE = "You are an investor using this Mac app for the first time. Achieve the goal. Do not ask questions."

export const BK = [
  {
    id: "BK-Q1",
    question: "Who led Lumen Legal's Series A, and how much did they raise?",
    referenceFacts: "Northwind Ventures led; round updated to $20M (originally reported $18M); Beacon Hill Partners participated",
    allowedInterpretation: "noting the correction/update",
    forbiddenClaims: "any other lead; amounts other than $18M/$20M; valuation figures",
    passRubric: "both required facts with citations; update acknowledged or $20M stated"
  },
  {
    id: "BK-Q2",
    question: "What evidence contradicts my thesis that AI replaces outsourced support labor?",
    referenceFacts: "Callhaven: buyers hit ~58% automation ceiling; two retailers restored human support tiers",
    allowedInterpretation: "assessment of strength",
    forbiddenClaims: "claims not in corpus (e.g., named retailers not in text)",
    passRubric: "both facts cited; framed as contradicting"
  },
  {
    id: "BK-Q3",
    question: "What has Northwind Ventures done recently?",
    referenceFacts: "Led Lumen Legal Series A; led Stackforge $30M Series B; Priya Raman essay arguing services are the new software (as opinion)",
    allowedInterpretation: "pattern commentary labelled interpretation",
    forbiddenClaims: "investments not in corpus",
    passRubric: "3 items; essay attributed as opinion"
  },
  {
    id: "BK-Q4",
    question: "What changed with Brightdesk this month?",
    referenceFacts: "60% of new contracts per-resolution pricing; hired Tomas Berg as CFO; replaced a five-year contact-center contract at Meridian Mutual at $0.90 per resolved conversation (Ledger, auth)",
    allowedInterpretation: "relevance to theses",
    forbiddenClaims: "funding claims for Brightdesk",
    passRubric: "≥3 of 3 facts cited"
  },
  {
    id: "BK-Q5",
    question: "Which legal AI companies am I tracking and how do they compare?",
    referenceFacts: "Lumen Legal (SF, contract review, Series A $20M, Northwind); Quillmate (Stockholm) signed three AmLaw 50 firms already using Lumen Legal",
    allowedInterpretation: "competitive interpretation labelled",
    forbiddenClaims: "revenue/market share numbers",
    passRubric: "both companies + Quillmate fact cited"
  },
  {
    id: "BK-Q6",
    question: "What is Claimwise's annual revenue?",
    referenceFacts: "none available",
    allowedInterpretation: "may cite what is known (seed $9M, 40 employees)",
    forbiddenClaims: "any revenue figure",
    passRubric: "`insufficient` stated; zero revenue numbers"
  },
  {
    id: "BK-Q7",
    question: "What did Harbor Point Capital announce?",
    referenceFacts: "led Claimwise $9M Seed; closed $150M Fund II",
    allowedInterpretation: "—",
    forbiddenClaims: "other funds/investments",
    passRubric: "both cited"
  },
  {
    id: "BK-Q8",
    question: "What is Stackforge building and who is behind it?",
    referenceFacts: "Forge Agents: platform to deploy/operate AI agents, usage-based pricing; CTO Lena Vogt; Berlin; $30M Series B led by Northwind",
    allowedInterpretation: "—",
    forbiddenClaims: "other founders",
    passRubric: "≥3 facts cited"
  }
]

export const UX = [
  {
    id: "UX-01",
    goal: "Start monitoring the news feed at http://vln.test:4700/ but only for legal AI and customer-support automation news, checked daily. (clean profile; ChatGPT sign-in detected)",
    judgeChecks: "web source for `/vln/`, mode custom, instruction mentions legal AI and support automation, freq daily, initial sync succeeded"
  },
  {
    id: "UX-02",
    goal: "Set up a weekly report, delivered by email on Mondays, with new seed-stage companies in AI developer infrastructure and any evidence that contradicts your \"AI replacing outsourced support labor\" thesis.",
    judgeChecks: "report weekly weekday 1, email true, a section with stage filter incl. Seed + thesis/topic devinfra, a section contra for that thesis"
  },
  {
    id: "UX-03",
    goal: "Record this thought and file it under the right thesis: \"Legal buyers seem to be running two vendors side by side — the one-vendor-per-firm idea looks shaky.\"",
    judgeChecks: "note exists with that text anchored to Legal AI, kind counterpoint or observation"
  },
  {
    id: "UX-04",
    goal: "Claimwise is actually a Series A company, not seed. Fix that, and make sure it stays fixed.",
    judgeChecks: "stage current origin user = Series A"
  },
  {
    id: "UX-05",
    goal: "On Lumen Legal's page, show funding history first and stop showing headquarters.",
    judgeChecks: "object view def: main[0] funding_table, headerFields lacks hq"
  },
  {
    id: "UX-06",
    goal: "Make sure you get notified if Northwind Ventures leads another round.",
    judgeChecks: "enabled alert with investorFirms Northwind, lead"
  },
  {
    id: "UX-07",
    goal: "Find out who led Lumen Legal's round and save that fact as evidence supporting your Legal AI thesis.",
    judgeChecks: "evidence with Northwind lead kept/linked accepted support to Legal AI"
  },
  {
    id: "UX-08",
    goal: "Add the publication at http://ledger.test:4700/ as a source. Your login there is reader@ledger.test / (password from goal file). Get its latest article into your feed.",
    judgeChecks: "ledger source authenticated; D14 feed item exists"
  },
  {
    id: "UX-09",
    goal: "The Signal Wire source seems messed up. Rebuild it from scratch but keep your notes and saved items. (pre-state: a note and a saved item from it)",
    judgeChecks: "reset executed (history source.reset); note & saved item intact"
  },
  {
    id: "UX-10",
    goal: "Organize today's feed by thesis.",
    judgeChecks: "feed view def groupBy thesis"
  },
  {
    id: "UX-11",
    goal: "Keep an eye on news about \"AI legal startups raising money\" every day, and also save this X post into your library: http://x.test:4700/dana_okafor_fx/status/101 (you're already signed in to X in the app).",
    judgeChecks: "a `search` source with that query, freq daily; a document for the post; no X profile source created"
  }
]

/** Which prepared profile each UX goal starts from (§3C.2: "BK-SETUP state unless noted"). See setup.spec.ts. */
export const UX_PRESTATE = { 'UX-01': 'clean', 'UX-08': 'ux08', 'UX-09': 'ux09' }

/**
 * The text the UX agent receives: the RFC goal minus parenthetical notes that describe the pre-state (they are
 * instructions to the harness, not to the investor), with "(password from goal file)" filled from the goal file.
 */
export function agentGoal(goal, { password } = {}) {
  let g = goal.replace(/\s*\((clean profile|pre-state)[^)]*\)\s*$/, '')
  if (password !== undefined) g = g.replace('(password from goal file)', password)
  return g
}
