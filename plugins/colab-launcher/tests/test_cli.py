import pytest

from launcher import cli


async def test_version_matches_lock(fake_colab):
    assert await cli.version() == cli.pinned_version()
    assert cli.pinned_version() == "0.8.0"


async def test_sessions_parses_multiple_lines(fake_colab):
    (fake_colab / "sessions" / "alpha").mkdir(parents=True)
    (fake_colab / "sessions" / "beta").mkdir()
    assert await cli.sessions() == {"alpha", "beta"}


async def test_sessions_parses_no_active_sessions(fake_colab):
    assert await cli.sessions() == set()


async def test_sessions_maps_401_to_not_signed_in(fake_colab, monkeypatch):
    monkeypatch.setenv("FAKE_COLAB_SIGNED_OUT", "1")
    with pytest.raises(cli.NotSignedIn):
        await cli.sessions()


async def test_stop_missing_session_is_success(fake_colab):
    await cli.stop("missing")


async def test_stop_removes_existing_session(fake_colab):
    session = fake_colab / "sessions" / "gone"
    session.mkdir(parents=True)
    await cli.stop("gone")
    assert not session.exists()


async def test_new_maps_400_to_quota(fake_colab, monkeypatch):
    monkeypatch.setenv("FAKE_COLAB_NEW", "400")
    with pytest.raises(cli.Quota):
        await cli.new("unwritten-comfyui", "A100", False)


async def test_new_maps_401_to_not_signed_in(fake_colab, monkeypatch):
    monkeypatch.setenv("FAKE_COLAB_NEW", "401")
    with pytest.raises(cli.NotSignedIn):
        await cli.new("unwritten-comfyui", "A100", False)
