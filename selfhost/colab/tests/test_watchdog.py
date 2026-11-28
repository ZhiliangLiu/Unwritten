import json

import pytest

from unwritten_colab.watchdog import watch


class FakeProcess:
    def __init__(self, exit_code=None, args=None):
        self.exit_code = exit_code
        self.args = args or ["worker"]

    def poll(self):
        return self.exit_code


class FakeTime:
    def __init__(self, limit=None):
        self.now = 0.0
        self.limit = limit

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds
        if self.limit is not None and self.now >= self.limit:
            raise LoopEnd


class LoopEnd(Exception):
    pass


def write_state(path, *, in_flight=0, last_activity_at=None, ready=True, reason=None):
    path.write_text(
        json.dumps(
            {
                "ready": ready,
                "notReadyReason": reason,
                "inFlight": in_flight,
                "lastActivityAt": last_activity_at,
            }
        )
    )


def test_in_flight_request_prevents_release(tmp_path):
    state_path = tmp_path / "state.json"
    write_state(state_path, in_flight=1, last_activity_at=0.0)
    time = FakeTime(limit=120.0)
    unassigned = []

    with pytest.raises(LoopEnd):
        watch(
            processes=[],
            state_path=state_path,
            idle_minutes=1,
            clock=time,
            sleep=time.sleep,
            unassign=lambda: unassigned.append(True),
            log=lambda text: None,
            status=None,
        )

    assert time.now >= 120.0
    assert unassigned == []


def test_idle_releases_runtime_once(tmp_path):
    state_path = tmp_path / "state.json"
    write_state(state_path, in_flight=0, last_activity_at=0.0)
    time = FakeTime()
    unassigned = []
    statuses = []
    logs = []

    reason = watch(
        processes=[],
        state_path=state_path,
        idle_minutes=1,
        clock=time,
        sleep=time.sleep,
        unassign=lambda: unassigned.append(True),
        log=logs.append,
        status=lambda phase, **extra: statuses.append((phase, extra)),
    )

    assert reason == "idle"
    assert unassigned == [True]
    assert statuses == [("exiting", {"reason": "idle"})]
    assert any("idle_minutes=0" in line for line in logs)
    assert any("idle_minutes=1" in line for line in logs)


def test_process_exit_keeps_watching_and_reports_once(tmp_path):
    state_path = tmp_path / "state.json"
    write_state(state_path, in_flight=0, last_activity_at=0.0)
    time = FakeTime()
    unassigned = []
    statuses = []
    logs = []
    process = FakeProcess(exit_code=3, args=["python", "service.py"])

    reason = watch(
        processes=[("service.py", process)],
        state_path=state_path,
        idle_minutes=2,
        clock=time,
        sleep=time.sleep,
        unassign=lambda: unassigned.append(True),
        log=logs.append,
        status=lambda phase, **extra: statuses.append((phase, extra)),
    )

    assert reason == "process_exit"
    assert unassigned == [True]
    assert statuses == [("exiting", {"reason": "process_exit"})]
    assert logs.count("service.py exited with code 3") == 1
    assert time.now >= 120.0


def test_no_activity_since_watch_start_counts_as_idle(tmp_path):
    state_path = tmp_path / "state.json"
    write_state(state_path, in_flight=0, last_activity_at=None)
    time = FakeTime()
    unassigned = []

    reason = watch(
        processes=[],
        state_path=state_path,
        idle_minutes=1,
        clock=time,
        sleep=time.sleep,
        unassign=lambda: unassigned.append(True),
        log=lambda text: None,
        status=None,
    )

    assert reason == "idle"
    assert unassigned == [True]
