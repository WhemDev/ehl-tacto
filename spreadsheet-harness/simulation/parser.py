"""Excel formula tokenizer and recursive-descent parser.

Converts a formula string like ``=IF(B7<C5,B7/C5,1)`` into an AST
built from the nodes defined in :mod:`simulation.ast_nodes`.
"""

from __future__ import annotations

import re
from enum import Enum, auto
from typing import List, Optional, Tuple

from simulation.ast_nodes import (
    ASTNode,
    BinOp,
    BoolLiteral,
    CellRef,
    ErrorValue,
    FuncCall,
    NumberLiteral,
    Percent,
    RangeRef,
    StringLiteral,
    UnaryOp,
)


# ── Token types ──────────────────────────────────────────────────

class TT(Enum):
    NUMBER = auto()
    STRING = auto()
    BOOL = auto()
    ERROR = auto()
    CELL = auto()       # A1, $B$2, AA100
    FUNC = auto()       # SUM(  — name stored without '('
    LPAREN = auto()
    RPAREN = auto()
    COMMA = auto()
    SEMICOLON = auto()
    COLON = auto()
    BANG = auto()        # !
    PLUS = auto()
    MINUS = auto()
    STAR = auto()
    SLASH = auto()
    CARET = auto()
    AMP = auto()         # &
    EQ = auto()          # =
    NEQ = auto()         # <>
    LT = auto()
    GT = auto()
    LTE = auto()
    GTE = auto()
    PERCENT = auto()
    SHEET = auto()       # sheet name token (before !)
    EOF = auto()


class Token:
    __slots__ = ("tt", "value", "pos")

    def __init__(self, tt: TT, value: object, pos: int):
        self.tt = tt
        self.value = value
        self.pos = pos

    def __repr__(self) -> str:  # pragma: no cover
        return f"Token({self.tt.name}, {self.value!r})"


# ── Tokenizer ────────────────────────────────────────────────────

_CELL_RE = re.compile(
    r"\$?[A-Z]{1,3}\$?\d{1,7}",
    re.IGNORECASE,
)

_ERRORS = frozenset({
    "#N/A", "#REF!", "#VALUE!", "#DIV/0!", "#NULL!", "#NUM!", "#NAME?",
})

_FUNC_NAME_RE = re.compile(r"[A-Z_][A-Z0-9_.]*", re.IGNORECASE)


def _is_cell(text: str) -> bool:
    return bool(_CELL_RE.fullmatch(text))


