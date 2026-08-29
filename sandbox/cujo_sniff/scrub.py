"""Making untrusted bytes safe to put in front of a language model.

Every string in a report is written by the code under review: the output it
printed, the arguments it ran, the filenames it chose, the hosts it dialled.
That text is read by the parent agent, quoted into a review, and rendered in a
browser, so it is the one place where the pull request gets to say something
directly to the reviewer.

The answer here is to escape, not to strip. A control byte rendered as `\\x1b`
is still visible as what it was, so nothing an attacker did is hidden from the
agent, and no separate "this was sanitized" flag is needed -- the escape is its
own evidence. Dropping the byte instead would quietly rewrite the record, which
is the opposite of what a forensic report is for.

What gets escaped is what changes the meaning of surrounding text rather than
adding to it: the C0 and C1 control ranges (terminal escape sequences, carriage
returns that erase a line), and the bidirectional and zero-width characters that
reorder or hide text without leaving a mark. Newlines and tabs are structure a
reviewer wants, so `scrub` keeps them where they belong and escapes them where
they do not -- a newline inside an `argv` element is a lie about how many
arguments there were.
"""

from __future__ import annotations

import unicodedata
from typing import Any

# Escaped by Unicode category rather than by a list of code points. The list was
# the obvious way to write this and the wrong one: it named the bidirectional
# overrides and the zero-width set and still let U+061C ARABIC LETTER MARK
# through, because a blacklist of things that hide is only ever as good as the
# last time someone read the standard.
#
# Cf is the format category -- every bidirectional control, every zero-width
# joiner, the byte-order mark, the soft hyphen. Cc is the C0 and C1 controls.
# Cs, Co and Cn are surrogates, private use, and unassigned: nothing legitimate
# in a filename or a command's output, and all of them render unpredictably. Zl
# and Zp are U+2028 and U+2029, which end a line in some parsers and not others.
_ESCAPED_CATEGORIES = frozenset({"Cc", "Cf", "Cs", "Co", "Cn", "Zl", "Zp"})
# An argv element or a path is one line by definition, so nothing is kept there.
KEEP_IN_TEXT = "\n\t"
# Long enough for a real command line, short enough that a megabyte of argv
# cannot be laundered into the prompt through the audit log.
MAX_ARGV_ITEMS = 64
MAX_ARGV_CHARS = 2000


def _escape(ch: str) -> str:
    point = ord(ch)
    return f"\\x{point:02x}" if point <= 0xFF else f"\\u{point:04x}"


def scrub(text: str, keep: str = "") -> str:
    """Render every meaning-changing character as a visible escape.

    `keep` names the ones that carry structure in this position: `"\\n\\t"` for
    a command's output, nothing at all for a path or an argument.
    """
    out: list[str] = []
    for ch in text:
        if ch in keep:
            out.append(ch)
        elif unicodedata.category(ch) in _ESCAPED_CATEGORIES:
            out.append(_escape(ch))
        else:
            out.append(ch)
    return "".join(out)


def scrub_argv(value: Any) -> list[str]:
    """One argv, from a source that guarantees nothing about its shape.

    The audit hook writes rows to a file the audited process can also write to,
    so `value` arrives from `json.loads` and may be any JSON at all: a number, a
    nested object, a single ten-megabyte string. Coercing here is what keeps a
    malformed row from reaching the agent as anything but a list of short
    strings.
    """
    items = value if isinstance(value, list) else [value]
    out: list[str] = []
    for item in items[:MAX_ARGV_ITEMS]:
        text = item if isinstance(item, str) else repr(item)
        out.append(scrub(text[:MAX_ARGV_CHARS]))
    if len(items) > MAX_ARGV_ITEMS:
        out.append(f"... {len(items) - MAX_ARGV_ITEMS} more arguments")
    return out
