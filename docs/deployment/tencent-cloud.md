# 腾讯云单机私有部署

## 当前部署边界

当前版本没有应用登录、加密持久化或服务端定时调度。上游配置和凭证只存在单个服务进程内存中，服务重启、服务器重启或再次发布后都需要重新录入。因此第一阶段只采用单台腾讯云 Lighthouse、单个 Docker 容器和 SSH 隧道访问，不直接开放公网。

部署后的应用只映射到服务器 `127.0.0.1:3210`。腾讯云安全组不得开放 3210 端口；在域名、HTTPS 和覆盖页面及全部 `/api/upstreams/**` 接口的访问控制确认前，不配置公网反向代理。服务器现有 3000、3001 端口属于其他容器，本项目不得占用或修改。

## 服务器要求

- 64 位 Linux 和可用的 Docker Engine。
- 镜像内使用 Node.js 22；服务器不需要安装全局 Node.js 或 npm。
- 至少约 2 GB 可用内存用于镜像构建。
- 出站允许 DNS 和 HTTPS，以便查询各上游余额。
- 系统时间同步正常；阿里云签名对时钟偏差敏感。

## 制作发布包

在项目根目录运行：

```bash
bash deploy/tencent-cloud/package-release.sh
```

默认生成：

```text
outputs/zhangdan-release.tar.gz
outputs/zhangdan-release.tar.gz.sha256
```

发布包只包含构建所需源码、锁文件、部署配置和文档，不包含 `.env`、`node_modules`、`dist`、本地日志或真实上游凭证。

## 安装发布包

完成腾讯云身份验证后，把发布包、同名校验文件和 `install-docker-release.sh` 上传到服务器同一临时目录，再以 root 执行：

```bash
sudo bash install-docker-release.sh /tmp/zhangdan-release.tar.gz
```

安装器会自动核对同名 SHA-256 校验文件，然后：

1. 验证发布包 SHA-256、Docker 和目标端口。
2. 在 `/opt/zhangdan/releases/` 创建独立版本目录。
3. 使用发布包内 Dockerfile 安装依赖并完成生产构建。
4. 以非 root、只读文件系统、零 Linux capabilities 启动候选容器。
5. 候选容器通过 `/healthz` 后再切换正式容器。
6. 正式容器映射 `127.0.0.1:3210`，并设置 `restart: unless-stopped`。
7. 正式健康检查失败时自动恢复上一个容器。

安装器不会安装全局 Node.js、Nginx、证书，也不会修改宝塔、现有容器或腾讯云安全组。

## 私有访问

从自己的电脑建立 SSH 隧道：

```bash
ssh -N -L 3210:127.0.0.1:3210 <ssh-user>@<server-ip>
```

保持终端连接，然后访问：

```text
http://localhost:3210/
```

这时浏览器流量经 SSH 加密进入服务器，应用端口没有暴露公网。若本机 3210 已占用，可以把命令左侧改为其他端口，例如 `-L 3300:127.0.0.1:3210`，再打开 `http://localhost:3300/`。

## 运维与限制

查看状态和日志：

```bash
docker ps --filter name=zhangdan
docker logs --tail 100 zhangdan
curl -fsS http://127.0.0.1:3210/healthz
```

不要运行多个实例、PM2 cluster 或多副本容器。更新或重启会清空内存中的上游账号和凭证，应提前记录非敏感连接参数，并在服务恢复后从可信浏览器重新录入凭证。

公网域名上线前必须另行完成：

- HTTPS 证书与自动续期。
- 覆盖页面和所有管理 API 的服务端访问控制。
- 凭证加密持久化和备份恢复。
- 服务端一分钟调度、并发锁和失败退避。
- 更完整的 SSRF 防护、接口限流、安全响应头和操作审计。
