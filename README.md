# linux.sb Egern 自动签到

Egern module for linux.sb daily check-in.

## 使用

1. 导入 `linux-sb-checkin.yaml`。
2. 在模块参数中填写登录后的完整 Cookie。
3. 默认每天 08:15 执行，可按需修改 `CronExp`。

脚本会获取 CSRF Token、提交签到并再次确认状态，然后通过 Egern 通知结果。Cookie 不写入仓库。
