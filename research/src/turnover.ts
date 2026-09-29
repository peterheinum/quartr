/**
 * Classifies the text of an 8-K Item 5.02 section into executive-turnover flags.
 *
 * Rule-based and sentence-level: a flag needs a role (CEO, CFO, ...) and an action verb in the
 * SAME sentence, close together. Every 5.02 section opens with the same boilerplate heading
 * ("Departure of Directors or Certain Officers; Election of Directors; Appointment of ..."), which
 * contains the action words, so it is stripped first or every filing would match everything.
 *
 * CEO and CFO flags are meant for the filer's OWN top executives. Segment heads, subsidiaries'
 * chiefs, other firms' CEOs in a director's biography and "reporting to the CEO" all mention the
 * words but are not a change at the top, and are filtered out (see `ownRole`).
 */

export interface TurnoverFlags {
  ceoOut: boolean;
  ceoIn: boolean;
  cfoOut: boolean;
  cfoIn: boolean;
  /** Other named officers: COO, President, CTO, General Counsel, Chair, ... */
  officerOut: boolean;
  officerIn: boolean;
  directorOut: boolean;
  directorIn: boolean;
}

export type FlagName = keyof TurnoverFlags;

/** The boilerplate item title, in both wordings the SEC's form has used, in any letter case. */
const HEADING =
  /^\s*Item\s+5\.02\.?\s*Departure of Directors or (?:Certain|Principal) Officers;.*?Appointment of (?:Certain|Principal) Officers(?:\s*;\s*Compensatory Arrangements of Certain Officers)?\.?/i;

