import sniff


def test_main_exists() -> None:
    assert callable(sniff.main)
