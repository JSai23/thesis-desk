// Renderer-facing response shapes. Backend modules return these; the controller maps them to the prototype view-model.
// Times are epoch ms. Ids are prefixed ULIDs.

export type GroupKey = 'important' | 'companies' | 'theses' | 'sources' | 'firms'
export type Stance = 'support' | 'contra' | 'neutral'

export interface ThesisDTO {
  id: string; parentId: string | null; title: string; description: string; currentView: string; conviction: number
  watching: boolean; archived: boolean; updatedAt: number; createdAt: number; evidenceCount: number; fresh: number
}

export interface CompanyListDTO { id: string; name: string; tagline: string; stage: string; hq: string; domain: string | null; followed: boolean; lastTitle: string; lastDate: number | null; hasUnread: boolean }
export interface FirmListDTO { id: string; name: string; tagline: string; hq: string; domain: string | null; followed: boolean; lastTitle: string; lastDate: number | null }
export interface PersonListDTO { id: string; name: string; role: string; orgId: string; orgType: 'company' | 'firm'; orgName: string; followed: boolean; lastTitle: string; lastDate: number | null }

export interface SourceDTO {
  id: string; name: string; kind: string; typeLabel: string; locator: string; siteDomain: string | null; mode: 'all' | 'relevant' | 'custom'
  instruction: string; freq: 'realtime' | 'hourly' | 'daily' | 'weekly'; priority: 'low' | 'normal' | 'high'; enabled: boolean; muted: boolean
  mutedUntil: number | null; health: 'ok' | 'failing' | 'blocked'; authState: string; authStrategy: string; lastErrorCode: string | null; lastError: string | null
  lastSuccessAt: number | null; lastAttemptAt: number | null; thesisIds: string[]; count: number; label: string; deletedAt: number | null
  recent: { itemId: string | null; documentId: string; title: string; at: number }[]
}

export interface SuggestedSourceDTO { id: string; name: string; typeLabel: string; locator: string; group: string; reason: string; kind: string; available: boolean }
export interface HistoryRowDTO { id: string; title: string; type: string; date: number; outcome: string; documentId: string | null; url: string | null; retryable: boolean; signInDomain?: string | null }

export interface FeedItemDTO {
  id: string; documentId: string; group: GroupKey; surfacedAt: number; publishedAt: number | null
  source: string; srcId: string; srcType: string; url: string | null; title: string; summary: string; why: string
  reason: string; reasons: { type: string; label: string }[]; thesis: string | null; stance: Stance | null; theses: string[]
  cos: string[]; firms: string[]; unread: boolean; saved: boolean; dismissed: boolean; review: boolean
  suggest: { relId: string; thesis: string; stance: Stance; confidence: number } | null; novel: boolean; alert: boolean
  docStatus: string; minutes: number; access: 'full' | 'partial'; hidden: string | null
}

export interface FeedCountsDTO { today: number; all: number; unread: number; saved: number; review: number; remaining: number; done: number; totalToday: number; sourcesToday: number }

export interface ReaderDTO {
  item: FeedItemDTO | null
  document: {
    id: string; title: string; url: string | null; siteName: string | null; author: string | null; publishedAt: number | null; fetchedAt: number
    access: 'full' | 'partial'; accessLabel: string; status: string; processingError: string | null; summary: string | null; text: string
    paragraphs: { text: string; start: number }[]; highlights: { evidenceId: string; start: number; end: number }[]
    orphaned: { evidenceId: string; quote: string }[]; minutes: number; version: number; versions: number
  }
  evidence: { id: string; claim: string; quote: string; kind: string; assertion: string; attributedTo: string | null; kept: boolean; origin: string; previous: string | null }[]
  companies: { id: string; name: string; stage: string; hq: string; followed: boolean }[]
  firms: { id: string; name: string; followed: boolean }[]
  people: { id: string; name: string; role: string; followed: boolean }[]
  theses: { id: string; title: string; stance: Stance; relId: string; status: string; confidence: number; evidenceCount: number }[]
  notes: { id: string; text: string; kind: string; thesisId: string | null; aiState: string }[]
}

export interface EvidenceCardDTO { id: string; text: string; quote: string; src: string; date: number | null; documentId: string; itemId: string | null; stance: Stance; kind: string; attributedTo: string | null; orphaned: boolean; relId?: string; companies: string[]; theses: string[]; assertion: string }
export interface NoteDTO { id: string; text: string; kind: string; createdAt: number; aiState: string; anchorType: string; anchorId: string | null; suggestions: { type: string; id: string; name: string; relId: string }[] }

export interface FieldChipDTO { key: string; label: string; value: string | null; origin: string | null; provenance: string | null; earlier: string | null; fvId: string | null; custom: boolean }
export interface ProposalDTO { fvId: string; key: string; label: string; value: string; current: string; source: string; date: number | null; suggestionId: string }
export interface MergeSuggestionDTO { id: string; otherId: string; otherName: string; explanation: string }

export interface SectionDTO { id: string; component: string; title?: string; params?: any; custom: boolean; instruction?: string; data: any }

