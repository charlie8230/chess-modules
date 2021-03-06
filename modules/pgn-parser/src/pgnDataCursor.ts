/*
 * ****************************************************************************
 * Copyright (C) 2018-2018 chess-fu.com
 * License: MIT
 * Author: chess-fu.com
 * Homepage: https://chess-fu.com
 * Repository: https://github.com/chess-fu/chess-modules
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the 'Software'), to 
 * deal in the Software without restriction, including without limitation the 
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or 
 * sell copies of the Software, and to permit persons to whom the Software is 
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in 
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR 
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE 
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 * ****************************************************************************
 */
import { HeaderEntry, MoveHistory } from './pgnTypes';

const EOF: string = '';
const NEWLINE = '\n';

/** @private */
export enum PgnTokenType {
  EndOfFile = '',
  Newline = '\n',
  Whitespace = ' ',
  CommentStart = '{',
  CommentEnd = '}',
  TagPairStart = '[',
  TagPairEnd = ']',
  RavStart = '(',
  RavEnd = ')',
  ExpansionStart = '<',
  ExpansionEnd = '>',
  LineEscape = '%',
  Quote = '"',
  CommentToEOL = ';',
  FullStop = '.',
  Asterisks = '*',
  NAG = '$',
  SymbolExt = '-extra',
  SymbolChar = 'alpha-num',
  Unknown = 'unknown',
}

/** @private */
export class PgnDataCursor {
  private readonly _data: string;
  private readonly _validLength: number;

  /** Ordinal offset at last new-line */
  private _lineOffset: number;
  /** Current line number starting at 1 */
  private _line: number;
  /** Offset in the entire _data string */
  private _offset: number;

  constructor(data: string, index?: number, length?: number) {
    this._data = data;
    this._offset = index || 0;
    this._validLength = length || (this._data ? this._data.length : -1);

    this._line = 1;
    this._lineOffset = 0;
  }

  throwError(text: string): any {
    const message = `${text} (at line ${this._line}:${this._offset - this._lineOffset})`;
    const error: any = new Error(message);
    error.lineNumber = this._line;
    error.lineOffset = this._offset - this._lineOffset;
    error.textOffset = this._offset;
    throw error;
  }

  position(): number { return this._offset; }

  save(): any {
    const { _line, _lineOffset, _offset } = this;
    return { _line, _lineOffset, _offset };
  }

  restore(saveData: any) {
    this._line = saveData._line;
    this._lineOffset = saveData._lineOffset;
    this._offset = saveData._offset;
  }

  peek(): string {
    if (this._offset >= this._validLength) {
      return EOF;
    }
    return this._data[this._offset];
  }

  peekExact(match: string) {
    for (let ix = 0; ix < match.length; ix++) {
      if (this._data[this._offset + ix] !== match[ix]) {
        return null;
      }
    }
    return match;
  }

  peekToken(): PgnTokenType {
    const ch = this.peek();
    switch (ch) {
      case '': return PgnTokenType.EndOfFile;
      case '\n':
      case '\r': return PgnTokenType.Newline;
      case '\t':
      case '\v':
      case ' ': return PgnTokenType.Whitespace;
      case '{': return PgnTokenType.CommentStart;
      case '}': return PgnTokenType.CommentEnd;
      case '[': return PgnTokenType.TagPairStart;
      case ']': return PgnTokenType.TagPairEnd;
      case '(': return PgnTokenType.RavStart;
      case ')': return PgnTokenType.RavEnd;
      case '<': return PgnTokenType.ExpansionStart;
      case '>': return PgnTokenType.ExpansionEnd;
      case '%': return PgnTokenType.LineEscape;
      case '"': return PgnTokenType.Quote;
      case ';': return PgnTokenType.CommentToEOL;
      case '.': return PgnTokenType.FullStop;
      case '*': return PgnTokenType.Asterisks;
      case '$': return PgnTokenType.NAG;
      case '_':
      case '+':
      case '#':
      case '=':
      case ':':
      case '-': return PgnTokenType.SymbolExt;
      default: break;
    }

    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')) {
      return PgnTokenType.SymbolChar;
    }

