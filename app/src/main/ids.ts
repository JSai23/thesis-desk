import { ulid } from 'ulid'

export type IdPrefix = 'src' | 'doc' | 'ev' | 'co' | 'fm' | 'pp' | 'th' | 'nt' | 'rel' | 'sg' | 'fd' | 'fv' | 'fi' | 'vd' | 'rp' | 'rr' | 'al' | 'nf' | 'sc' | 'job' | 'ar' | 'hi' | 'br' | 'bru'

export const newId = (prefix: IdPrefix): string => `${prefix}_${ulid()}`