export interface CompanyPageDTO {
  id: string; name: string; tagline: string; domain: string | null; followed: boolean; pinned: boolean; lastViewedAt: number | null
  /** DEC-096: followed · connected (one step from something followed — `connectedVia`) · extracted */
  tier: 'followed' | 'connected' | 'extracted'; connectedVia: string[]
  header: FieldChipDTO[]; proposals: ProposalDTO[]; mergeSuggestions: MergeSuggestionDTO[]
  view: { id: string | null; version: number; scope: string; instruction: string | null; isDefault: boolean }
  main: SectionDTO[]; rail: SectionDTO[]
  activity: { documentId: string; itemId: string | null; kind: string; title: string; why: string; date: number | null; src: string }[]
  evidence: EvidenceCardDTO[]; theses: { id: string; title: string; description: string; conviction: number }[]
  investors: { id: string; name: string; followed: boolean; role: string }[]; founders: { id: string; name: string; role: string }[]
  funding: { round: string; amount: string; date: string; lead: string; evidenceIds: string[] }[]
  notes: NoteDTO[]; sources: { id: string; name: string }[]
  /** Coverage still being fetched/read (hydration or linked documents); null when nothing is pending. */
  reading?: ReadingDTO | null
  fromYou: DetailsDTO; lookup: LookupDTO; reprocessed: ReprocessedDTO | null
}
export interface ReadingDTO { pending: number; etaMin: number; searching: boolean }
/** What the user says about an object (DEC-099) — their layer, apart from what the agent maintains. */
export interface DetailsDTO { about: string; website: string | null; otherNames: string[]; fields: Record<string, string>; fieldSet: { key: string; label: string }[] }
/** The last lookup (HYDRATE_OBJECT) for an entity: what it found and what it watches; needsHint when it found nothing to go on. */
/** What the last Re-process changed (DEC-099); pending > 0 while its re-reads run. */
export interface ReprocessedDTO { pending: number; added: number; removed: { relId: string; documentId: string; title: string }[]; website: string | null; at: number }
export interface LookupDTO { state: 'running' | 'done' | 'none'; articles: number; website: string | null; watchQuery: string | null; watchSourceId: string | null; needsHint: boolean; renamedFrom: string | null }

export interface FirmPageDTO {
  id: string; name: string; tagline: string; hq: string; domain: string | null; followed: boolean
  tier: 'followed' | 'connected' | 'extracted'; connectedVia: string[]
  header: FieldChipDTO[]; proposals: ProposalDTO[]; mergeSuggestions: MergeSuggestionDTO[]
  view: { id: string | null; version: number; scope: string; instruction: string | null; isDefault: boolean }
  main: SectionDTO[]; rail: SectionDTO[]
  watching: { sourceId: string | null; enabled: boolean; label: string }
  investments: { companyId: string; name: string; round: string; date: string; note: string; followed: boolean; role: string }[]
  writing: { documentId: string; itemId: string | null; title: string; date: number | null; summary: string }[]
  commentary: { evidenceId: string; text: string; quote: string; where: string; who: string; date: number | null; documentId: string }[]
  portfolio: { id: string; name: string; stage: string }[]; theses: { id: string; title: string; description: string; conviction: number }[]
  evidence: EvidenceCardDTO[]; notes: NoteDTO[]
  reading?: ReadingDTO | null
  fromYou: DetailsDTO; lookup: LookupDTO; reprocessed: ReprocessedDTO | null
}

export interface ThesisPageDTO {
  thesis: ThesisDTO; crumbs: { id: string; title: string }[]; pinned: boolean
  view: { id: string | null; version: number; scope: string; instruction: string | null; isDefault: boolean }
  main: SectionDTO[]; rail: SectionDTO[]
  supporting: EvidenceCardDTO[]; contradicting: EvidenceCardDTO[]
  thoughts: NoteDTO[]; questions: NoteDTO[]; children: (ThesisDTO)[]
  recentChanges: { evidenceId: string; text: string; stance: Stance; date: number | null; documentId: string; itemId: string | null; status: string }[]
  companies: { id: string; name: string; stage: string; lastTitle: string }[]
  firms: { id: string; name: string }[]
  newThesisSuggestions?: { id: string; title: string; explanation: string }[]
  fromYou: DetailsDTO
  suggestedSources: { label: string; locator: string }[]
  /** The last match of this thesis against facts already stored (MATCH_THESIS, DEC-099). */
  match: { state: 'running' | 'done' | 'none'; facts: number; companies: number; documents: number }
}

export interface ReportDTO {
  id: string; name: string; status: 'draft' | 'active' | 'failed'; promptText: string | null; pendingRefinement: string | null; lastError: string | null
  enabled: boolean; scheduleLabel: string; channels: string[]; lastRunAt: number | null; templateKey: string | null; emailNotSetUp: boolean
  refineFailed: boolean; definition: any
  /** Briefings that include this report — the only way a report reaches email (DEC-100). */
  briefings: { id: string; name: string; enabled: boolean }[]
  /** The last definition change (AI refine or the settings strip) — shown with Undo. */
  lastChange: { summary: string; at: number } | null
}
export interface ReportRunDTO { id: string; reportId: string; trigger: string; startedAt: number; finishedAt: number | null; status: string; late: boolean; content: any; deliveredEmailAt: number | null; deliveryError: string | null; error: string | null; /** DEC-093: the run rendered for the app (same HTML as the email, embed variant) */ view?: string }
/** DEC-091: one email built from tagged reports (app/src/main/reports/briefings.ts toDTO). */
export interface BriefingDTO {
  id: string; name: string; reports: { id: string; name: string }[]
  schedule: { kind: 'none' | 'daily' | 'weekdays' | 'weekly'; at?: string; weekday?: number }; scheduleText: string; enabled: boolean; lastSentAt: number | null
  lastRun: { id: string; status: string; at: number; emailedAt: number | null; deliveryError: string | null } | null
}
export interface AlertDTO { id: string; name: string; text: string; status: 'draft' | 'compiled' | 'active' | 'failed'; summary: string | null; backtestCount: number | null; lastError: string | null; channels: string[]; enabled: boolean; anchorType: string | null; anchorId: string | null; lastTriggeredAt: number | null }
