import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { EmailMetadataExtractor, decodeMimeWords, parseHeaders } from '../src/email-extractor';

function bufferOf(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function extractorFor(text: string | Error) {
  const app = {
    vault: {
      readBinary: text instanceof Error
        ? vi.fn().mockRejectedValue(text)
        : vi.fn().mockResolvedValue(bufferOf(text)),
    },
  };
  const file = new TFile();
  file.path = 'Attachments/mail.eml';
  return { extractor: new EmailMetadataExtractor(app as any), file };
}

describe('decodeMimeWords', () => {
  it('decodes base64 words', () => {
    expect(decodeMimeWords('=?UTF-8?B?SGVsbG8gV29ybGQ=?=')).toBe('Hello World');
  });
  it('decodes quoted-printable words', () => {
    expect(decodeMimeWords('=?UTF-8?Q?Caf=C3=A9_menu?=')).toBe('Café menu');
  });
  it('joins adjacent encoded words', () => {
    expect(decodeMimeWords('=?UTF-8?Q?foo?= =?UTF-8?Q?bar?=')).toBe('foobar');
  });
  it('falls back to utf-8 on unknown charset', () => {
    expect(decodeMimeWords('=?x-bogus?B?SGk=?=')).toBe('Hi');
  });
  it('returns text when base64 is invalid', () => {
    expect(decodeMimeWords('=?UTF-8?B?***?=')).toBe('***');
  });
  it('leaves plain text untouched', () => {
    expect(decodeMimeWords('plain')).toBe('plain');
  });
});

describe('parseHeaders', () => {
  it('unfolds continuation lines and stops at the body', () => {
    const h = parseHeaders('Subject: a\r\n b\r\nFrom: x\r\n\r\nSubject: body');
    expect(h['subject']).toBe('a b');
    expect(h['from']).toBe('x');
  });
  it('keeps the first occurrence and skips malformed lines', () => {
    const h = parseHeaders('junk\nSubject: one\nSubject: two');
    expect(h['subject']).toBe('one');
  });
});

describe('EmailMetadataExtractor', () => {
  it('extracts subject, sender name and date', async () => {
    const { extractor, file } = extractorFor(
      'From: "Jane Doe" <jane@x.com>\nSubject: Quarterly report\nDate: Tue, 05 Mar 2024 10:00:00 +0000\n\nbody'
    );
    expect(await extractor.extract(file)).toEqual({
      subject: 'Quarterly report', from: 'Jane Doe', date: '2024-03-05',
    });
  });

  it('uses the address when there is no display name', async () => {
    const { extractor, file } = extractorFor('From: <jane@x.com>\nSubject: Hi\n\n');
    expect((await extractor.extract(file)).from).toBe('jane@x.com');
  });

  it('handles a bare address and an unparseable date', async () => {
    const { extractor, file } = extractorFor('From: jane@x.com\nDate: nonsense\n\n');
    const r = await extractor.extract(file);
    expect(r.from).toBe('jane@x.com');
    expect(r.date).toBeNull();
    expect(r.subject).toBe('');
  });

  it('returns empty metadata when the file cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { extractor, file } = extractorFor(new Error('boom'));
    expect(await extractor.extract(file)).toEqual({ subject: '', from: '', date: null });
    warn.mockRestore();
  });
});
