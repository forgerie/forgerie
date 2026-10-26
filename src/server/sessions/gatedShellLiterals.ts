import { homedir } from "node:os";

interface Word { kind: "word"; raw: string }
interface Separator { kind: "separator"; raw: ";" | "&&" }
type Token = Word | Separator;
interface Simple { kind: "simple"; words: string[]; join: ";" | "&&" }
interface Loop { kind: "loop"; name: string; values: string[]; body: Simple[]; join: ";" | "&&" }
type Statement = Simple | Loop;
const NAME = /^[A-Za-z_][A-Za-z_0-9]*$/u;
const VALUE = /^[A-Za-z_0-9/.~:@%+,=-]+$/u;
// These can change shell variables, control flow or the meaning of later commands.
const MUTATORS = new Set(["export", "read", "unset", "eval", "source", ".", "declare", "typeset", "local", "readonly", "let", "mapfile", "readarray", "printf", "builtin", "trap", "set", "shift", "break", "continue", "return", "alias", "unalias", "getopts", "wait", "enable", "shopt"]);
const COMPOUND = new Set(["if", "then", "else", "elif", "fi", "while", "until", "case", "esac", "select", "coproc", "do", "done", "function", "!"]);
const sensitive = (name: string) => name.startsWith("GIT_") || name.startsWith("BASH") || ["IFS", "CDPATH", "PATH", "HOME", "ENV", "SHELLOPTS", "PWD", "OLDPWD", "RANDOM", "SRANDOM", "SECONDS", "EPOCHSECONDS", "EPOCHREALTIME", "LINENO", "UID", "EUID", "PPID", "_", "COLUMNS", "LINES", "DIRSTACK", "GROUPS", "FUNCNAME", "PIPESTATUS", "HISTCMD", "HISTSIZE", "HISTFILESIZE", "SHLVL", "TMOUT", "OPTIND", "OPTERR", "MAILCHECK", "POSIXLY_CORRECT"].includes(name);

/** Expand only a small, fully literal shell language. Any unsupported syntax keeps the original fail-closed analysis. */
export function expandGatedShellLiterals(script: string): string {
  if (!script.includes("$") && !/\bfor\s/u.test(script)) return script;
  const tokens = tokenize(script);
  if (tokens === undefined) return script;
  const statements = statementsFrom(tokens);
  if (statements === undefined) return script;
  const declared = new Set<string>(); const variables = new Map<string, string>();
  let output = ""; let commands = 0; let guaranteed = true;
  const expand = (word: string): string | undefined => {
    // Single-quoted variable text is data, never a variable use.
    if (/'[^']*\$/u.test(word)) return undefined;
    const state = {known: true};
    const expanded = word.replace(/\$(?:\{([A-Za-z_][A-Za-z_0-9]*)\}|([A-Za-z_][A-Za-z_0-9]*))/gu, (_all: string, braced: string | undefined, plain: string | undefined) => {
      const value = variables.get(braced ?? plain ?? "");
      if (value === undefined) state.known = false;
      return value ?? "<unknown>";
    });
    return !expanded.includes("$") && state.known ? expanded : undefined;
  };
  const emit = (statement: Simple, inLoop: boolean): boolean => {
    if (++commands > 256) return false;
    // Scratch branch ownership still requires literal branch names, as before.
    if (statement.words.some(word => unquote(word) === "branch") && statement.words.some(word => word.includes("$"))) return false;
    const first = statement.words[0] ?? "";
    const assignment = /^([A-Za-z_][A-Za-z_0-9]*)=(.*)$/u.exec(first);
    if (assignment !== null) {
      const name = assignment[1] ?? ""; const raw = assignment[2] ?? ""; const value = literalValue(raw);
      // An earlier failing command can skip an assignment. Reassignment is deliberately not interpreted.
      if (inLoop || !guaranteed || statement.words.length !== 1 || declared.has(name) || sensitive(name) || value === undefined) return false;
      declared.add(name); variables.set(name, raw.startsWith("~") ? `${homedir()}${value.slice(1)}` : value);
    } else {
      // Reject even wrapped mutators and assignment-like arguments rather than guess which builtin executes.
      if (statement.words.some(word => MUTATORS.has(unquote(word)) || /^[A-Za-z_][A-Za-z_0-9]*\+?=/u.test(word))) return false;
      guaranteed = false;
    }
    const words = statement.words.map(expand);
    if (words.some(word => word === undefined || MUTATORS.has(unquote(word)))) return false;
    if (words.some(word => word !== undefined && unquote(word) === "branch") && statement.words.some(word => word.includes("$"))) return false;
    output += `${words.join(" ")} ${statement.join}\n`;
    if (statement.join === ";") guaranteed = true;
    return true;
  };
  for (const statement of statements) {
    if (statement.kind === "simple") { if (!emit(statement, false)) return script; continue; }
    if (!guaranteed || declared.has(statement.name) || sensitive(statement.name)) return script;
    declared.add(statement.name);
    for (const value of statement.values) {
      variables.set(statement.name, value);
      for (const command of statement.body) if (!emit(command, true)) return script;
    }
    variables.delete(statement.name); // The loop's final value is not inferred for later commands.
    output += `true ${statement.join}\n`;
    guaranteed = statement.join === ";";
  }
  return output.replace(/\s*(?:;|&&)\s*$/u, "");
}

