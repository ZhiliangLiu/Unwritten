# Unwritten · Strata 自建模型服务

`selfhost/strata/` 把 [Strata](https://github.com/Niko1221/Strata) 包装成 core 能直接调用的 OpenAI 兼容端点。模型文件来自 [ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF](https://huggingface.co/ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF)，下载前按模型卡确认许可。设计依据是 [Strata 自建模型服务](../../docs/strata.md)。

## 负责什么

- 用锁定版本安装 Strata，按固定参数启动引擎。
- 在 `127.0.0.1:8191` 提供网关，校验调用方令牌，只放行两个接口。
- 把调用方令牌换成内部 key，流式转发 Strata 的响应。
- 反复自检，维护就绪状态，写 `/tmp/unwritten-strata.state`。
- 首次准备时生成 MTP 草稿层并缓存到 Drive，之后从 Drive 复制到本地。
- 在 Colab 上向宿主声明资源下限、端口、状态文件和模型清单。

## 不归它管

- core 怎样配置和调用模型服务，见 [LLM 端点](../../docs/llm-endpoints.md)。
- Colab 的资源检查、Drive、Secrets、Tailscale 和空闲释放，见 [Colab 宿主](../../docs/colab-host.md)。
- Strata 自己的推理、加载和模型下载。
- `apps/` 和 `packages/` 不导入这个目录，core 也不知道 Strata 的名字。

## 目录

```
gateway/             网关：鉴权、路由、转发、自检、健康检查、状态文件
colab_service.py     HostedService：准备、启动、模型清单、MTP 缓存
colab.ipynb          只在 Colab 上运行的代码单元
strata.lock.json     Strata 发布版本、发布目录和引擎版本
models.lock.json     Q2_0 模型文件和 MTP 缓存清单
mtp-manifest.json    MTP 的 31 个源张量、分片、字节范围、大小和 sha256
requirements.txt     网关依赖，由 uv 从锁定文件导出
```

## 锁定文件与 MTP 缓存

`models.lock.json` 的 `files` 是宿主 `ensure_models` 的模型清单，MTP 不放进那里。可选的 `artifacts` 数组描述宿主不认识的派生产物；本目录只有一项：

```json
{
  "name": "mtp-q2_0",
  "source": {
    "repo": "Qwen/Qwen3.8-Flash-Next",
    "commit": "de4b8e4d43b917e7706784d8bb445c9af86a3540",
    "bytes": 5214301696,
    "manifest": "mtp-manifest.json",
    "manifest_sha256": "1ad281ed87ad9cd42f9c048e9c49172165ea714a600d15f1d80cd0a02db12328",
    "tensor_map_sha256": "4ef372235caf4a756be32c0c62856c251d24df3d785a0c7a9e8c7181e27a6e8c"
  },
  "dest": "mtp",
  "files": [
    {
      "path": "mtp-q2_0.gguf",
      "size": 889017216,
      "sha256": "a22206a4d74eafbf31063a84610292535fb3b49af9a339963817fd04aed81e4d"
    }
  ]
}
```

`mtp-manifest.json` 列出 31 个 `mtp.*` 张量的分片、字节范围、大小和 sha256，和 Strata 的 `terminal/tools/mtp_fetch.py` 钉的是同一个 BF16 版本。`artifacts[].files[].path` 相对于 `dest`；这些 packed 文件的大小和 sha256 由 Strata 0.2.23 的 `tools/mtp_pack.py`、`tools/mtp_rt.py` 从校验过的源张量生成。

`prepare` 先安装钉死版本的 Strata，再处理 MTP：

1. Drive 上已有 `unwritten/strata/mtp`，且每个文件旁边的 `.verified.json` 记下的大小、修改时间和 sha256 都对得上：直接复制到本地 `strata-data/mtp`，不联网。
2. 本地已有完整 MTP：直接复制到 Drive。
3. 两边都没有或缓存损坏：调用已安装 Strata 的 `tools/mtp_fetch.py`、`tools/mtp_pack.py`、`tools/mtp_rt.py`，在 `strata-data/mtp-build` 生成 `mtp-q2_0.gguf` 和 `rt/`，核对 `models.lock.json` 里的大小和 sha256，再原子地移到 `strata-data/mtp` 并复制到 Drive。

复制发生在 `strata launch` 之前，`strata launch` 看到 `rt/experts.bin` 就不再下载或重打 MTP。损坏的文件按 `ensure_models` 的方式删除并重建。宿主的磁盘检查把 `files`、`artifacts[].source.bytes` 和 `artifacts[].files[].size` 都算进去；第一次构建的临时文件另占 Drive 和本地磁盘。

## 网关契约

- 只监听 `127.0.0.1`，端口由 `UNWRITTEN_LLM_PORT` 配置，默认 8191。
- 只放行 `GET /v1/models` 和 `POST /v1/chat/completions`。其他路径和方法返回 404，请求不会到达 Strata。
- `Authorization: Bearer <令牌>` 与 `UNWRITTEN_LLM_TOKEN` 比较，不匹配返回 401。令牌少于 32 个字符时进程拒绝启动。
- 到 Strata 的请求只带 `Content-Type`、`Accept` 和内部 key，不转发调用方的其他请求头。
- 请求体必须是 JSON 对象；`messages` 的 `content` 可以是字符串、`null` 或全部为 `text` 的数组，图片、音频和文件内容块返回 400。
- 响应按块转发，不缓冲；上游 3xx 一律变成 502；所有 `Access-Control-*` 响应头去掉。
- 自检通过前，这两个接口返回 503。
- 日志只记方法、路径、状态码和耗时，不记请求体、响应体和请求头。

状态文件是 JSON 对象，字段为 `ready`、`notReadyReason`、`inFlight`、`lastActivityAt`，每次都整份重写。`notReadyReason` 取 `starting`、`load_timeout`、`self_test_failed`、`engine_down`。格式见 [Colab 宿主 §4](../../docs/colab-host.md#4-宿主与服务的约定)。

## 在 Colab 上运行

1. 把这个目录复制到 Drive 的 `unwritten/strata/code/`，把 `selfhost/colab/` 复制到 `unwritten/colab/`。
2. 在 Colab Secrets 里存 `UNWRITTEN_LLM_TOKEN`（用 `openssl rand -hex 32` 生成）和 `TS_AUTHKEY_LLM`，并给笔记本授予访问权限。
3. 按 [Colab 宿主 §9](../../docs/colab-host.md#9-tailscale-的访问控制) 写好访问控制，只放行到 `tag:unwritten-llm` 的 443。
4. 打开 `unwritten/strata/code/colab.ipynb`，运行全部单元格。运行时会安装依赖和 Strata、放好模型、启动引擎并自检。
5. 等自检通过；看护循环会打印就绪状态和地址 `https://unwritten-llm.<tailnet 名>.ts.net`。

## 在本机运行

1. 按 [Strata 安装文档](https://github.com/Niko1221/Strata/blob/main/docs/INSTALL.md) 安装 `strata.lock.json` 指定的版本，把 `models.lock.json` 的文件放到一个本地目录。
2. 安装网关依赖：`uv sync --frozen`。
3. 生成两把 key：调用方令牌用 `openssl rand -hex 32`，内部 key 用 `openssl rand -base64 32`。
4. 按 [Strata §5](../../docs/strata.md#5-运行参数) 的参数启动 Strata，`--api-key-env STRATA_INTERNAL_KEY` 的值就是内部 key。
5. 启动网关：

   ```sh
   UNWRITTEN_LLM_TOKEN=<令牌> STRATA_INTERNAL_KEY=<内部 key> \
     uv run python -m gateway
   ```

6. 地址填 `http://127.0.0.1:8191/v1`。

本机运行不会卸载 Drive，也不会释放运行时；Strata 的日志会一直留在这台机器的磁盘上。日志是否写入提示词由 Strata 决定，见「已知限制」。

## 在 Unwritten 里接上

1. 在 Mac 上用 `openssl rand -hex 32` 生成令牌，存进 Colab Secrets 的 `UNWRITTEN_LLM_TOKEN`。
2. 运行笔记本，等它打印服务地址和「就绪」。
3. 设置页 → 模型服务 → 添加自定义端点：协议选 `openai-completions`，地址填 `https://unwritten-llm.<tailnet 名>.ts.net/v1`，key 填同一个令牌。
4. 点「查找模型」，勾选列出的模型，上下文窗口填 65536，推理填「是」，思考写法选 `openai`。
5. 点「测试连接」，确认支持工具调用，再按需分配用途。

## 已知限制

- **日志可能含提示词。** Strata 没有说明日志会不会写入提示词。Colab 上本地磁盘随运行时销毁，自己的机器上会一直保留。
- **思考档位只有四档。** `reasoning_effort` 只认 `none`、`low`、`medium`、`high`。用途没设档位时，Strata 按模型默认的 `high` 思考，每回合都会明显变慢；用 Strata 承担 narrator 时把档位设为关闭。
- **只有一个解码槽位。** narrator 和 background 都分给 Strata 时，回合摘要、镜头描述要和正文排队。
- **冷启动慢。** 每次都要复制模型、加载、自检。MTP 草稿层第一次在 `prepare` 里生成并缓存到 Drive，之后从 Drive 复制。
- **Colab 回收运行时，服务就中断。** 重新运行笔记本，或在用途分配里换一个端点。

## 开发与测试

```sh
uv run --frozen pytest -q
uv run --frozen ruff check
uv run --frozen ruff format --check
```

`pnpm test:python` 也会跑这里的 pytest。伪 Strata 在 `tests/fake_strata.py`。
