# SimNow 模拟盘

## 注册账号
1. 访问 https://www.simnow.com.cn/ 注册
2. 获取账号（手机号）和密码
3. 经纪商代码固定: `9999`

## 方式一：GitHub Actions 构建（推荐，无需本地 Linux）

1. 把代码推到 GitHub
2. 进入仓库 → Actions → "Build SimNow Docker Image" → Run workflow
3. 等待构建完成（约15分钟）
4. 下载 Artifacts 中的 `simnow-docker-image`
5. 加载并运行:
   ```bash
   docker load < simnow-trader.tar.gz
   docker run -d --name simnow \
     -e SIMNOW_USER=你的手机号 \
     -e SIMNOW_PASS=你的密码 \
     simnow-trader:latest
   ```

## 方式二：Linux 本地构建

```bash
cd simnow
docker build -t simnow-trader .
docker run -d --name simnow \
  -e SIMNOW_USER=你的手机号 \
  -e SIMNOW_PASS=你的密码 \
  simnow-trader:latest
```

## 凭证说明

凭证通过环境变量注入，不写入代码：
- `SIMNOW_USER` — SimNow 账号（手机号）
- `SIMNOW_PASS` — SimNow 密码

## 交易时段

| 时段 | 时间 | 可连接 |
|------|------|--------|
| 日盘 | 周一~周五 09:00-15:00 | ✅ |
| 夜盘 | 周一~周五 21:00-02:30 | ✅ |
| 其他 | 周末/节假日 | ❌ |

服务器地址: `tcp://180.168.146.187:10201`（交易）/ `10211`（行情）

## 修改交易品种

编辑 `config.json` 中的 `symbols` 字段：
```json
"symbols": ["600519.SSE", "000001.SZE", "300750.SZE"]
```
交易所代码：SSE=上交所, SZE=深交所

## 注意事项

- macOS 无法编译 vnpy-ctp（CTP SDK 仅支持 Linux x86_64），必须用 Docker
- 首次使用需在 SimNow 官网激活账户
- 周末无法连接测试，请在交易时段验证
