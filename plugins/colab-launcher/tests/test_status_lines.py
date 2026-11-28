from launcher.status_lines import parse


def test_parses_prefixed_json():
    assert parse('unwritten-host {"phase": "serving"}') == {"phase": "serving"}


def test_keeps_only_phase_reason_and_step():
    line = 'unwritten-host {"phase": "exiting", "reason": "idle", "step": "starting", "url": "https://x.test"}'
    assert parse(line) == {"phase": "exiting", "reason": "idle", "step": "starting"}


def test_ignores_other_lines():
    assert parse("starting host") is None
    assert parse("") is None
    assert parse("unwritten-host") is None


def test_rejects_invalid_json():
    assert parse("unwritten-host {not json}") is None
    assert parse('unwritten-host ["serving"]') is None


def test_requires_string_phase():
    assert parse("unwritten-host {}") is None
    assert parse('unwritten-host {"phase": 3}') is None


def test_drops_non_string_extra_values():
    assert parse('unwritten-host {"phase": "serving", "reason": 3}') == {"phase": "serving"}
