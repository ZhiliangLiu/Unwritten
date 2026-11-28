from launcher.app import create_app
from launcher.machine import Machine


async def test_restart_recovers_running_session_and_stops_when_it_disappears(
    config, fake_colab, aiohttp_client, auth_headers, wait_http_state
):
    session = fake_colab / "sessions" / "unwritten-comfyui"
    session.mkdir(parents=True)
    machine = Machine(config, session_check_interval=0.05)
    client = await aiohttp_client(create_app(config, machine=machine))

    response = await client.get("/v1/state", headers=auth_headers())
    assert (await response.json())["state"] == "running"

    session.rmdir()
    snapshot = await wait_http_state(client, auth_headers(), {"stopped"}, timeout=5)
    assert snapshot["state"] == "stopped"
