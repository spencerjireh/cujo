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

from typing import Any

# Reordering and invisibility, spelled by code point because the characters
# themselves would be unreadable here -- which is the whole reason they are on
# the list. U+200B-200F: zero-width space, non-joiner, joiner, and the LTR/RTL
# marks. U+202A-202E: the bidirectional embeddings and overrides. U+2066-2069:
# the bidirectional isolates. U+FEFF: the byte-order mark.
_INVISIBLE = frozenset(
    chr(c) for c in (*range(0x200B, 0x2010), *range(0x202A, 0x202F), *range(0x2066, 0x206A), 0xFEFF)
)
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
        elif ch < "\x20" or "\x7f" <= ch <= "\x9f" or ch in _INVISIBLE:
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
