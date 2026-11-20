import { NZB_LIMITS } from './nzb-wire.js';

/** What the shell reads from an NZB document before handing it on. */
export interface NzbDocument {
  /** How many files the document lists. */
  readonly files: number;
  /** The document's own title, tidied for display, or a plain stand-in. */
  readonly name: string;
}

const NAMESPACE = 'http://www.newzbin.com/DTD/2003/nzb';
const MAX_DEPTH = 16;
const MAX_ELEMENTS = 20_000;
const MAX_NAME_LENGTH = 120;
const UNNAMED = 'NZB download';

const NAME = '[\\p{L}_][\\p{L}\\p{N}_.-]*';
const QNAME = `${NAME}(?::${NAME})?`;
const QUOTED = `(?:"[^"]*"|'[^']*')`;
const DECLARATION = /^<\?xml\s[^?]*\?>/;
const ENCODING = /^<\?xml\s[^>]*?encoding\s*=\s*["']([\w.-]+)["']/;
// The grammar has no place for `[`, so a doctype with an internal subset does not match and is refused.
const DOCTYPE = new RegExp(`<!DOCTYPE\\s+${QNAME}(?:\\s+(?:SYSTEM\\s+${QUOTED}|PUBLIC\\s+${QUOTED}\\s+${QUOTED}))?\\s*>`, 'uy');
const END_TAG = new RegExp(`</(${QNAME})\\s*>`, 'uy');
const START_TAG = new RegExp(`<(${QNAME})((?:\\s+${QNAME}\\s*=\\s*(?:"[^<"]*"|'[^<']*'))*)\\s*(/?)>`, 'uy');
const ATTRIBUTE = new RegExp(`(${QNAME})\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'gu');
const REFERENCE = /&[^;]*;?/g;
const NUMBERED = /^&#(?:x([0-9a-fA-F]{1,6})|([0-9]{1,7}));$/;
const XML_CHARACTER = /^[\t\n\r\u{20}-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]$/u;
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;
const UNPRINTABLE = /[\p{C}\s]+/gu;
const PREDEFINED: Readonly<Record<string, string>> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const NO_BINDINGS: ReadonlyMap<string, string> = new Map();

interface OpenElement {
  readonly name: string;
  /** The element's place among NZB-namespace ancestors, such as `nzb/file`; `?` stands for any other element. */
  readonly path: string;
  readonly bindings: ReadonlyMap<string, string>;
}

interface Scan {
  readonly text: string;
  at: number;
  readonly open: OpenElement[];
  elements: number;
  doctype: boolean;
  /** Character data since the last tag. */
  words: string;
  files: number;
  segments: number;
  usable: number;
  metaType: string;
  readonly meta: Map<string, string>;
}

function sure(condition: unknown, why: string): asserts condition {
  if (!condition) throw new Error(`invalid:nzb ${why}`);
}

function decode(bytes: Uint8Array): string {
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  const label = ENCODING.exec(new TextDecoder('latin1').decode(body.subarray(0, 200)))?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(label, { fatal: true }).decode(body);
  } catch {
    throw new Error('invalid:nzb it is not text in the encoding it declares');
  }
}

function reference(written: string): string {
  const known = PREDEFINED[written];
  if (known !== undefined) return known;
  const numbered = NUMBERED.exec(written);
  sure(numbered, 'it uses an entity other than the five XML defines');
  const code = numbered[1] === undefined ? Number(numbered[2]) : Number.parseInt(numbered[1], 16);
  sure(code <= 0x10ffff && XML_CHARACTER.test(String.fromCodePoint(code)), 'it names a character XML does not allow');
  return String.fromCodePoint(code);
}

const resolve = (raw: string): string => raw.replace(REFERENCE, reference);

function attributesOf(raw: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const [, name, double, single] of raw.matchAll(ATTRIBUTE)) {
    sure(!attributes.has(name as string), 'an element repeats an attribute');
    attributes.set(name as string, resolve(double ?? (single as string)));
  }
  return attributes;
}

function bindingsOf(parent: ReadonlyMap<string, string>, attributes: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
  const declared = [...attributes].filter(([name]) => name === 'xmlns' || name.startsWith('xmlns:')).map(([name, uri]) => [name.slice(6), uri] as const);
  return declared.length > 0 ? new Map([...parent, ...declared]) : parent;
}

const ENTER: Readonly<Record<string, (scan: Scan, attributes: ReadonlyMap<string, string>) => void>> = {
  'nzb/file': (scan) => {
    scan.files += 1;
    scan.segments = 0;
  },
  'nzb/head/meta': (scan, attributes) => {
    scan.metaType = attributes.get('type') ?? '';
  },
};

const LEAVE: Readonly<Record<string, (scan: Scan) => void>> = {
  'nzb/file/segments/segment': (scan) => {
    if (scan.words.trim() !== '') scan.segments += 1;
  },
  'nzb/file': (scan) => {
    if (scan.segments > 0) scan.usable += 1;
  },
  'nzb/head/meta': (scan) => {
    if (!scan.meta.has(scan.metaType)) scan.meta.set(scan.metaType, scan.words);
  },
};

function leave(scan: Scan, element: OpenElement): void {
  LEAVE[element.path]?.(scan);
  scan.words = '';
}

function startTag(scan: Scan): void {
  START_TAG.lastIndex = scan.at;
  const tag = START_TAG.exec(scan.text);
  sure(tag, 'a tag is malformed');
  const name = tag[1] as string;
  const parent = scan.open.at(-1);
  sure(parent || scan.elements === 0, 'it has more than one root element');
  sure(scan.open.length < MAX_DEPTH, 'its elements nest too deeply');
  scan.elements += 1;
  sure(scan.elements <= MAX_ELEMENTS, 'it has too many elements');
  const attributes = attributesOf(tag[2] as string);
  const bindings = bindingsOf(parent?.bindings ?? NO_BINDINGS, attributes);
  const [first, second] = name.split(':') as [string, string | undefined];
  const namespace = bindings.get(second === undefined ? '' : first);
  sure(second === undefined || namespace !== undefined, 'an element uses a prefix that is not bound');
  const kind = namespace === NAMESPACE ? (second ?? first) : '?';
  const element: OpenElement = { name, path: parent ? `${parent.path}/${kind}` : kind, bindings };
  sure(parent || element.path === 'nzb', 'its root is not an nzb element in the NZB namespace');
  scan.words = '';
  ENTER[element.path]?.(scan, attributes);
  if (tag[3]) leave(scan, element);
  else scan.open.push(element);
  scan.at += tag[0].length;
}

function endTag(scan: Scan): void {
  END_TAG.lastIndex = scan.at;
  const tag = END_TAG.exec(scan.text);
  const element = scan.open.pop();
  sure(tag && element && tag[1] === element.name, 'an end tag does not match the element it closes');
  leave(scan, element);
  scan.at += tag[0].length;
}

function skipTo(scan: Scan, lead: number, close: string, why: string): string {
  const end = scan.text.indexOf(close, scan.at + lead);
  sure(end !== -1, why);
  const inside = scan.text.slice(scan.at + lead, end);
  scan.at = end + close.length;
  return inside;
}

function literal(scan: Scan): void {
  sure(scan.open.length > 0, 'it has text outside its root element');
  scan.words += skipTo(scan, 9, ']]>', 'a literal section is never closed');
}

function doctype(scan: Scan): void {
  sure(!scan.doctype && scan.elements === 0, 'its doctype is misplaced');
  DOCTYPE.lastIndex = scan.at;
  const declared = DOCTYPE.exec(scan.text);
  sure(declared, 'its doctype carries declarations of its own');
  scan.doctype = true;
  scan.at += declared[0].length;
}

function characters(scan: Scan): void {
  const next = scan.text.indexOf('<', scan.at);
  const end = next === -1 ? scan.text.length : next;
  const words = resolve(scan.text.slice(scan.at, end));
  sure(scan.open.length > 0 || words.trim() === '', 'it has text outside its root element');
  scan.words += words;
  scan.at = end;
}

/** Longest lead first: the first that matches at the cursor decides how the markup is read. */
const MARKUP: ReadonlyArray<readonly [string, (scan: Scan) => void]> = [
  ['<!--', (scan) => void skipTo(scan, 4, '-->', 'a comment is never closed')],
  ['<![CDATA[', literal],
  ['<!DOCTYPE', doctype],
  ['<!', () => sure(false, 'it declares entities or other markup')],
  ['<?', () => sure(false, 'it carries a processing instruction')],
  ['</', endTag],
  ['<', startTag],
  ['', characters],
];

/**
 * Validates one NZB document without handing it to an XML library: the shell runs
 * where there is no `DOMParser`, and a strict scanner cannot be talked into loading
 * a DTD or expanding an entity (NAP-NZB, Submission). Accepted is well-formed XML
 * within the shell's bounds whose root is `nzb` in the NZB namespace and which lists
 * at least one file with a segment. An external doctype is read past and never
 * fetched; an internal subset, any declaration, any entity beyond XML's five and any
 * processing instruction are refused.
 *
 * @param bytes - The document as it will be handed to the downloader.
 * @returns The number of files listed and a display name from the document's own title.
 * @throws `invalid:nzb` followed by plain words for what was wrong.
 * @example
 * ```ts
 * readNzbDocument(bytes); // { files: 2, name: 'Holiday film (2019)' }
 * ```
 */
export function readNzbDocument(bytes: Uint8Array): NzbDocument {
  sure(bytes.length <= NZB_LIMITS.maxNZBBytes, 'it is larger than the shell accepts');
  const text = decode(bytes);
  sure(!FORBIDDEN.test(text), 'it holds a character XML does not allow');
  const scan: Scan = { text, at: DECLARATION.exec(text)?.[0].length ?? 0, open: [], elements: 0, doctype: false, words: '', files: 0, segments: 0, usable: 0, metaType: '', meta: new Map() };
  while (scan.at < text.length) {
    const [, read] = MARKUP.find(([lead]) => text.startsWith(lead, scan.at)) as (typeof MARKUP)[number];
    read(scan);
  }
  sure(scan.open.length === 0, 'it ends before its elements are closed');
  sure(scan.usable > 0, 'it lists no file with segments');
  const title = (scan.meta.get('title') ?? scan.meta.get('name') ?? '').replace(UNPRINTABLE, ' ').trim().slice(0, MAX_NAME_LENGTH);
  return { files: scan.files, name: title || UNNAMED };
}