def tokenize(formula: str) -> List[Token]:
    """Tokenize an Excel formula string (leading ``=`` optional)."""
    tokens: List[Token] = []
    s = formula.lstrip("=")
    i = 0
    n = len(s)

    while i < n:
        ch = s[i]

        # Whitespace
        if ch in " \t\n\r":
            i += 1
            continue

        # String literal
        if ch == '"':
            j = i + 1
            buf: list[str] = []
            while j < n:
                if s[j] == '"':
                    if j + 1 < n and s[j + 1] == '"':
                        buf.append('"')
                        j += 2
                    else:
                        j += 1
                        break
                else:
                    buf.append(s[j])
                    j += 1
            tokens.append(Token(TT.STRING, "".join(buf), i))
            i = j
            continue

        # Error literals
        if ch == "#":
            for err in _ERRORS:
                if s[i:i + len(err)].upper() == err.upper():
                    tokens.append(Token(TT.ERROR, err, i))
                    i += len(err)
                    break
            else:
                i += 1
            continue

        # Numbers
        if ch.isdigit() or (ch == "." and i + 1 < n and s[i + 1].isdigit()):
            j = i
            while j < n and (s[j].isdigit() or s[j] == "."):
                j += 1
            if j < n and s[j].upper() == "E":
                j += 1
                if j < n and s[j] in "+-":
                    j += 1
                while j < n and s[j].isdigit():
                    j += 1
            tokens.append(Token(TT.NUMBER, float(s[i:j]), i))
            i = j
            continue

        # Sheet name in single quotes: 'My Sheet'!
        if ch == "'":
            j = i + 1
            while j < n and s[j] != "'":
                j += 1
            sheet_name = s[i + 1:j]
            j += 1  # skip closing '
            tokens.append(Token(TT.SHEET, sheet_name, i))
            i = j
            continue

        # Two-char operators
        two = s[i:i + 2]
        if two == "<>":
            tokens.append(Token(TT.NEQ, "<>", i))
            i += 2
            continue
        if two == "<=":
            tokens.append(Token(TT.LTE, "<=", i))
            i += 2
            continue
        if two == ">=":
            tokens.append(Token(TT.GTE, ">=", i))
            i += 2
            continue

        # Single-char operators and punctuation
        simple = {
            "(": TT.LPAREN, ")": TT.RPAREN, ",": TT.COMMA, ";": TT.SEMICOLON,
            ":": TT.COLON, "!": TT.BANG, "+": TT.PLUS, "-": TT.MINUS,
            "*": TT.STAR, "/": TT.SLASH, "^": TT.CARET, "&": TT.AMP,
            "=": TT.EQ, "<": TT.LT, ">": TT.GT, "%": TT.PERCENT,
        }
        if ch in simple:
            tokens.append(Token(simple[ch], ch, i))
            i += 1
            continue

        # Identifiers: TRUE/FALSE, function names, cell references
        if ch == "$" or ch.isalpha() or ch == "_":
            j = i
            # Collect $ + alpha + digits pattern (cell refs include $)
            word_start = j
            raw = []
            while j < n and (s[j].isalnum() or s[j] in "$_."):
                raw.append(s[j])
                j += 1
            word = "".join(raw)

            # Check for boolean
            if word.upper() == "TRUE":
                tokens.append(Token(TT.BOOL, True, i))
                i = j
                continue
            if word.upper() == "FALSE":
                tokens.append(Token(TT.BOOL, False, i))
                i = j
                continue

            # Function call: NAME followed by '('
            if j < n and s[j] == "(" and _FUNC_NAME_RE.fullmatch(word):
                tokens.append(Token(TT.FUNC, word.upper(), i))
                tokens.append(Token(TT.LPAREN, "(", j))
                i = j + 1
                continue

            # Sheet name (unquoted): NAME followed by !
            if j < n and s[j] == "!":
                tokens.append(Token(TT.SHEET, word, i))
                tokens.append(Token(TT.BANG, "!", j))
                i = j + 1
                continue

            # Cell reference
            if _is_cell(word):
                tokens.append(Token(TT.CELL, word, i))
                i = j
                continue

            # Fallback: treat as function without parens or name — shouldn't normally happen
            tokens.append(Token(TT.FUNC, word.upper(), i))
            i = j
            continue

        # Unknown character — skip
        i += 1

    tokens.append(Token(TT.EOF, None, i))
    return tokens


# ── Parser ───────────────────────────────────────────────────────

def _parse_cell_token(value: str) -> Tuple[str, int, bool, bool]:
    """Parse a cell token value like '$A$1' into (col, row, abs_col, abs_row)."""
    s = value.upper()
    idx = 0
    abs_col = False
    abs_row = False

    if idx < len(s) and s[idx] == "$":
        abs_col = True
        idx += 1

    col_start = idx
    while idx < len(s) and s[idx].isalpha():
        idx += 1
    col = s[col_start:idx]

    if idx < len(s) and s[idx] == "$":
        abs_row = True
        idx += 1

    row = int(s[idx:])
    return col, row, abs_col, abs_row