function unquote(raw: string): string { return raw.replace(/['"]/gu, ""); }
function literalValue(raw: string): string | undefined {
  const value = unquote(raw);
  if (!VALUE.test(value) || /^~[^/]/u.test(value) || (value.includes("~") && !/^~(?:\/[A-Za-z_0-9/.@%+,=-]*)?$/u.test(raw))) return undefined;
  return value;
}

function tokenize(script: string): Token[] | undefined {
  const tokens: Token[] = [];
  for (let i = 0; i < script.length;) {
    const char = script[i] ?? "";
    if (char === ";" || char === "\n") { tokens.push({kind: "separator", raw: ";"}); i++; continue; }
    if (/\s/u.test(char)) { i++; continue; }
    if (script.slice(i, i + 2) === "&&") { tokens.push({kind: "separator", raw: "&&"}); i += 2; continue; }
    const start = i; let quote = "";
    while (i < script.length) {
      const c = script[i] ?? "";
      if (quote === "" && /[\s;]/u.test(c)) break;
      if (quote === "" && script.slice(i, i + 2) === "&&") break;
      if (c === "\\" || c === "`" || (quote === "" && /[|&(){}<>*?[\]#]/u.test(c))) return undefined;
      if (c === "$" && quote !== "'") {
        const variable = /^\$(?:\{[A-Za-z_][A-Za-z_0-9]*\}|[A-Za-z_][A-Za-z_0-9]*)/u.exec(script.slice(i));
        if (variable === null) return undefined;
        i += variable[0].length; continue;
      }
      if (quote !== "") { if (c === quote) quote = ""; }
      else if (c === "'" || c === '"') quote = c;
      i++;
    }
    if (quote !== "" || i === start) return undefined;
    tokens.push({kind: "word", raw: script.slice(start, i)});
  }
  return tokens;
}

function statementsFrom(tokens: Token[]): Statement[] | undefined {
  let index = 0;
  const separators = () => { while (tokens[index]?.kind === "separator" && tokens[index]?.raw === ";") index++; };
  const simple = (): Simple | undefined => {
    const words: string[] = [];
    while (tokens[index]?.kind === "word") { words.push(tokens[index]?.raw ?? ""); index++; }
    if (words.length === 0 || words.some(word => COMPOUND.has(word) || word === "for")) return undefined;
    const join = tokens[index]?.raw === "&&" ? "&&" : ";";
    if (tokens[index]?.kind === "separator") index++;
    return {kind: "simple", words, join};
  };
  const result: Statement[] = [];
  while (index < tokens.length) {
    separators(); if (index === tokens.length) break;
    if (tokens[index]?.raw !== "for") { const command = simple(); if (command === undefined) return undefined; result.push(command); continue; }
    index++;
    const name = tokens[index++]?.raw ?? "";
    if (!NAME.test(name) || tokens[index++]?.raw !== "in") return undefined;
    const values: string[] = [];
    while (tokens[index]?.kind === "word") {
      const raw = tokens[index++]?.raw ?? ""; const value = literalValue(raw);
      if (value === undefined || raw.startsWith("~")) return undefined;
      values.push(value);
    }
    if (values.length === 0 || values.length > 64 || tokens[index]?.raw !== ";") return undefined;
    separators(); if (tokens[index++]?.raw !== "do") return undefined;
    const body: Simple[] = [];
    for (;;) {
      separators(); if (tokens[index]?.raw === "done") break;
      const command = simple(); if (command === undefined || command.join === "&&" && tokens[index]?.raw === "done") return undefined;
      body.push(command);
    }
    index++;
    if (body.length === 0 || tokens[index]?.kind === "word") return undefined;
    const join = tokens[index]?.raw === "&&" ? "&&" : ";";
    if (tokens[index]?.kind === "separator") index++;
    result.push({kind: "loop", name, values, body, join});
  }
  return result;
}