/** A full stop followed by a capital starts a new sentence, unless it ends an abbreviation ("Mr.", "Inc.") or a middle initial ("Robert A. Iger"). */
const SENTENCE_BREAK = /(?<!\b[A-Z])(?<!\b(?:Mr|Ms|Mrs|Dr|Inc|Corp|Co|No|Jr|Sr|St|Ltd|U\.S|L\.L\.C|P\.C|S\.A))\.\s+(?=[A-Z(“"])/;

const STRONG_OUT =
  /\b(resign(?:ed|s|ation)?|retir(?:e|ed|es|ing|ement)|step(?:s|ped|ping)?\s+down|depart(?:s|ed|ure)?|removed|dismiss(?:ed|al)?|ceas(?:e|ed|es)\s+to\s+(?:serve|be)|(?:will\s+)?not\s+(?:to\s+)?(?:stand|seek|be\s+nominated))\b/i;
const WEAK_OUT = /\b(terminat(?:e|ed|es|ion)|leav(?:e|es|ing)|left|transition(?:s|ed)?\s+(?:from|out))\b/i;
const IN =
  /\b(appoint(?:ed|s|ment)?|elect(?:ed|s)?|nam(?:e|ed|es)|promot(?:e|ed|ion)|succe(?:ed|eded|eds|eding)|join(?:s|ed)?|hire[ds]?|assum(?:e|es|ed))\b/i;
/** Sentences about pay or governance terms mention "termination" and "retirement" without anyone leaving. */
const COMP =
  /\b(award|grant(?:ed)?|compensat\w*|salary|salaries|bonus|severance|equity|RSUs?|stock|shares?|plan|entered\s+into|amend(?:ed|ment)?|agreement|vest\w*|payment|benefits?|retention|pay|polic(?:y|ies))\b/i;

const CEO = /\b(chief\s+executive\s+officer|CEO|principal\s+executive\s+officer)\b/i;
const CFO = /\b(chief\s+financial\s+officer|CFO|principal\s+financial\s+officer)\b/i;
const OFFICER =
  /(?<!vice\s)(?<!vice-)\b(president|chief\s+(?!executive|financial)\w+(?:\s+\w+)?\s+officer|general\s+counsel|chair(?:man|woman|person)?\s+of\s+the\s+board|executive\s+chair(?:man)?|chair(?:man)?)\b/i;
const DIRECTOR = /\b(board\s+of\s+directors|the\s+board|director)\b/i;

/** How many words a role and its action verb may be apart and still be about each other. */
const MAX_GAP_WORDS = 25;

/** Word positions (0-based) at which `re` matches in `s`. */
function wordPositions(s: string, re: RegExp): number[] {
  const global = new RegExp(re.source, "gi");
  return [...s.matchAll(global)].map((m) => s.slice(0, m.index).split(/\s+/).length);
}

/** True when some match of `a` and some match of `b` lie within MAX_GAP_WORDS words of each other. */
function near(sentence: string, a: RegExp, b: RegExp): boolean {
  const pb = wordPositions(sentence, b);
  return wordPositions(sentence, a).some((i) => pb.some((j) => Math.abs(i - j) <= MAX_GAP_WORDS));
}

/** Legal-form words that may follow a company's name without making it a different entity. */
const CORPORATE_SUFFIX = "(?:,?\\s+(?:Inc|Incorporated|Corporation|Corp|Company|Co|Group|Holdings|Systems|Platforms|Sachs|Chase|Stores|&)\\b\\.?)*";

/**
 * Whether `text` starts with the filer's own name, ignoring a leading "of", "the" and comma or dash.
 * "Walmart Inc. (" and "Chevron Corporation" are the filer; "Walmart International" and
 * "Boeing Defense, Space" are units of it, because a further capitalised word follows the name.
 */
function startsWithOwnName(text: string, company?: string): boolean {
  if (!company) return false;
  const re = new RegExp("^[\\s,\\-–—]*(?:of\\s+)?(?:the\\s+)?(?:" + company + ")" + CORPORATE_SUFFIX + "(?![\\s]+[A-Z])", "i");
  return re.test(text);
}

/**
 * True when the mention is of the filer's OWN executive. Rejected: a qualified title ("Chief Executive
 * Officer, Walmart International", "CEO of WhatsApp Inc.", "CEO - Beauty"), a mention in someone's
 * biography ("former", "most recently"), and "reporting to the CEO".
 */
function ownRole(s: string, role: RegExp, company?: string): boolean {
  for (const m of s.matchAll(new RegExp(role.source, "gi"))) {
    const before = s.slice(Math.max(0, m.index - 70), m.index);
    const after = s.slice(m.index + m[0].length);
    if (/(?:report(?:s|ing|ed)?|advis(?:or|er)|assistant|succeed(?:s|ed|ing)?)\s+(?:directly\s+)?to\s+(?:the\s+)?(?:\S+['’]s\s+)?(?:(?:Chairman|President)(?:,|\s+and)?\s+)*$/i.test(before)) continue;
    if (/\b(?:former(?:ly)?|previously|most\s+recently|recently\s+retired|retired)\b[^.]{0,60}$/i.test(before)) continue;
    // A title followed by "," or a dash and a capitalised word is qualified (a segment) unless that word is the filer.
    if (/^\s*[,\-–—]\s*[A-Z]/.test(after) && !/^\s*,\s*(?:Mr|Ms|Mrs|Dr)\b/.test(after) && !startsWithOwnName(after, company)) continue;
    // "... of X": the filer itself, or "the Company"/"the Corporation", or it is someone else's title.
    if (/^\s+of\s/i.test(after) && !/^\s+of\s+the\s+(?:Company|Corporation|Firm|Registrant|Bank)\b/i.test(after) && !startsWithOwnName(after, company)) continue;
    return true;
  }
  return false;
}

/** Flags raised by a single sentence. */
export function classifySentence(s: string, company?: string): FlagName[] {
  const comp = COMP.test(s);
  // Pay language ("retention award", "if he retires") is not a change of person.
  const out = !comp && (STRONG_OUT.test(s) || WEAK_OUT.test(s));
  const inn = IN.test(s) && !comp;
  const ceo = ownRole(s, CEO, company), cfo = ownRole(s, CFO, company);
  const officer = OFFICER.test(s) && !CEO.test(s) && !CFO.test(s);
  const director = DIRECTOR.test(s) && !CEO.test(s) && !CFO.test(s) && !OFFICER.test(s);
  const flags: FlagName[] = [];
  const check = (role: RegExp, present: boolean, base: string) => {
    if (present && out && near(s, role, new RegExp(`${STRONG_OUT.source}|${WEAK_OUT.source}`, "i"))) flags.push(`${base}Out` as FlagName);
    if (present && inn && near(s, role, IN)) flags.push(`${base}In` as FlagName);
  };
  check(CEO, ceo, "ceo");
  check(CFO, cfo, "cfo");
  check(OFFICER, officer, "officer");
  check(DIRECTOR, director, "director");
  return flags;
}

export function sentences(section: string): string[] {
  return section.replace(HEADING, "").split(SENTENCE_BREAK);
}

/** `company`: a regex source matching the filer's own name (e.g. "Walmart|Wal-Mart"), used to tell its CEO from a unit's or another firm's. */
export function classify(section: string | null, company?: string): TurnoverFlags {
  const flags: TurnoverFlags = { ceoOut: false, ceoIn: false, cfoOut: false, cfoIn: false, officerOut: false, officerIn: false, directorOut: false, directorIn: false };
  if (!section) return flags;
  for (const s of sentences(section)) for (const f of classifySentence(s, company)) flags[f] = true;
  return flags;
}
