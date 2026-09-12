"""The envelope's roll-up over `runs[]` (decision 112).

Computed in Python so a model never has to. The rules are asymmetric on purpose:
an interesting `derived` flag is an OR, because something that happened in one
command happened; an armed sensor is an AND, because a sensor blind for one
command leaves that command's clean rows worth less than they look.
"""

from __future__ import annotations

from cujo_sniff.report import rollup


def entry(**over: object) -> dict[str, object]:
    base: dict[str, object] = {
        "derived": {
            "egress_to_unknown_host": False,
            "wrote_outside_workspace": False,
            "wrote_sensitive": False,
            "spawned_subprocess": False,
        },
        "truncated": {"stdout": False, "files_read": False},
        "sensors": {"proxy": {"armed": True, "detail": "port 1"}},
    }
    base.update(over)
    return base


def test_rollup_ors_an_interesting_flag() -> None:
    rolled = rollup(
        [
            entry(),
            entry(
                derived={
                    "egress_to_unknown_host": True,
                    "wrote_outside_workspace": False,
                    "wrote_sensitive": False,
                    "spawned_subprocess": False,
                }
            ),
        ]
    )
    assert rolled["derived"]["egress_to_unknown_host"] is True
    assert rolled["derived"]["wrote_sensitive"] is False


def test_rollup_ors_truncation_too() -> None:
    rolled = rollup([entry(), entry(truncated={"stdout": True, "files_read": False})])
    assert rolled["truncated"]["stdout"] is True
    assert rolled["truncated"]["files_read"] is False


def test_rollup_calls_a_sensor_armed_only_when_it_always_was() -> None:
    rolled = rollup(
        [
            entry(),
            entry(sensors={"proxy": {"armed": False, "detail": "port busy"}}),
            entry(),
        ]
    )
    assert rolled["sensors"]["proxy"]["armed"] is False
    # The detail comes from the window it was blind in, which is the one worth
    # naming -- "port 1" would say nothing about what went wrong.
    assert rolled["sensors"]["proxy"]["detail"] == "port busy"


def test_rollup_keeps_an_armed_sensors_own_detail() -> None:
    rolled = rollup([entry(), entry()])
    assert rolled["sensors"]["proxy"] == {"armed": True, "detail": "port 1"}


def test_rollup_ignores_a_sensor_block_that_is_not_an_object() -> None:
    """A report is written by code under review, eventually. Do not trust shapes."""
    rolled = rollup([entry(sensors={"proxy": "armed"})])
    assert rolled["sensors"] == {}


def test_rollup_of_nothing_is_empty_rather_than_a_claim() -> None:
    assert rollup([]) == {"derived": {}, "truncated": {}, "sensors": {}}
