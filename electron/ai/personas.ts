/**
 * Personas: long Markdown briefs (often 10–20k words) that tell the model who to be for a task, e.g. "senior
 * software architect" or "technical editor". They live as .md files in `<Notes folder>/Personas`, so they
 * can be written and edited in Litho itself, and are picked per task in Settings.
 *
 * A persona is the stable front of every prompt it's used in, which is what makes it cheap: Claude caches it
 * (see claude.ts), and Ollama gets a context window sized to fit it. Node only, no Electron import.
 */
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { STARTER_PERSONAS } from './starterPersonas';

export const PERSONAS_FOLDER_NAME = 'Personas';
/** About 100k tokens: well past the 10–20k words a persona is meant to be, and far inside every context window. */
export const PERSONA_MAX_CHARS = 400_000;

export interface PersonaInfo {
  /** The file name, e.g. "Software architect.md". Settings store this. */
  id: string;
  name: string;
  description?: string;
  words: number;
  /** A rough count (characters / 4) for display; the provider's own usage figures are the real ones. */
  approxTokens: number;
  tooLarge?: boolean;
}

export interface Persona extends PersonaInfo {
  text: string;
}

/** A plain file name ending in .md: no folders, no traversal, nothing hidden. */
export function isPersonaId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length <= 200 &&
    /\.md$/i.test(id) &&
    !/[\\/:*?"<>|\r\n\0]/.test(id) &&
    !id.startsWith('.') &&
    path.basename(id) === id
  );
}

export const approxTokens = (text: string) => Math.ceil(text.length / 4);
const countWords = (text: string) => (text.match(/\S+/g) || []).length;

/** Frontmatter `name`/`description` if present; otherwise the first H1, then the file name. */
export function parsePersona(id: string, raw: string): Persona {
  let data: Record<string, unknown> = {};
  let body = raw;
  try {
    const parsed = matter(raw);
    data = parsed.data || {};
    body = parsed.content;
  } catch {
    // Broken frontmatter: use the file as written.
  }
  const text = body.replace(/^﻿/, '').trim();
  const h1 = text.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1];
  const name = (typeof data.name === 'string' && data.name.trim()) || h1 || id.replace(/\.md$/i, '');
  const description = typeof data.description === 'string' && data.description.trim() ? data.description.trim() : undefined;
  return {
    id,
    name,
    description,
    text,
    words: countWords(text),
    approxTokens: approxTokens(text),
    tooLarge: text.length > PERSONA_MAX_CHARS || undefined,
  };
}

export async function listPersonas(dir: string): Promise<PersonaInfo[]> {
  let names: string[];
  try {
    names = (await fs.promises.readdir(dir, { withFileTypes: true })).filter((d) => d.isFile() && isPersonaId(d.name)).map((d) => d.name);
  } catch {
    return []; // no folder yet
  }
  const out: PersonaInfo[] = [];
  for (const id of names.sort((a, b) => a.localeCompare(b))) {
    try {
      const { text: _text, ...info } = parsePersona(id, await fs.promises.readFile(path.join(dir, id), 'utf-8'));
      out.push(info);
    } catch {
      // unreadable file: leave it out
    }
  }
  return out;
}

/** Reads one persona; a clear sentence when it can't be used. */
export async function readPersona(dir: string, id: string): Promise<Persona> {
  if (!isPersonaId(id)) throw new Error('That persona name is not valid.');
  let raw: string;
  try {
    raw = await fs.promises.readFile(path.join(dir, id), 'utf-8');
  } catch {
    throw new Error(`The persona "${id.replace(/\.md$/i, '')}" is no longer in the Personas folder. Pick another in Settings.`);
  }
  const persona = parsePersona(id, raw);
  if (persona.tooLarge) throw new Error(`The persona "${persona.name}" is too long (over ${PERSONA_MAX_CHARS.toLocaleString('en-US')} characters).`);
  if (!persona.text) throw new Error(`The persona "${persona.name}" is empty.`);
  return persona;
}

const TEMPLATE = (name: string) => `---
name: ${name}
description: One line on what this persona is for.
---

# ${name}

Write who the AI should be when this persona is picked: its role, what it knows, how it thinks, and how it writes. Long is fine (10–20k words): with Claude, the persona is cached, so a long one costs little after the first request.

## Role

## What good work looks like

## How to answer
`;

/** Creates a starter persona without ever overwriting a file. Returns its id. */
export async function createPersona(dir: string, name: string): Promise<string> {
  const clean = name.replace(/[\\/:*?"<>|\r\n\0]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  if (!clean) throw new Error('Give the persona a name.');
  await fs.promises.mkdir(dir, { recursive: true });
  for (let n = 1; n < 100; n++) {
    const id = `${clean}${n > 1 ? ` ${n}` : ''}.md`;
    if (!isPersonaId(id)) throw new Error('That persona name is not valid.');
    try {
      await fs.promises.writeFile(path.join(dir, id), TEMPLATE(clean), { encoding: 'utf-8', flag: 'wx' });
      return id;
    } catch (e: any) {
      if (e?.code !== 'EEXIST') throw e;
    }
  }
  throw new Error('Too many personas with that name.');
}

/** Copies the starter personas in, skipping any name already there. Returns the ids actually added. */
export async function addStarterPersonas(dir: string): Promise<string[]> {
  await fs.promises.mkdir(dir, { recursive: true });
  const added: string[] = [];
  for (const p of STARTER_PERSONAS) {
    try {
      await fs.promises.writeFile(path.join(dir, p.id), p.text, { encoding: 'utf-8', flag: 'wx' });
      added.push(p.id);
    } catch (e: any) {
      if (e?.code !== 'EEXIST') throw e;
    }
  }
  return added;
}

/**
 * Ollama's context window for a prompt of this size: room for the whole prompt plus the answer, in steps of
 * 4,096, never below the 16k default and never above 128k (llama3.2's limit; larger only slows a small GPU).
 * Characters / 3 overestimates tokens on purpose: a window too small silently cuts the persona.
 */
export function ollamaContextFor(promptChars: number, answerTokens = 4096): number {
  const need = Math.ceil(promptChars / 3) + answerTokens;
  return Math.min(131072, Math.max(16384, Math.ceil(need / 4096) * 4096));
}
