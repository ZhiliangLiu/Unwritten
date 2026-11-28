import json

import pytest

from unwritten_colab.secrets import SecretProblem, read_launch_file, read_notebook_secret


def test_missing_secret(fake_colab):
    fake_colab.userdata.reset({})

    with pytest.raises(SecretProblem) as caught:
        read_notebook_secret("IMAGE_TOKEN", fake_colab.userdata)

    assert caught.value.kind == "missing"
    assert caught.value.name == "IMAGE_TOKEN"


def test_secret_without_notebook_access(fake_colab):
    fake_colab.userdata.reset({"IMAGE_TOKEN": None})

    with pytest.raises(SecretProblem) as caught:
        read_notebook_secret("IMAGE_TOKEN", fake_colab.userdata)

    assert caught.value.kind == "no_access"


def test_reads_secret(fake_colab):
    fake_colab.userdata.reset({"IMAGE_TOKEN": "test-token-0123456789abcdef0123456789abcdef"})

    assert read_notebook_secret("IMAGE_TOKEN", fake_colab.userdata) == ("test-token-0123456789abcdef0123456789abcdef")


def test_launch_file_is_read_and_deleted(tmp_path):
    path = tmp_path / "launch.json"
    path.write_text(
        json.dumps(
            {
                "token": "test-token-0123456789abcdef0123456789abcdef",
                "tailscaleAuthKey": "tskey-auth-test",
                "idleMinutes": 15,
            }
        )
    )

    values = read_launch_file(path)

    assert values == {
        "token": "test-token-0123456789abcdef0123456789abcdef",
        "tailscaleAuthKey": "tskey-auth-test",
        "idleMinutes": 15,
    }
    assert not path.exists()


def test_launch_file_without_authkey(tmp_path):
    path = tmp_path / "launch.json"
    path.write_text(json.dumps({"token": "test-token", "idleMinutes": 5}))

    assert read_launch_file(path)["tailscaleAuthKey"] is None


def test_missing_launch_file(tmp_path):
    with pytest.raises(SecretProblem) as caught:
        read_launch_file(tmp_path / "launch.json")

    assert caught.value.name == "launch.json"
    assert caught.value.kind == "missing"


def test_launch_file_missing_field_is_deleted(tmp_path):
    path = tmp_path / "launch.json"
    path.write_text(json.dumps({"token": "test-token"}))

    with pytest.raises(SecretProblem):
        read_launch_file(path)

    assert not path.exists()


def test_problem_text_never_contains_the_value():
    value = "sk-test-SECRET-123"

    class NotebookAccessError(Exception):
        pass

    class LeakyUserdata:
        def get(self, name):
            raise NotebookAccessError(f"denied {value}")

    with pytest.raises(SecretProblem) as caught:
        read_notebook_secret("IMAGE_TOKEN", LeakyUserdata())

    assert value not in str(caught.value)