class Parser:
    """Recursive-descent parser for Excel formulas."""

    def __init__(self, tokens: List[Token]):
        self._tokens = tokens
        self._pos = 0

    def _peek(self) -> Token:
        return self._tokens[self._pos]

    def _advance(self) -> Token:
        tok = self._tokens[self._pos]
        self._pos += 1
        return tok

    def _expect(self, tt: TT) -> Token:
        tok = self._advance()
        if tok.tt != tt:
            raise SyntaxError(
                f"Expected {tt.name}, got {tok.tt.name} at pos {tok.pos}"
            )
        return tok

    # ── Entry point ──────────────────────────────────────────

    def parse(self) -> ASTNode:
        node = self._expr()
        if self._peek().tt != TT.EOF:
            raise SyntaxError(
                f"Unexpected token {self._peek().tt.name} at pos {self._peek().pos}"
            )
        return node

    # ── Expression precedence levels (lowest to highest) ─────
    # comparison < concatenation < additive < multiplicative < power < unary < postfix < atom

    def _expr(self) -> ASTNode:
        return self._comparison()

    def _comparison(self) -> ASTNode:
        left = self._concat()
        ops = {TT.EQ: "=", TT.NEQ: "<>", TT.LT: "<", TT.GT: ">",
               TT.LTE: "<=", TT.GTE: ">="}
        while self._peek().tt in ops:
            op_tok = self._advance()
            right = self._concat()
            left = BinOp(ops[op_tok.tt], left, right)
        return left

    def _concat(self) -> ASTNode:
        left = self._additive()
        while self._peek().tt == TT.AMP:
            self._advance()
            right = self._additive()
            left = BinOp("&", left, right)
        return left

    def _additive(self) -> ASTNode:
        left = self._multiplicative()
        while self._peek().tt in (TT.PLUS, TT.MINUS):
            op_tok = self._advance()
            right = self._multiplicative()
            left = BinOp(op_tok.value, left, right)
        return left

    def _multiplicative(self) -> ASTNode:
        left = self._power()
        while self._peek().tt in (TT.STAR, TT.SLASH):
            op_tok = self._advance()
            right = self._power()
            left = BinOp(op_tok.value, left, right)
        return left

    def _power(self) -> ASTNode:
        base = self._unary()
        if self._peek().tt == TT.CARET:
            self._advance()
            exp = self._unary()
            return BinOp("^", base, exp)
        return base

    def _unary(self) -> ASTNode:
        if self._peek().tt == TT.MINUS:
            self._advance()
            operand = self._unary()
            return UnaryOp("-", operand)
        if self._peek().tt == TT.PLUS:
            self._advance()
            return self._unary()
        return self._postfix()

    def _postfix(self) -> ASTNode:
        node = self._atom()
        if self._peek().tt == TT.PERCENT:
            self._advance()
            return Percent(node)
        return node

    # ── Atoms ────────────────────────────────────────────────

    def _atom(self) -> ASTNode:
        tok = self._peek()

        # Number
        if tok.tt == TT.NUMBER:
            self._advance()
            return NumberLiteral(tok.value)

        # String
        if tok.tt == TT.STRING:
            self._advance()
            return StringLiteral(tok.value)

        # Boolean
        if tok.tt == TT.BOOL:
            self._advance()
            return BoolLiteral(tok.value)

        # Error
        if tok.tt == TT.ERROR:
            self._advance()
            return ErrorValue(tok.value)

        # Parenthesised expression
        if tok.tt == TT.LPAREN:
            self._advance()
            node = self._expr()
            self._expect(TT.RPAREN)
            return node

        # Function call
        if tok.tt == TT.FUNC:
            return self._func_call()

        # Sheet-qualified reference: Sheet1!A1 or 'Sheet Name'!A1
        if tok.tt == TT.SHEET:
            sheet_name = tok.value
            self._advance()
            # Consume the '!' if present
            if self._peek().tt == TT.BANG:
                self._advance()
            cell_tok = self._expect(TT.CELL)
            col, row, abs_col, abs_row = _parse_cell_token(cell_tok.value)
            cell_ref = CellRef(col, row, sheet=sheet_name, abs_col=abs_col, abs_row=abs_row)
            # Check for range
            if self._peek().tt == TT.COLON:
                self._advance()
                end_tok = self._expect(TT.CELL)
                ecol, erow, eabs_col, eabs_row = _parse_cell_token(end_tok.value)
                end_ref = CellRef(ecol, erow, sheet=sheet_name, abs_col=eabs_col, abs_row=eabs_row)
                return RangeRef(cell_ref, end_ref)
            return cell_ref

        # Cell reference (possibly with range)
        if tok.tt == TT.CELL:
            self._advance()
            col, row, abs_col, abs_row = _parse_cell_token(tok.value)
            cell_ref = CellRef(col, row, abs_col=abs_col, abs_row=abs_row)
            # Check for range  A1:B5
            if self._peek().tt == TT.COLON:
                self._advance()
                end_tok = self._expect(TT.CELL)
                ecol, erow, eabs_col, eabs_row = _parse_cell_token(end_tok.value)
                end_ref = CellRef(ecol, erow, abs_col=eabs_col, abs_row=eabs_row)
                return RangeRef(cell_ref, end_ref)
            return cell_ref

        raise SyntaxError(
            f"Unexpected token {tok.tt.name} ({tok.value!r}) at pos {tok.pos}"
        )

    def _func_call(self) -> ASTNode:
        name_tok = self._advance()  # FUNC token
        self._expect(TT.LPAREN)
        args: List[ASTNode] = []
        if self._peek().tt != TT.RPAREN:
            args.append(self._expr())
            while self._peek().tt in (TT.COMMA, TT.SEMICOLON):
                self._advance()
                args.append(self._expr())
        self._expect(TT.RPAREN)
        return FuncCall(name_tok.value, args)


# ── Public API ───────────────────────────────────────────────────

def parse_formula(formula: str) -> ASTNode:
    """Parse an Excel formula string into an AST.

    The leading ``=`` is optional.

    >>> from simulation.parser import parse_formula
    >>> parse_formula("=A1+B2")
    BinOp(op='+', left=CellRef(col='A', row=1, ...), right=CellRef(col='B', row=2, ...))
    """
    tokens = tokenize(formula)
    parser = Parser(tokens)
    return parser.parse()