    return PgnTokenType.Unknown;
  }

  isEOF() {
    return this.peek() === EOF;
  }

  seek(relativeOffset: number) {
    for (let ix = 0; ix < relativeOffset; ix++) {
      this.read();
    }
  }

  read(): string {
    if (this._offset >= this._validLength) {
      return EOF;
    }
    const char = this._data[this._offset++];
    if (char === NEWLINE) {
      this._lineOffset = this._offset;
      this._line++;
    }
    return char;
  }

  readFromPrevious(position: number) {
    if (position < this._offset) {
      return this._data.substr(position, this._offset - position);
    }
    return '';
  }

  readWhile(test: () => boolean) {
    const result: string[] = [];
    while (test() && !this.isEOF()) {
      result.push(this.read());
    }
    return result.join('');
  }

  private readonly Readers = {
    SymbolSimple: () => {
      return this.peekToken() === PgnTokenType.SymbolChar || this.peek() === '_';
    },
    NotNewline: () => {
      return this.peekToken() !== PgnTokenType.Newline;
    },
    NotCommentEnd: () => {
      return this.peekToken() !== PgnTokenType.CommentEnd;
    },
    NotExpansionEnd: () => {
      return this.peekToken() !== PgnTokenType.ExpansionEnd;
    }
  };

  readSymbol() {
    if (this.peekToken() !== PgnTokenType.SymbolChar) {
      return this.throwError(`Expected a symbol start character`);
    }
    return this.read() + this.readWhile(this.Readers.SymbolSimple);
  }

  readAll(char: string, limit?: number) {
    let count = 0;
    let next = this.peek();
    while (next === char) {
      if (limit && count >= limit) {
        return count;
      }

      count++;
      this.read();
      next = this.peek();
    }
    return count;
  }

  readNumber(): number | null {
    const digits = [];
    let next = this.peek();
    while (next >= '0' && next <= '9') {
      digits.push(this.read());
      next = this.peek();
    }
    if (!digits.length) {
      return null;
    }
    return parseInt(digits.join(''), 10);
  }

  readString(): string {
    if (this.peekToken() !== PgnTokenType.Quote) {
      return this.throwError(`Expected a quoted string`);
    }
    this.read();

    const result = [];
    let next = this.read();
    while (next !== EOF && next !== '"') {
      if (next === '\\') {
        const escaped = this.peek();
        if (escaped === '\\' || escaped === '"') {
          result.push(this.read());
          next = this.read();
          continue;
        }
      }
      if (next === '\n' || next === '\r') {
        return this.throwError(`String contains new line "${result.join('')}"`);
      }

      result.push(next);
      next = this.read();
    }

    if (next !== '"') {
      return this.throwError(`Unterminated string "${result.join('')}"`);
    }

    return result.join('');
  }

  skipCommentsFrom(comments?: string[]): boolean {
    const startPos = this._offset;
    const found = [];

    while (true) {
      const savePos = this.save();
      const next = this.peekToken();

      if (next === PgnTokenType.CommentToEOL) {
        this.read();
        found.push(this.readWhile(this.Readers.NotNewline));
        if (this.peekToken() === PgnTokenType.Newline) {
          this.read();
        }
      }
      else if (next === PgnTokenType.CommentStart) {
        this.read();
        found.push(this.readWhile(this.Readers.NotCommentEnd));
        if (this.peekToken() === PgnTokenType.CommentEnd) {
          this.read();
        }
        else {
          this.restore(savePos);
          return this.throwError('Unterminated comment.');
        }
      }
      else if (next === PgnTokenType.ExpansionStart) {
        this.read();
        this.readWhile(this.Readers.NotExpansionEnd);
        if (this.peekToken() === PgnTokenType.ExpansionEnd) {
          this.read();
        }
        else {
          this.restore(savePos);
          return this.throwError('Unterminated expansion text.');
        }
      }
      else if (next === PgnTokenType.LineEscape && (this._offset === this._lineOffset)) {
        this.read();
        this.readWhile(this.Readers.NotNewline);
      }
      else {
        break;
      }
    }

    if (comments) {
      found.forEach(c => comments.push(c));
    }
    return this._offset > startPos;
  }

  skipWhitespace(skipNewline: boolean = false, comments?: string[]) {
    while (true) {
      const next = this.peekToken();
      if (next === PgnTokenType.Whitespace || (skipNewline && next === PgnTokenType.Newline)) {
        this.read();
      }
      else if (this.skipCommentsFrom(comments)) {
        /* continue */
      }
      else {
        break;
      }
    }
  }

  readTagPair(): HeaderEntry | null {
    if (this.peekToken() !== PgnTokenType.TagPairStart) {
      return this.throwError(`Expected a tag-pair open`);
    }

    const comments: string[] = [];

    const savePos = this.save();
    this.read();
    this.skipWhitespace(true, comments);
    const symbol = this.readSymbol();
    this.skipWhitespace(true, comments);
    const value = this.readString();
    this.skipWhitespace(true, comments);

    if (this.peekToken() !== PgnTokenType.TagPairEnd) {
      this.restore(savePos);
      return this.throwError(`The tag pair ${symbol} = ${value} was not closed`);
    }
    this.read();

    const hdr: HeaderEntry = { name: symbol, value };
    if (comments.length) {
      hdr.comments = comments;
    }
    return hdr;
  }

  private readonly pieceSAN = {
    P: true, R: true, N: true, B: true, Q: true, K: true
  };

  // a-h, x, prnbqk, o, 0-8, +, #, [?!]{1,2}, =, -, $0-255, 
  readMoveText(): MoveHistory | null {
    const savePos = this.save();
    const startPos = this.position();
    let rawText = '';
    let move: MoveHistory | null = null;
    try {
      move = this._readMoveText();
      rawText = this.readFromPrevious(startPos);
      if (move && move.to) {
        move.raw = rawText;
        move.san = move.piece === 'P' ? '' : move.piece;
        if (move.piece === 'K' && move.to && move.to[0] === 'O') {
          move.san = '';
        }
        move.san += move.from || '';
        move.san += move.captured ? 'x' : '';
        move.san += move.to || '';
        move.san += move.promotion ? ('=' + move.promotion) : '';
        move.san += move.check === '+' ? '+' : (move.check ? '#' : '');
        return move;
      }
    }
    finally {
      if (!move) {
        this.restore(savePos);
      }
    }
    return this.throwError(`Invalid move "${rawText}"`);
  }

  private _readMoveText(): MoveHistory | null {
    const move: MoveHistory = {};

    let next = this.peek();

    // ## Get the piece moved...
    if (next === 'O') { // Starts with an 'O' castle...?
      move.piece = 'K';
    }
    else if (this.pieceSAN[next]) { // Starts with a piece...?
      move.piece = this.read();
      next = this.peek();
    }
    else {
      move.piece = 'P';
    }

    // ## maybe find simple answer, i.e. Ka1
    if (next >= 'a' && next <= 'h') {
      move.to = this.read();
      next = this.peek();
    }
    if (next >= '1' && next <= '8') {
      move.to = (move.to || '') + this.read();
      next = this.peek();
    }

    // allow LAN (e2-e4), allow captures: Nxe4, NXe4, N:e4
    if (next === '-' || next === ':' || next === 'x' || (next >= 'a' && next <= 'h')) {
      // ## Either LAN or capture notation
      if (move.to) {
        move.from = move.to;
      }
      delete move.to;
      if (next === '-' || next === ':' || next === 'x') {
        move.captured = (next === ':' || next === 'x');
        this.read();
        next = this.peek();
      }
      // ## The attacked/target square
      if (next >= 'a' && next <= 'h') {
        move.to = this.read();
        next = this.peek();
      }
      if (next >= '1' && next <= '8') {
        move.to = (move.to || '') + this.read();
        next = this.peek();
      }
    }

    // ## If no target square yet, see if it's a castle
    if (!move.to && next === 'O') {
      const castle = this.peekExact('O-O-O') || this.peekExact('O-O');
      if (castle) {
        move.to = castle;
        this.seek(castle.length);
        next = this.peek();
      }
    }

    // ## Promotion of pawn
    if (next === '=') {
      if (move.piece !== 'P') {
        return this.throwError(`Invalid promotion from piece ${move.piece}`);
      }
      this.read();
      next = this.peek();
      move.promotion = this.read().toUpperCase();
      if (move.promotion !== 'Q' && move.promotion !== 'B' && move.promotion !== 'N' && move.promotion !== 'R') {
        return this.throwError(`Invalid promotion to piece ${move.promotion}`);
      }
    }

    // ## Take !! ?? $1 # or + in any order...
    const annotations: string[] = [
      '!!', '!?', '?!', '??', '!', '?',
      '+/=', '=/+', '+/−', '−/+', '+−', '−+', '=',
      '=/\u221E', '\u221E'/*infinity*/,
    ];
    const checkOrMate: string[] = ['#', '++', '+'];

    const find = (arr: string[], test: (item: string) => any) => {
      for (const item of arr) {
        if (test(item)) return item;
      }
      return undefined;
    };

    // ## Now find annotations, + or #, ! ? good/bad, or nag $##
    let found: string | undefined = undefined;
    let last = -1;
    while (last !== this.position()) {
      last = this.position();
      // !! good move ??
      found = find(annotations, m => this.peekExact(m));
      if (found) {
        this.seek(found.length);
        if (move.annotations) {
          return this.throwError(`Found multiple annotations "${move.annotations} and ${found}`);
        }
        move.annotations = found;
      }
      // check + or mate #
      found = find(checkOrMate, m => this.peekExact(m));
      if (found) {
        this.seek(found.length);
        if (move.check) {
          return this.throwError(`Found multiple check flags "${move.check} and ${found}`);
        }
        move.check = found;
      }
      // wierd suffix that denotes capture by en passant
      if (this.peekExact('e.p.')) {
        this.seek(4);
      }
      // NAG $0 thru $255
      if (this.peek() === '$') {
        this.read();
        const nagNum = this.readNumber();
        if (typeof nagNum !== 'number') {
          return this.throwError(`Invalid NAG supplied`);
        }
        if (move.nag) {
          return this.throwError(`Found multiple annotations "${move.nag} and ${nagNum}`);
        }
        move.nag = '$' + `${nagNum}`;
      }
    }

    // Lastly we should end with some kind of delimiter, so we'll store "unknown" characters until we find something useful.
    let unknown = '';
    while (!this.isMoveStop(this.peekToken())) {
      unknown += this.read();
    }
    if (unknown.length) {
      move.unknown = unknown;
    }

    if (move.to && move.to.length) {
      return move;
    }
    return null;
  }

  isMoveStop(token: PgnTokenType) {
    switch (token) {
      case PgnTokenType.NAG: //'$',
      case PgnTokenType.SymbolExt: //'-extra',
      case PgnTokenType.SymbolChar: //'alpha-num',
      case PgnTokenType.Unknown: //'unknown',
      case PgnTokenType.LineEscape: //'%'
      case PgnTokenType.Quote: //'"'
        return false;
      default:
        return true;
    }
  }
}

export default PgnDataCursor;