"""Escaping the strings the pull request writes into the report.

Everything here is text the code under review chose: what it printed, what it
ran, what it named a file. It is quoted into a prompt and rendered in a browser,
so what these tests pin is that a character which changes the meaning of the
text around it arrives as a character that does not.
"""

from __future__ import annotations

from cujo_sniff.scrub import KEEP_IN_TEXT, MAX_ARGV_CHARS, MAX_ARGV_ITEMS, scrub, scrub_argv


def test_control_characters_become_visible_escapes() -> None:
    assert scrub("\x1b[31mred\x1b[0m") == "\\x1b[31mred\\x1b[0m"
    assert scrub("a\x00b") == "a\\x00b"
    # A carriage return erases the line before it in a terminal, which is how
    # output hides what it already said.
    assert scrub("real output\rfake output") == "real output\\x0dfake output"


def test_nothing_is_dropped_only_rewritten() -> None:
    """Escaping, not stripping: what the command did stays in the record.

    A dropped byte quietly rewrites the evidence, which is the opposite of what
    a forensic report is for. An escape is its own account of itself, so no
    separate "this was sanitized" flag is needed either.
    """
    for text in ("\x1b", "‮", "\x7f"):
        assert scrub(text) != text
        assert scrub(text).startswith("\\")
    assert scrub("ordinary text, 100% of it") == "ordinary text, 100% of it"
    assert scrub("héllo → wörld") == "héllo → wörld"


def test_bidi_and_zero_width_characters_do_not_survive() -> None:
    # U+202E reverses everything after it, so a reviewer reads one thing and
    # the file says another. U+200B is simply invisible.
    assert scrub("gpj.‮exe") == "gpj.\\u202eexe"
    assert scrub("pay​load") == "pay\\u200bload"
    assert scrub("﻿bom") == "\\ufeffbom"


def test_newlines_are_structure_in_output_and_a_lie_in_an_argument() -> None:
    assert scrub("line one\nline two\tcolumn", KEEP_IN_TEXT) == "line one\nline two\tcolumn"
    # In an argv element a newline claims there were two arguments.
    assert scrub_argv(["echo", "one\ntwo"]) == ["echo", "one\\x0atwo"]


def test_argv_survives_anything_the_audit_log_can_hold() -> None:
    """The rows come off a file the audited process can also write to.

    `json.loads` will hand back whatever is in there, so the report must not
    assume it is a list, that its members are strings, or that either is small.
    """
    assert scrub_argv(None) == ["None"]
    assert scrub_argv(7) == ["7"]
    assert scrub_argv({"not": "a list"}) == ["{'not': 'a list'}"]
    assert scrub_argv(["ok", {"nested": 1}]) == ["ok", "{'nested': 1}"]

    huge = scrub_argv(["x" * (MAX_ARGV_CHARS * 4)])
    assert len(huge[0]) == MAX_ARGV_CHARS

    many = scrub_argv([str(i) for i in range(MAX_ARGV_ITEMS + 10)])
    assert len(many) == MAX_ARGV_ITEMS + 1
    assert many[-1] == "... 10 more arguments"


def test_every_invisible_and_reordering_character_escapes_not_just_the_famous_ones() -> None:
    """The first version of this was a list of code points, and it leaked.

    U+061C ARABIC LETTER MARK is a bidirectional control like U+200E, does the
    same job, and was not on it -- which is the argument against writing the
    list at all. Escaping by Unicode category closes the class instead of the
    instances: Cf is every format character, Cc the controls, Zl and Zp the two
    separators that end a line in some parsers and not others.
    """
    for ch, name in (
        ("\u061c", "arabic letter mark"),
        ("\u200b", "zero width space"),
        ("\u200e", "left-to-right mark"),
        ("\u202e", "right-to-left override"),
        ("\u2066", "left-to-right isolate"),
        ("\ufeff", "byte order mark"),
        ("\u00ad", "soft hyphen"),
        ("\u2028", "line separator"),
        ("\u2029", "paragraph separator"),
        ("\u180e", "mongolian vowel separator"),
    ):
        assert scrub(ch) != ch, name
        assert scrub(ch).startswith("\\"), name

    # And nothing ordinary is caught by widening the net.
    for ch in ("a", " ", "é", "→", "中", "\u00a0"):
        assert scrub(ch) == ch, repr(ch)
