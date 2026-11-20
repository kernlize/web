const NS = 'http://www.newzbin.com/DTD/2003/nzb';
const SEGMENT = '<segment bytes="8" number="1">part@example.net</segment>';

const file = (number: number, segments = SEGMENT): string =>
  `<file poster="a@example.net" date="1793361600" subject="file${number}.bin"><groups><group>alt.test</group></groups><segments>${segments}</segments></file>`;
const nzb = (inner: string, attributes = `xmlns="${NS}"`): string => `<nzb ${attributes}>${inner}</nzb>`;
const titled = (title: string, type = 'title'): string => nzb(`<head><meta type="${type}">${title}</meta></head>${file(1)}`);
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const plain = nzb(file(1));

/** NZB documents by the name scenarios call them: the sound ones first, then every way one can be hostile or broken. */
const DOCUMENTS: Readonly<Record<string, () => Uint8Array>> = {
  'one file': () => utf8(plain),
  'holiday film': () =>
    utf8(
      `<?xml version="1.0" encoding="UTF-8"?>\n${nzb(`<head><meta type="title">Holiday film (2019)</meta><meta type="category">secret-scripts</meta><meta type="title">A second title</meta><meta>untyped</meta></head>${file(1)}${file(2)}`)}\n`,
    ),
  'external doctype': () => utf8(`<?xml version="1.0"?>\n<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.1//EN" "http://www.newzbin.com/DTD/nzb/nzb-1.1.dtd">\n${plain}`),
  'system doctype': () => utf8(`<!DOCTYPE nzb SYSTEM 'nzb.dtd' >${plain}`),
  'latin-1': () => new Uint8Array(Buffer.from(`<?xml version="1.0" encoding="iso-8859-1" ?>${titled('Café')}`, 'latin1')),
  'byte order mark': () => new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(plain)]),
  prefixed: () =>
    utf8(`<n:nzb xmlns:n="${NS}"><n:head><n:meta type="title">Prefixed</n:meta></n:head><n:file subject="a"><n:segments><n:segment number="1">a@example.net</n:segment></n:segments></n:file></n:nzb>`),
  comments: () => utf8(`<!-- before -->${nzb(`<!-- inside --><head><meta type="title"><![CDATA[A <literal> title]]></meta></head>${file(1)}`)}<!-- after -->\n`),
  'single quotes': () => utf8(`<nzb xmlns='${NS}'><file subject='a'><segments><segment number='1'>a@example.net</segment></segments></file></nzb>`),
  numbered: () => utf8(nzb(`<head><meta type="title" note="&quot;&apos;&lt;&gt;">A&amp;B &#60;C&#x3E;</meta></head>${file(1)}`)),
  named: () => utf8(titled('Only a name', 'name')),
  'long title': () => utf8(titled('x'.repeat(300))),
  'blank title': () => utf8(titled(' \n\t ')),
  'foreign elements': () => utf8(nzb(`<x:extra xmlns:x="urn:else"><x:file><x:segments><x:segment>no</x:segment></x:segments></x:file></x:extra><other xmlns="urn:another"/>${file(1)}`)),
  'mixed files': () => utf8(nzb(file(1) + file(2, ''))),
  'nearly oversize': () => utf8(plain + ' '.repeat(10 * 1024 * 1024 - plain.length)),

  'entity declaration': () => utf8(`<!DOCTYPE nzb [<!ENTITY lol "lol"><!ENTITY xxe SYSTEM "file:///etc/passwd">]>${titled('&xxe;')}`),
  'internal subset': () => utf8(`<!DOCTYPE nzb [ <!ELEMENT nzb ANY> ]>${plain}`),
  'stray declaration': () => utf8(nzb(`<!ENTITY lol "lol">${file(1)}`)),
  'unknown entity': () => utf8(titled('&nbsp;')),
  'impossible character': () => utf8(titled('&#0;')),
  'control character': () => utf8(titled('a\u0001b')),
  'wrong namespace': () => utf8(nzb(file(1), 'xmlns="urn:not-nzb"')),
  'no namespace': () => utf8(`<nzb>${file(1)}</nzb>`),
  'wrong root': () => utf8(`<rss xmlns="${NS}">${file(1)}</rss>`),
  'unbound prefix': () => utf8(`<n:nzb>${file(1)}</n:nzb>`),
  'no files': () => utf8(nzb('<head/>')),
  'no segments': () => utf8(nzb(file(1, ''))),
  'empty segments': () => utf8(nzb(file(1, '<segment bytes="1" number="1">  </segment><segment/>'))),
  'too deep': () => utf8(nzb(`${'<a>'.repeat(16)}${'</a>'.repeat(16)}${file(1)}`)),
  'too many elements': () => utf8(nzb(file(1) + '<x/>'.repeat(20_000))),
  oversize: () => utf8(plain + ' '.repeat(10 * 1024 * 1024)),
  'processing instruction': () => utf8(`<?xml version="1.0"?><?xml-stylesheet href="x"?>${plain}`),
  'late declaration': () => utf8(` <?xml version="1.0"?>${plain}`),
  'two doctypes': () => utf8(`<!DOCTYPE nzb><!DOCTYPE nzb>${plain}`),
  'late doctype': () => utf8(`${plain}<!DOCTYPE nzb>`),
  'cut off': () => utf8(`<nzb xmlns="${NS}"><file subject="a"><segments>`),
  'mismatched end': () => utf8(nzb(`<head></meta>${file(1)}`)),
  'stray end': () => utf8(`${plain}</nzb>`),
  'two roots': () => utf8(plain + plain),
  'text outside': () => utf8(`${plain}hello`),
  'repeated attribute': () => utf8(nzb(file(1), `xmlns="${NS}" xmlns="${NS}"`)),
  'open comment': () => utf8(`${plain}<!-- never closed`),
  'open literal': () => utf8(`<nzb xmlns="${NS}"><head><meta type="title"><![CDATA[never closed`),
  'literal outside': () => utf8(`<![CDATA[words]]>${plain}`),
  'broken tag': () => utf8(nzb(`<head =>${file(1)}`)),
  'bad encoding': () => new Uint8Array(Buffer.from(titled('Café'), 'latin1')),
  'unknown encoding': () => utf8(`<?xml version="1.0" encoding="klingon"?>${plain}`),
  empty: () => new Uint8Array(),
  'not xml': () => utf8('hello world'),
};

/** The bytes of a named document. */
export function nzbDocument(name: string): Uint8Array {
  const make = DOCUMENTS[name];
  if (!make) throw new Error(`no NZB document called ${name}`);
  return make();
}
